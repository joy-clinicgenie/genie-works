import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { AiAccessFetchError, type TextFetcher, type TextFetchResult } from "../src/services/ai-access";
import { createSeoPage } from "../src/services/seo";
import {
  checkSitemap,
  evaluateRedirect,
  finishSiteCheckRun,
  listRedirectChecks,
  localRequestPath,
  parseRobotsFile,
  parseSitemapXml,
  readLatestRobots,
  readRobotsFile,
  readSiteChecks,
  readSitemapStatus,
  recordRedirectCheck,
  recordRobotsCheck,
  recordSitemapCheck,
  runSiteChecks,
  siteCheckTargets,
  sitemapTarget,
  startSiteCheckRun,
  traceRedirects,
} from "../src/services/technical-seo";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const SITE = "https://check.example.invalid";

type Served = Partial<TextFetchResult> & { status: number } | { error: string };

/** A fixture website: each URL serves a fixed response or a fetch error. Unknown URLs are 404. */
function fixture(pages: Record<string, Served>): TextFetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(url);
    const page = pages[url] ?? { status: 404 };
    if ("error" in page) throw new AiAccessFetchError(page.error);
    return { contentType: "text/html", body: "", bytes: 0, finalUrl: url, location: null, ...page };
  }) as TextFetcher & { calls: string[] };
  fetcher.calls = calls;
  return fetcher;
}

