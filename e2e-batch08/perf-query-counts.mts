/**
 * Statement-level query counts for the hot server paths, measured against the isolated `perf` suite.
 *
 * The browser baseline can only count transactions, because pg_stat_statements needs
 * shared_preload_libraries and the embedded server does not set it. This script measures statements
 * directly instead: it calls the real service functions inside the real `withContext` transaction with
 * the `pg` client's `query` method wrapped, so the count is exact rather than estimated.
 *
 * Read-only, and only ever against the isolated suite database.
 *
 * Usage: npx tsx e2e-batch08/perf-query-counts.mts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { adminUrl, appUrl, suiteTargets } from "./targets.ts";

const targets = suiteTargets("perf");
process.env.DATABASE_URL = appUrl(targets.platformDb);
process.env.DATABASE_ADMIN_URL = adminUrl(targets.platformDb);

const db = await import("../packages/db/src/index.ts");
const { FIXTURE_CLIENTS, FIXTURE_WEBSITES, fixtureWindows, anchorDateSgt } = await import("../packages/db/src/testing/perf-fixture.ts");

const CLIENT = FIXTURE_CLIENTS.a.id;
const WEBSITE = FIXTURE_WEBSITES.aProduction.id;
const windows = fixtureWindows(anchorDateSgt());

const staff = await db.withContext({ kind: "service" }, (client) => db.getActiveStaffByEmail(client, "admin@example.invalid"));
if (!staff) throw new Error("The isolated suite has no seeded administrator. Run npm run perf:prepare.");
const ctx = { kind: "staff" as const, userId: staff.id, role: staff.platform_role };

function counting(client: { query: (...args: never[]) => unknown }): () => number {
  let n = 0;
  const original = client.query.bind(client);
  (client as { query: unknown }).query = (...args: never[]) => {
    n += 1;
    return original(...args);
  };
  return () => n;
}

interface Row { path: string; driverQueries: number; roundTrips: number; p50ms: number; note?: string }
const rows: Row[] = [];

async function measure(path: string, work: (client: never) => Promise<string | void>, reps = 5): Promise<void> {
  const times: number[] = [];
  let queries = 0;
  let note: string | undefined;
  for (let run = 0; run <= reps; run += 1) {
    const started = performance.now();
    const outcome = await db.withContext(ctx, async (client) => {
      const count = counting(client as never);
      const result = await work(client as never);
      return { queries: count(), result };
    });
    if (run > 0) times.push(performance.now() - started);
    queries = outcome.queries;
    if (typeof outcome.result === "string") note = outcome.result;
  }
  times.sort((a, b) => a - b);
  rows.push({ path, driverQueries: queries, roundTrips: queries + 2, p50ms: Math.round(times[Math.floor(times.length / 2)]!), note });
  console.log(`${path.padEnd(46)} queries=${String(queries).padStart(2)} roundTrips=${String(queries + 2).padStart(2)} p50=${rows[rows.length - 1]!.p50ms}ms${note ? `  ${note}` : ""}`);
}

await measure("app layout: shell clients + website ids", async (client) => {
  await db.listShellClients(client);
  await db.listActiveWebsiteClientIds(client);
});

await measure("getAccess: staff by email + memberships", async (client) => {
  const found = await db.getActiveStaffByEmail(client, "admin@example.invalid");
  await db.resolveAccessForStaff(client, found!);
});

await measure("loadSiteView: client and site selection", async (client) => {
  const clients = await db.listClients(client);
  new Set(await db.listSnapshotClientIds(client, "sessions"));
  const snapshots = await db.listSnapshots(client, { clientId: CLIENT, limit: 20000 });
  await db.listWebsites(client, CLIENT);
  return `clients=${clients.length} snapshotRows=${snapshots.length}`;
});

await measure("loadLiveBundle GA4: published report chain", async (client) => {
  await db.listConnections(client, CLIENT);
  const current = windows.last30!;
  const previous = windows.last30Previous!;
  const series = await db.dailySessionSeriesWithPeriod(client, { clientId: CLIENT, websiteId: WEBSITE, templateKey: "ga4.traffic_daily", metric: "sessions", start: current.start, end: current.end });
  await db.dailySessionSeriesWithPeriod(client, { clientId: CLIENT, websiteId: WEBSITE, templateKey: "ga4.traffic_daily", metric: "sessions", start: previous.start, end: previous.end });
  for (const templateKey of ["ga4.traffic_range", "ga4.acquisition", "ga4.landing", "ga4.device", "ga4.country"]) {
    await db.publishedReport(client, { clientId: CLIENT, websiteId: WEBSITE, templateKey, start: current.start, end: current.end });
  }
  await db.publishedReport(client, { clientId: CLIENT, websiteId: WEBSITE, templateKey: "ga4.traffic_range", start: previous.start, end: previous.end });
  await db.publishedReport(client, { clientId: CLIENT, websiteId: WEBSITE, templateKey: "ga4.acquisition", start: previous.start, end: previous.end });
  return `sessions=${series.period.state}`;
});

await measure("loadSeoOverview: context + website bundle", async (client) => {
  await db.listShellClients(client);
  const sites = await db.listActiveWebsiteSummaries(client);
  const pages = await db.listSeoPages(client, { clientId: CLIENT });
  await db.listSeoChanges(client, { clientId: CLIENT, limit: 100 });
  const tasks = await db.listTasks(client, { clientId: CLIENT, statuses: ["open", "in_progress", "waiting", "blocked", "completed", "cancelled"], limit: 300 });
  await db.listSeoPageSettings(client, { websiteId: WEBSITE });
  await db.listSeoRedirects(client, { clientId: CLIENT, websiteId: WEBSITE, includeInactive: true });
  await db.listSeoBusinessProfiles(client, CLIENT);
  await db.getGoogleSiteVerification(client, WEBSITE);
  await db.listConnections(client, CLIENT);
  await db.hasActiveSeoSiteToken(client, WEBSITE);
  return `sites=${sites.length} seoPages=${pages.length} tasksLoaded=${tasks.length}`;
});

await measure("composeReport: single period", async (client) => {
  const composed = await db.composeReport(client, {
    clientId: CLIENT, websiteId: WEBSITE,
    periodStart: windows.last30!.start, periodEnd: windows.last30!.end,
    comparisonStart: null, comparisonEnd: null,
    items: ["performance_overview", "key_insights"],
  });
  return `blocks=${composed.blocks.length}`;
}, 3);

await measure("composeReport: with a comparison period", async (client) => {
  const composed = await db.composeReport(client, {
    clientId: CLIENT, websiteId: WEBSITE,
    periodStart: windows.last30!.start, periodEnd: windows.last30!.end,
    comparisonStart: windows.last30Previous!.start, comparisonEnd: windows.last30Previous!.end,
    items: ["performance_overview", "key_insights"],
  });
  return `blocks=${composed.blocks.length}`;
}, 3);

await measure("listTasks: client task list", async (client) => {
  const tasks = await db.listTasks(client, { clientId: CLIENT, statuses: ["open", "in_progress", "waiting"], limit: 500 });
  return `rows=${tasks.length}`;
});

await db.closePools();

const report = {
  generatedAt: new Date().toISOString(),
  suite: "perf",
  database: targets.platformDb,
  anchorDate: anchorDateSgt(),
  method: "Real service functions inside withContext, with the pg client's query method wrapped. Round trips = driver queries + 2 for begin/set_config and commit.",
  note: "Local embedded PostgreSQL. Times are not production latency; the query and round-trip counts are the comparable figures.",
  paths: rows,
};
await mkdir("docs/testing/baselines", { recursive: true });
await writeFile("docs/testing/baselines/perf-query-counts.json", `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  "# Query and round-trip counts per server path",
  "",
  `Generated: ${report.generatedAt} · Suite: isolated \`perf\` · Database: \`${report.database}\``,
  "",
  report.method,
  "",
  report.note,
  "",
  "| Server path | Driver queries | Round trips | p50 (local) | Observed |",
  "| --- | --- | --- | --- | --- |",
  ...rows.map((row) => `| ${row.path} | ${row.driverQueries} | ${row.roundTrips} | ${row.p50ms} ms | ${row.note ?? ""} |`),
  "",
];
await writeFile("docs/testing/baselines/perf-query-counts.md", lines.join("\n"));
console.log("\nWrote docs/testing/baselines/perf-query-counts.json and .md");
