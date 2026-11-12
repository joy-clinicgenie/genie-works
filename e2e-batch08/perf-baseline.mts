/**
 * Signed-in performance baselines against the isolated `perf` suite.
 *
 * It starts the local Wix mock, starts a production build of the platform against the isolated
 * databases, signs in with the suite's own session helper, and measures each page. Nothing touches a
 * shared or production database, and Wix reads never leave this machine.
 *
 * Usage (see docs/testing/PERFORMANCE_BASELINES.md for the full sequence):
 *   npx tsx e2e-batch08/prepare.mts perf
 *   NEXT_DIST_DIR=.next-perf npm run build -w @clinic-genie/platform
 *   npx tsx e2e-batch08/perf-baseline.mts
 *
 * Flags: --skip-concurrency, --skip-scenarios, --warm=<n>, --viewport=desktop|mobile|both
 */
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser } from "@playwright/test";
import { FIXTURE_CLIENTS, FIXTURE_WEBSITES, FIXTURE_WIX_BINDING, type PerfFixtureSummary } from "../packages/db/src/testing/perf-fixture.ts";
import { startWixMock, WIX_MOCK_SCENARIOS, type WixMockScenario } from "../packages/db/src/testing/wix-mock.ts";
import { FIXTURE_VERSION } from "../packages/db/src/testing/perf-fixture.ts";
import { suiteTargets } from "./targets.ts";
import { openAs } from "./support.ts";
import { BackendSampler, installObservers, measureNavigation, summarise, type NavigationSample } from "./measure.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const WARM_RUNS = Number(value("warm", "5"));
const MOCK_PORT = 3420;
const targets = suiteTargets("perf");
const ORIGIN = targets.prodOrigin;
const OUT_DIR = "docs/testing/baselines";

const A = FIXTURE_CLIENTS.a.id;
const SITE_A = FIXTURE_WEBSITES.aProduction.id;

/**
 * Ids the fixture load assigned. Read from the run context rather than hardcoded, because
 * blog_article_versions is append-only and article ids come from the blog service.
 */
interface PerfContext { platform: PerfFixtureSummary; enquiry: { enquiries: number; byStatus: Record<string, number> } }
const context = JSON.parse(readFileSync("e2e-batch08/.run/perf-context.json", "utf8")) as PerfContext;
const BLOG = context.platform.blog;
const REPORT_ID = "f1f1f1f1-0000-4000-8000-00000000f001";
if (context.platform.version !== FIXTURE_VERSION) {
  throw new Error(`The isolated database holds fixture ${context.platform.version}, but this code expects ${FIXTURE_VERSION}. Run npm run perf:prepare.`);
}