const urlset = (...paths: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${SITE}${path}</loc></url>`).join("")}</urlset>`;
const index = (...files: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.map((file) => `<sitemap><loc>${SITE}${file}</loc></sitemap>`).join("")}</sitemapindex>`;
const xml = (body: string): Served => ({ status: 200, contentType: "application/xml", body });

describe("sitemaps (SEO-04.1)", () => {
  it("passes a URL list and an index, and an unreadable child makes the index incomplete", async () => {
    const list = await checkSitemap(fixture({ [`${SITE}/sitemap.xml`]: xml(urlset("/", "/services/consultation")) }), `${SITE}/sitemap.xml`);
    expect(list).toMatchObject({ result: "passed", kind: "urlset", urlCount: 2, httpStatus: 200, finalUrl: `${SITE}/sitemap.xml`, errorCode: null });

    const goodIndex = fixture({
      [`${SITE}/sitemap.xml`]: xml(index("/pages.xml", "/blog.xml")),
      [`${SITE}/pages.xml`]: xml(urlset("/", "/about")),
      [`${SITE}/blog.xml`]: xml(urlset("/blog/a")),
    });
    expect(await checkSitemap(goodIndex, `${SITE}/sitemap.xml`)).toMatchObject({ result: "passed", kind: "sitemapindex", urlCount: 3 });

    const brokenIndex = fixture({
      [`${SITE}/sitemap.xml`]: xml(index("/pages.xml", "/missing.xml", "/nested.xml", "/old.xml.gz")),
      [`${SITE}/pages.xml`]: xml(urlset("/", "/about")),
      [`${SITE}/nested.xml`]: xml(index("/pages.xml")),
    });
    const broken = await checkSitemap(brokenIndex, `${SITE}/sitemap.xml`);
    expect(broken.result).toBe("incomplete");
    expect(broken.errorCode).toBe("children_unread");
    expect(broken.children).toEqual([
      { url: `${SITE}/pages.xml`, result: "read", reason: null, httpStatus: 200, urlCount: 2 },
      { url: `${SITE}/missing.xml`, result: "failed", reason: "http_404", httpStatus: 404, urlCount: 0 },
      { url: `${SITE}/nested.xml`, result: "skipped", reason: "nested_index", httpStatus: 200, urlCount: 0 },
      { url: `${SITE}/old.xml.gz`, result: "skipped", reason: "compressed", httpStatus: null, urlCount: 0 },
    ]);
    expect(brokenIndex.calls).not.toContain(`${SITE}/old.xml.gz`);
  });

  it("rejects malformed files, relative or foreign locations, and a missing sitemap", async () => {
    expect(parseSitemapXml("<html><body>Not a sitemap</body></html>").error).toBe("not_sitemap");
    expect(parseSitemapXml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE}/</loc></url>`).error).toBe("invalid_xml");
    expect(parseSitemapXml(`<urlset><url><lastmod>2026-01-01</lastmod></url></urlset>`).error).toBe("missing_loc");
    expect(parseSitemapXml(`<urlset><url><loc>${SITE}/a?x=1&amp;y=2</loc></url></urlset>`).locs).toEqual([`${SITE}/a?x=1&y=2`]);
    const foreign = await checkSitemap(fixture({ [`${SITE}/sitemap.xml`]: xml(`<urlset><url><loc>https://other.example.test/</loc></url></urlset>`) }), `${SITE}/sitemap.xml`);
    expect(foreign).toMatchObject({ result: "failed", errorCode: "other_host" });
    const relative = await checkSitemap(fixture({ [`${SITE}/sitemap.xml`]: xml(`<urlset><url><loc>/a</loc></url></urlset>`) }), `${SITE}/sitemap.xml`);
    expect(relative.errorCode).toBe("relative_loc");
    expect(await checkSitemap(fixture({}), `${SITE}/sitemap.xml`)).toMatchObject({ result: "failed", errorCode: "http_404", httpStatus: 404 });
    expect(await checkSitemap(fixture({ [`${SITE}/sitemap.xml`]: { error: "timeout" } }), `${SITE}/sitemap.xml`)).toMatchObject({ result: "failed", errorCode: "timeout" });
  });

  it("keeps the latest full pass beside a newer incomplete attempt", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const pass = await checkSitemap(fixture({ [`${SITE}/sitemap.xml`]: xml(urlset("/")) }), `${SITE}/sitemap.xml`);
      const later = await checkSitemap(fixture({ [`${SITE}/sitemap.xml`]: xml(index("/missing.xml")) }), `${SITE}/sitemap.xml`);
      await recordSitemapCheck(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, source: "default", reading: pass, actorUserId: admin.id, now: new Date("2026-11-19T01:00:00Z") });
      await recordSitemapCheck(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, source: "default", reading: later, actorUserId: admin.id, now: new Date("2026-11-20T01:00:00Z") });
      await applyContext(db, staffCtx(admin));
      const status = await readSitemapStatus(db, clinic.websiteId);
      expect(status.latestPass).toMatchObject({ result: "passed", urlCount: 1, checkedAt: new Date("2026-11-19T01:00:00Z") });
      expect(status.newerAttempt).toMatchObject({ result: "incomplete", checkedAt: new Date("2026-11-20T01:00:00Z") });
      expect(status.newerAttempt?.children[0]).toMatchObject({ url: `${SITE}/missing.xml`, result: "failed", reason: "http_404" });
    });
  });
});