/** Each page states the selector that proves its primary data is on screen, not just its frame. */
const PAGES = [
  { id: "dashboard", label: "Dashboard", path: "/", primary: "text=Active clients", email: "admin@example.invalid" },
  { id: "enquiries", label: "Enquiries", path: "/enquiries", primary: "table", email: "admin@example.invalid" },
  { id: "enquiries-filtered", label: "Enquiries filtered by status", path: "/enquiries?status=new", primary: "table", email: "admin@example.invalid" },
  { id: "enquiries-page-2", label: "Enquiries page 2", path: "/enquiries?page=2", primary: "table", email: "admin@example.invalid" },
  { id: "enquiries-clinic-a", label: "Enquiries scoped to Clinic A", path: `/enquiries?clinic=${FIXTURE_CLIENTS.a.slug}`, primary: "table", email: "admin@example.invalid" },
  { id: "analytics-overview", label: "Analytics Overview", path: `/analytics?client=${A}&website=${SITE_A}`, primary: "h1", email: "admin@example.invalid" },
  { id: "analytics-traffic", label: "Analytics Traffic", path: `/analytics/traffic?client=${A}&website=${SITE_A}`, primary: "h1", email: "admin@example.invalid" },
  { id: "analytics-behaviour", label: "Analytics Behaviour", path: `/analytics/behavior?client=${A}&website=${SITE_A}`, primary: "h1", email: "admin@example.invalid" },
  { id: "seo-overview", label: "SEO Overview", path: `/seo?client=${A}&website=${SITE_A}`, primary: "h1", email: "admin@example.invalid" },
  { id: "reports-library", label: "Reports library", path: "/reports", primary: "h1", email: "admin@example.invalid" },
  { id: "report-new", label: "Report generation form", path: `/reports/new?client=${A}`, primary: "form", email: "admin@example.invalid" },
  { id: "blog-list", label: "Blog list", path: `/blog?client=${A}&website=${SITE_A}`, primary: "h1", email: "admin@example.invalid" },
  { id: "blog-editor", label: "Blog editor, article with media", path: `/blog/${BLOG.withMediaArticleId}`, primary: "h1", email: "admin@example.invalid" },
  { id: "blog-editor-plain", label: "Blog editor, article without media", path: `/blog/${BLOG.plainArticleId}`, primary: "h1", email: "admin@example.invalid" },
  { id: "blog-preview", label: "Blog preview with media", path: `/blog/${BLOG.withMediaArticleId}/preview`, primary: "img", email: "admin@example.invalid" },
  { id: "blog-media", label: "Blog media route", path: `/api/blog-media/${BLOG.featuredMediaId}`, primary: "img", email: "admin@example.invalid" },
  { id: "report-view", label: "Saved report", path: `/reports/${REPORT_ID}`, primary: "h1", email: "admin@example.invalid" },
  { id: "clients", label: "Clients", path: "/clients", primary: "table", email: "admin@example.invalid" },
  { id: "empty-client", label: "Analytics for a client with no data", path: `/analytics?client=${FIXTURE_CLIENTS.empty.id}`, primary: "h1", email: "admin@example.invalid" },
  { id: "scoped-specialist", label: "Dashboard as a clinic-scoped specialist", path: "/", primary: "text=Active clients", email: "specialist-a@example.invalid" },
] as const;

interface PageResult {
  id: string;
  label: string;
  path: string;
  email: string;
  viewport: string;
  cold: (NavigationSample & { providerCalls: number; providerMs: number }) | null;
  warm: {
    navigationMs: ReturnType<typeof summarise>;
    primaryDataVisibleMs: ReturnType<typeof summarise>;
    ttfbMs: ReturnType<typeof summarise>;
    firstContentfulPaintMs: ReturnType<typeof summarise>;
    providerCalls: ReturnType<typeof summarise>;
    providerMs: ReturnType<typeof summarise>;
    cumulativeLayoutShift: number | null;
    requestCount: number | null;
    transferredBytes: number | null;
  } | null;
  note?: string;
}

interface BaselineReport {
  generatedAt: string;
  suite: string;
  origin: string;
  build: string;
  provider: string;
  warmRuns: number;
  databaseCounts: string;
  pages: PageResult[];
  wixScenarios: Array<Record<string, unknown>>;
  concurrency: Array<Record<string, unknown>>;
}

function log(line: string): void {
  console.log(line);
}