describe("robots.txt (SEO-04.2)", () => {
  const ROBOTS = [
    "# Fixture",
    "User-agent: GPTBot",
    "Disallow: /",
    "",
    "User-agent: *",
    "Disallow: /admin/",
    "Allow: /",
    "",
    `Sitemap: ${SITE}/sitemap-index.xml`,
  ].join("\n");

  it("names the blocked crawler and the declared sitemap", async () => {
    const reading = await readRobotsFile(fixture({ [`${SITE}/robots.txt`]: { status: 200, contentType: "text/plain", body: ROBOTS } }), SITE);
    expect(reading).toMatchObject({ availability: "available", httpStatus: 200, robotsUrl: `${SITE}/robots.txt`, errorCode: null });
    const parsed = parseRobotsFile(reading.body!);
    expect(parsed.sitemaps).toEqual([`${SITE}/sitemap-index.xml`]);
    expect(parsed.groups.find((group) => group.broad.length > 0)).toMatchObject({ agents: ["gptbot"], broad: ["/"] });
    expect(parsed.groups.find((group) => group.agents.includes("*"))?.broad).toEqual([]);
    expect(sitemapTarget(SITE, parsed)).toEqual({ url: `${SITE}/sitemap-index.xml`, source: "robots" });
    expect(sitemapTarget(SITE, parseRobotsFile("Sitemap: https://other.example.test/s.xml"))).toEqual({ url: `${SITE}/sitemap.xml`, source: "default" });
  });

  it("shows a failed fetch as unavailable and a missing file as no restrictions", async () => {
    expect(await readRobotsFile(fixture({ [`${SITE}/robots.txt`]: { error: "dns_failed" } }), SITE)).toMatchObject({ availability: "unavailable", errorCode: "dns_failed", body: null });
    expect(await readRobotsFile(fixture({ [`${SITE}/robots.txt`]: { status: 503 } }), SITE)).toMatchObject({ availability: "unavailable", errorCode: "http_503" });
    expect(await readRobotsFile(fixture({ [`${SITE}/robots.txt`]: { status: 429 } }), SITE)).toMatchObject({ availability: "unavailable", errorCode: "http_429" });
    expect(await readRobotsFile(fixture({}), SITE)).toMatchObject({ availability: "not_found", errorCode: "http_404" });

    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      await recordRobotsCheck(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, reading: await readRobotsFile(fixture({ [`${SITE}/robots.txt`]: { status: 200, contentType: "text/plain", body: ROBOTS } }), SITE), actorUserId: admin.id, now: new Date("2026-11-19T01:00:00Z") });
      await recordRobotsCheck(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, reading: await readRobotsFile(fixture({ [`${SITE}/robots.txt`]: { error: "timeout" } }), SITE), actorUserId: admin.id, now: new Date("2026-11-20T01:00:00Z") });
      await applyContext(db, staffCtx(admin));
      expect(await readLatestRobots(db, clinic.websiteId)).toMatchObject({ availability: "unavailable", errorCode: "timeout", parsed: null });
    });
  });
});