async function waitForServer(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/sign-in`, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`The isolated server did not answer on ${url}.`);
}

/**
 * Refuses to measure anything if the suite port is already answering. A stale server from an earlier
 * run would otherwise serve the measurements from an old build and an old fixture, and the numbers
 * would look entirely normal.
 */
async function assertPortIsFree(): Promise<void> {
  try {
    const response = await fetch(`${ORIGIN}/sign-in`, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
    throw new Error(
      `Something is already serving ${ORIGIN} (status ${response.status}). Stop it before measuring, or the results come from that server rather than this build.`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Something is already serving")) throw error;
    // Anything else means nothing is listening, which is what this run needs.
  }
}

async function main(): Promise<void> {
  await assertPortIsFree();
  const mock = await startWixMock({ scenario: "normal", formId: FIXTURE_WIX_BINDING.formId, namespace: FIXTURE_WIX_BINDING.namespace, port: MOCK_PORT, pageSize: 25, pages: 3, delayMs: 1_500 });
  log(`Wix mock listening on ${mock.url}`);

  // detached puts the server in its own process group, so stopping it also stops the next start
  // grandchild. Killing only the immediate child leaves that grandchild holding the port.
  const server: ChildProcess = spawn("npx", ["tsx", "e2e-batch08/server.mts", "perf", "start"], {
    env: { ...process.env, WIX_MOCK_URL: mock.url, NEXT_DIST_DIR: ".next-perf" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const stopServer = () => {
    if (server.pid === undefined) return;
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  };
  process.on("SIGINT", () => {
    stopServer();
    process.exit(130);
  });
  server.stdout?.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr?.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

  const sampler = new BackendSampler("perf");
  let browser: Browser | undefined;
  const results: PageResult[] = [];
  const scenarioResults: Array<Record<string, unknown>> = [];
  const concurrencyResults: Array<Record<string, unknown>> = [];

  try {
    await waitForServer(ORIGIN);
    log(`Isolated server answering on ${ORIGIN}`);
    browser = await chromium.launch();

    const viewports = value("viewport", "desktop") === "both"
      ? [{ name: "desktop", viewport: { width: 1440, height: 900 } }, { name: "mobile", viewport: { width: 390, height: 844 } }]
      : value("viewport", "desktop") === "mobile"
        ? [{ name: "mobile", viewport: { width: 390, height: 844 } }]
        : [{ name: "desktop", viewport: { width: 1440, height: 900 } }];

    for (const view of viewports) {
      for (const page of PAGES) {
        const session = await openAs(browser, page.email, "perf", { viewport: view.viewport });
        try {
          await installObservers(session.page);
          const samples: Array<NavigationSample & { providerCalls: number; providerMs: number }> = [];
          for (let run = 0; run <= WARM_RUNS; run += 1) {
            mock.reset();
            const sample = await measureNavigation(session.page, `${ORIGIN}${page.path}`, page.primary);
            const provider = mock.summary();
            samples.push({ ...sample, providerCalls: provider.calls, providerMs: provider.totalDurationMs });
          }
          const [cold, ...warm] = samples;
          results.push({
            id: page.id,
            label: page.label,
            path: page.path,
            email: page.email,
            viewport: view.name,
            cold: cold ?? null,
            warm: warm.length
              ? {
                navigationMs: summarise(warm.map((s) => s.navigationMs)),
                primaryDataVisibleMs: summarise(warm.map((s) => s.primaryDataVisibleMs)),
                ttfbMs: summarise(warm.flatMap((s) => (s.ttfbMs === null ? [] : [s.ttfbMs]))),
                firstContentfulPaintMs: summarise(warm.flatMap((s) => (s.firstContentfulPaintMs === null ? [] : [s.firstContentfulPaintMs]))),
                providerCalls: summarise(warm.map((s) => s.providerCalls)),
                providerMs: summarise(warm.map((s) => s.providerMs)),
                cumulativeLayoutShift: warm[warm.length - 1]?.cumulativeLayoutShift ?? null,
                requestCount: warm[warm.length - 1]?.requestCount ?? null,
                transferredBytes: warm[warm.length - 1]?.transferredBytes ?? null,
              }
              : null,
          });
          log(`${view.name} ${page.label}: cold ${cold?.primaryDataVisibleMs}ms, warm p50 ${summarise(warm.map((s) => s.primaryDataVisibleMs))?.p50}ms`);
        } catch (error) {
          results.push({ id: page.id, label: page.label, path: page.path, email: page.email, viewport: view.name, cold: null, warm: null, note: `NOT MEASURED: ${error instanceof Error ? error.message.split("\n")[0] : "failed"}` });
          log(`${view.name} ${page.label}: NOT MEASURED`);
        } finally {
          await session.close();
        }
      }
    }

    // Wix scenarios, measured on the enquiries page because that is where provider reads happen.
    if (!flag("skip-scenarios")) {
      // `timeout` runs last: it holds sockets for 18 seconds, and a later scenario should not inherit
      // that even though the mock now destroys them.
      const ordered = [...WIX_MOCK_SCENARIOS].sort((a, b) => Number(a.id === "timeout") - Number(b.id === "timeout"));
      for (const scenario of ordered) {
        const session = await openAs(browser, "admin@example.invalid", "perf", { viewport: { width: 1440, height: 900 } });
        try {
          await fetch(`${mock.url}/__mock/scenario`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: scenario.id }) });
          mock.reset();
          // The page is measured to the point it responds and renders, then the state it reached is
          // recorded. Waiting for a table would measure the selector timeout rather than the server,
          // because several of these scenarios legitimately render "no enquiries are available".
          const started = Date.now();
          const response = await session.page.goto(`${ORIGIN}/enquiries`, { waitUntil: "domcontentloaded", timeout: 120_000 });
          const renderedMs = Date.now() - started;
          const serverMs = await session.page.evaluate(() => {
            const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
            return nav ? Math.round(nav.responseStart) : null;
          });
          const provider = mock.summary();
          const [table, emptyState, notice] = await Promise.all([
            session.page.locator("table").count(),
            session.page.locator("text=No enquiries are available").count(),
            session.page.locator("text=A Wix form could not be read").count(),
          ]);
          const rowText = await session.page.locator("text=matching enquir").first().textContent().catch(() => null);
          scenarioResults.push({
            scenario: scenario.id,
            description: scenario.description,
            status: response?.status() ?? null,
            serverMs,
            renderedMs,
            providerCalls: provider.calls,
            providerMs: provider.totalDurationMs,
            providerByPath: provider.byPath,
            state: table > 0 ? "list rendered" : emptyState > 0 ? "no enquiries available" : "unknown",
            rowCount: rowText?.trim() ?? null,
            sourceNoticeShown: notice > 0,
          });
          log(`scenario ${scenario.id}: server ${serverMs}ms, rendered ${renderedMs}ms, ${provider.calls} provider calls, ${table > 0 ? "list" : emptyState > 0 ? "empty state" : "unknown"}${notice > 0 ? " + failure notice" : ""}`);
        } finally {
          await session.close();
        }
      }
      await fetch(`${mock.url}/__mock/scenario`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "normal" }) });
    }

    // Controlled concurrency against the isolated server only.
    if (!flag("skip-concurrency")) {
      for (const sessions of [1, 5, 10]) {
        const opened = await Promise.all(
          Array.from({ length: sessions }, () => openAs(browser!, "admin@example.invalid", "perf", { viewport: { width: 1440, height: 900 } })),
        );
        try {
          // Warm the route once so compilation is not counted as contention.
          await Promise.all(opened.map((s) => s.page.goto(`${ORIGIN}/clients`, { waitUntil: "commit" })));
          sampler.start(40);
          const started = Date.now();
          const timings = await Promise.all(opened.map(async (s) => {
            const t = Date.now();
            await measureNavigation(s.page, `${ORIGIN}/analytics?client=${A}&website=${SITE_A}`, "h1", 90_000);
            return Date.now() - t;
          }));
          const wallMs = Date.now() - started;
          const backends = sampler.stop();
          concurrencyResults.push({
            sessions,
            wallMs,
            perSessionMs: summarise(timings),
            backends,
            note: "Pool limits were not changed. APP_POOL_OPTIONS.max is 8 per server process.",
          });
          log(`concurrency ${sessions}: wall ${wallMs}ms, per-session p50 ${summarise(timings)?.p50}ms, p95 ${summarise(timings)?.p95}ms, peak backends ${backends.peakTotal}`);
        } finally {
          await Promise.all(opened.map((s) => s.close()));
        }
      }
    }
  } finally {
    await browser?.close().catch(() => {});
    await sampler.close().catch(() => {});
    stopServer();
    await mock.stop();
    // Give the port a moment to come back, so a following run's pre-flight check is accurate.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  const report: BaselineReport = {
    generatedAt: new Date().toISOString(),
    suite: "perf",
    origin: ORIGIN,
    build: "production build (next start) from .next-perf",
    provider: "Wix reads served by the local mock. Real-provider measurements: NOT MEASURED, by design.",
    warmRuns: WARM_RUNS,
    databaseCounts: "NOT MEASURED per navigation. pg_stat_statements needs shared_preload_libraries, which the embedded server does not set, and pg_stat_database.xact_commit is flushed on a timer with a lag longer than any usable settle delay (measured: 50 statements gave a delta of 1, then the next window of 6 gave 52). Exact per-path query and round-trip counts come from npm run perf:query-counts.",
    pages: results,
    wixScenarios: scenarioResults,
    concurrency: concurrencyResults,
  };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/perf-baseline.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${OUT_DIR}/perf-baseline.md`, markdown(report));
  log(`\nWrote ${OUT_DIR}/perf-baseline.json and ${OUT_DIR}/perf-baseline.md`);
}

/** Renders a measurement, or NOT MEASURED without a stray unit after it. */
function cell(value: unknown, unit = ""): string {
  if (value === null || value === undefined) return "NOT MEASURED";
  return unit ? `${value} ${unit}` : String(value);
}

function markdown(report: BaselineReport): string {
  const lines: string[] = [];
  lines.push("# Signed-in performance baselines", "");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Suite: isolated \`perf\` · Origin: ${report.origin} · ${report.build}`);
  lines.push(`Warm runs per page: ${report.warmRuns}`, "");
  lines.push("Every figure comes from this isolated environment with synthetic fixtures. None of it describes a client result or production behaviour.", "");
  lines.push(`**Provider:** ${report.provider}`, "");
  lines.push(`**Database counts:** ${report.databaseCounts}`, "");

  lines.push("## Pages", "");
  lines.push("| Page | View | Cold data visible | Warm data visible p50 | Warm p95 | TTFB p50 | FCP p50 | Provider calls | Provider ms | CLS | Requests |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const page of report.pages) {
    if (page.note) {
      lines.push(`| ${page.label} | ${page.viewport} | ${page.note} | | | | | | | | |`);
      continue;
    }
    const w = page.warm;
    lines.push(`| ${page.label} | ${page.viewport} | ${cell(page.cold?.primaryDataVisibleMs, "ms")} | ${cell(w?.primaryDataVisibleMs?.p50, "ms")} | ${cell(w?.primaryDataVisibleMs?.p95, "ms")} | ${cell(w?.ttfbMs?.p50, "ms")} | ${cell(w?.firstContentfulPaintMs?.p50, "ms")} | ${cell(w?.providerCalls?.p50)} | ${cell(w?.providerMs?.p50)} | ${cell(w?.cumulativeLayoutShift)} | ${cell(w?.requestCount)} |`);
  }

  if (report.wixScenarios.length) {
    lines.push("", "## Wix provider scenarios, measured on /enquiries", "");
    lines.push("| Scenario | Server ms | Rendered ms | Provider calls | Provider ms | Page state | Rows | Failure notice |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const row of report.wixScenarios) {
      lines.push(`| ${row.scenario} | ${cell(row.serverMs)} | ${cell(row.renderedMs)} | ${cell(row.providerCalls)} | ${cell(row.providerMs)} | ${cell(row.state)} | ${cell(row.rowCount ?? "")} | ${row.sourceNoticeShown ? "yes" : "no"} |`);
    }
    lines.push("", "Server ms is the browser's `responseStart`: the time the server took. A scenario that renders \"no enquiries available\" is not slow — the provider failed and the page said so.");
  }

  if (report.concurrency.length) {
    lines.push("", "## Controlled concurrency on /analytics, isolated server only", "");
    lines.push("| Sessions | Wall | Per-session p50 | Per-session p95 | Peak cg_app connections | Peak active | Peak idle in transaction |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const row of report.concurrency) {
      const backends = row.backends as { peakTotal?: number | null; peakActive?: number | null; peakIdleInTransaction?: number | null } | undefined;
      lines.push(`| ${row.sessions} | ${cell(row.wallMs, "ms")} | ${cell((row.perSessionMs as { p50?: number } | null)?.p50, "ms")} | ${cell((row.perSessionMs as { p95?: number } | null)?.p95, "ms")} | ${cell(backends?.peakTotal)} | ${cell(backends?.peakActive)} | ${cell(backends?.peakIdleInTransaction)} |`);
    }
    lines.push("", "Pool limits were not changed for these runs.");
  }

  lines.push("");
  return lines.join("\n");
}

await main();