describe("website checks (SEO-04.3)", () => {
  const OK = (title: string): Served => ({ status: 200, contentType: "text/html; charset=utf-8", body: `<html><head><title>${title}</title><meta name="description" content="About ${title}"></head></html>` });
  const NO_DESCRIPTION: Served = { status: 200, contentType: "text/html", body: "<html><head><title>Consultation</title></head></html>" };

  it("keeps one open defect across two runs, lists the unreachable page and counts each run", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      for (const path of ["/services/consultation", "/unreachable"]) {
        await createSeoPage(db, clinic.clientId, { websiteId: clinic.websiteId, pagePath: path, pageTitle: path, primaryKeyword: null, secondaryKeywords: [], searchIntent: null, contentStatus: "published", ownerUserId: null, lastReviewedOn: null, nextReviewOn: null, mappingFlag: "none", flagNote: null, notes: null }, admin.id);
      }
      const targets = await siteCheckTargets(db, clinic.websiteId, SITE);
      expect(targets.map((target) => target.pagePath)).toEqual(["/", "/services/consultation", "/unreachable"]);
      const site = fixture({ [`${SITE}/`]: OK("Home"), [`${SITE}/services/consultation`]: NO_DESCRIPTION, [`${SITE}/unreachable`]: { error: "timeout" } });

      for (const at of ["2026-11-19T01:00:00Z", "2026-11-20T01:00:00Z"]) {
        const runId = (await startSiteCheckRun(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, actorUserId: admin.id, now: new Date(at) }))!;
        // Only one run per website at a time.
        expect(await startSiteCheckRun(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, actorUserId: admin.id, now: new Date(at) })).toBeNull();
        await finishSiteCheckRun(db, { runId, clientId: clinic.clientId, websiteId: clinic.websiteId, results: await runSiteChecks(site, targets), now: new Date(at) });
      }

      await applyContext(db, staffCtx(admin));
      const view = await readSiteChecks(db, clinic.websiteId);
      expect(view.running).toBeNull();
      expect(view.lastCompleted).toMatchObject({ attempted: 3, completed: 2, failed: 1, skipped: 0, finishedAt: new Date("2026-11-20T01:00:00Z") });
      expect(view.items.find((item) => item.pagePath === "/unreachable")).toMatchObject({ outcome: "failed", reason: "timeout", url: `${SITE}/unreachable` });
      expect(view.openFindings).toHaveLength(1);
      expect(view.openFindings[0]).toMatchObject({ pagePath: "/services/consultation", checkType: "missing_description", seenCount: 2, firstSeenAt: new Date("2026-11-19T01:00:00Z"), lastSeenAt: new Date("2026-11-20T01:00:00Z"), issueId: expect.any(String) });

      // Fixing the page closes the finding; an unreachable page keeps nothing open or closed by guesswork.
      await applyContext(db, SERVICE);
      const fixed = fixture({ [`${SITE}/`]: OK("Home"), [`${SITE}/services/consultation`]: OK("Consultation"), [`${SITE}/unreachable`]: { error: "timeout" } });
      const third = (await startSiteCheckRun(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, actorUserId: admin.id, now: new Date("2026-11-21T01:00:00Z") }))!;
      await finishSiteCheckRun(db, { runId: third, clientId: clinic.clientId, websiteId: clinic.websiteId, results: await runSiteChecks(fixed, targets), now: new Date("2026-11-21T01:00:00Z") });
      await applyContext(db, staffCtx(admin));
      expect((await readSiteChecks(db, clinic.websiteId)).openFindings).toEqual([]);

      // Another clinic's staff see no run, item or finding.
      await applyContext(db, staffCtx(specB));
      expect(await readSiteChecks(db, clinic.websiteId)).toEqual({ running: null, lastCompleted: null, items: [], openFindings: [] });
    });
  });

  it("records an HTTP error as a finding and skips targets over the limit or the time budget", async () => {
    const site = fixture({ [`${SITE}/`]: OK("Home"), [`${SITE}/gone`]: { status: 404 } });
    const results = await runSiteChecks(site, [
      { pagePath: "/", url: `${SITE}/` },
      { pagePath: "/gone", url: `${SITE}/gone` },
      { pagePath: "/no-address", url: null },
      { pagePath: "/over", url: `${SITE}/over` },
    ], { limit: 3 });
    expect(results.map((item) => [item.pagePath, item.outcome, item.reason])).toEqual([
      ["/", "completed", null],
      ["/gone", "completed", null],
      ["/no-address", "skipped", "missing_url"],
      ["/over", "skipped", "limit"],
    ]);
    expect(results[1]!.findings).toEqual([{ checkType: "http_error", detail: "HTTP 404" }]);
    let now = 0;
    const late = await runSiteChecks(site, [{ pagePath: "/", url: `${SITE}/` }, { pagePath: "/gone", url: `${SITE}/gone` }], { budgetMs: 10, concurrency: 1, clock: () => (now += 20) });
    expect(late.map((item) => item.reason)).toEqual(["time_budget", "time_budget"]);
  });
});

describe("redirect checks (SEO-04.4)", () => {
  const redirect = (status: number, location: string): Served => ({ status, location, contentType: null });

  it("passes only a redirect that ends at the expected page, and names the failing hop", async () => {
    const site = fixture({
      [`${SITE}/old-consultation`]: redirect(301, "/services/new-consultation"),
      [`${SITE}/services/new-consultation`]: { status: 200 },
      [`${SITE}/loop-a`]: redirect(301, "/loop-b"),
      [`${SITE}/loop-b`]: redirect(301, `${SITE}/loop-a`),
      [`${SITE}/old-pricing`]: redirect(301, "/contact"),
      [`${SITE}/contact`]: { status: 200 },
      [`${SITE}/still-here`]: { status: 200 },
      [`${SITE}/away`]: redirect(301, "https://other.example.test/new"),
      [`${SITE}/to-missing`]: redirect(308, "/deleted"),
    });
    const check = async (path: string, expected: string) => {
      const trace = await traceRedirects(site, `${SITE}${path}`);
      return { trace, evaluation: evaluateRedirect(trace, expected) };
    };

    const ok = await check("/old-consultation", "/services/new-consultation");
    expect(ok.evaluation).toMatchObject({ result: "passed", failure: null, finalStatus: 200, finalUrl: `${SITE}/services/new-consultation`, temporaryHops: 0 });
    expect(ok.trace.hops).toEqual([
      { url: `${SITE}/old-consultation`, status: 301, location: "/services/new-consultation", error: null },
      { url: `${SITE}/services/new-consultation`, status: 200, location: null, error: null },
    ]);

    const loop = await check("/loop-a", "/services/new-consultation");
    expect(loop.evaluation).toMatchObject({ result: "failed", failure: "loop", failingHop: 1 });
    expect(loop.trace.hops[1]).toMatchObject({ url: `${SITE}/loop-b`, location: `${SITE}/loop-a` });

    const wrong = await check("/old-pricing", "/services/new-consultation");
    expect(wrong.evaluation).toMatchObject({ result: "failed", failure: "wrong_destination", failingHop: 0, finalUrl: `${SITE}/contact` });

    expect((await check("/still-here", "/services/new-consultation")).evaluation).toMatchObject({ failure: "missing_redirect", failingHop: 0, finalStatus: 200 });
    expect((await check("/away", "/new")).evaluation).toMatchObject({ failure: "left_site", failingHop: 0 });
    expect((await check("/to-missing", "/deleted")).evaluation).toMatchObject({ failure: "final_error", failingHop: 1, finalStatus: 404 });
    expect((await traceRedirects(fixture({ [`${SITE}/down`]: { error: "dns_failed" } }), `${SITE}/down`)).stop).toBe("error");
    expect(localRequestPath("https://other.example.test/x")).toBeNull();
    expect(localRequestPath("/old?ref=1")).toBe("/old?ref=1");
  });

  it("stops after the hop limit and keeps the latest result per old path", async () => {
    const chain: Record<string, Served> = {};
    for (let i = 0; i < 12; i += 1) chain[`${SITE}/c${i}`] = redirect(301, `/c${i + 1}`);
    expect((await traceRedirects(fixture(chain), `${SITE}/c0`)).hops).toHaveLength(10);
    expect(evaluateRedirect(await traceRedirects(fixture(chain), `${SITE}/c0`), "/c12")).toMatchObject({ failure: "too_many_hops", failingHop: 9 });

    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const site = fixture({ [`${SITE}/old`]: redirect(301, "/wrong"), [`${SITE}/wrong`]: { status: 200 } });
      const first = await traceRedirects(site, `${SITE}/old`);
      await recordRedirectCheck(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, sourcePath: "/old", expectedPath: "/new", trace: first, evaluation: evaluateRedirect(first, "/new"), actorUserId: admin.id, now: new Date("2026-11-19T01:00:00Z") });
      const fixedSite = fixture({ [`${SITE}/old`]: redirect(301, "/new"), [`${SITE}/new`]: { status: 200 } });
      const second = await traceRedirects(fixedSite, `${SITE}/old`);
      await recordRedirectCheck(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, sourcePath: "/old", expectedPath: "/new", trace: second, evaluation: evaluateRedirect(second, "/new"), actorUserId: admin.id, now: new Date("2026-11-20T01:00:00Z") });
      await applyContext(db, staffCtx(admin));
      expect(await listRedirectChecks(db, clinic.websiteId)).toEqual([expect.objectContaining({ sourcePath: "/old", result: "passed", checkedAt: new Date("2026-11-20T01:00:00Z") })]);
    });
  });
});
