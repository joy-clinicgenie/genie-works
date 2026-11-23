import { afterAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { sealedToken } from "../src/analytics/sync";
import { AiAccessFetchError, type TextFetcher, type TextFetchResult } from "../src/services/ai-access";
import { createSeoPage } from "../src/services/seo";
import { finishSiteCheckRun, runSiteChecks, siteCheckTargets, startSiteCheckRun } from "../src/services/technical-seo";
import { listSeoIssues, moveSeoIssue, verifySeoIssue } from "../src/services/seo-workflow";
import { createCrawlerSource, crawlerTokenHash, ingestCrawlerBatch, latestCrawlsByPlatform, loadAiActivity, recordAnswerTest } from "../src/services/ai-visibility";
import { compareSearchRows, countOpenSeoIssues, loadAiReport, loadSearchChanges, loadSearchReport, loadWorkReport, prepareSearchReport } from "../src/services/seo-reports";
import { saveSeoPageSetting } from "../src/services/seo-soft-launch";
import { todaySgt, addDays } from "../src/services/dates";
import { fakeSearchConsole, runQueuedSearchJobs } from "../src/testing/search-console-fixture";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const SITE = "https://check.example.invalid";

async function connectSearch(db: pg.PoolClient, ids: { clientId: string; websiteId: string }, actorUserId: string) {
  await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
  const token = sealedToken({ accessToken: "fixture", expiresAt: "2100-01-01T00:00:00.000Z" });
  await saveConnection(db, { ...ids, provider: "gsc", externalPropertyId: "sc-domain:check.example.invalid", streamOrSiteRef: null, providerTimezone: "America/Los_Angeles", tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId });
}

describe("Google Search Performance report (SEO-07.1)", () => {
  it("orders pages by clicks and follows the selected period for totals, rows and the comparison", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const ids = { clientId: clinic.clientId, websiteId: clinic.websiteId };
      await connectSearch(db, ids, admin.id);
      const fake = fakeSearchConsole(SITE);

      let report = await loadSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-07", preset: false });
      expect(report.connection.state).toBe("connected");
      expect(report.totals).toBeNull();
      expect(report.pages.status).toBe("not_stored");

      expect(await prepareSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-07", refresh: false })).toBe(5);
      expect((await loadSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-07", preset: false })).pages.status).toBe("preparing");
      expect(await runQueuedSearchJobs(db, clinic.websiteId, fake, new Date("2099-01-01T00:00:00Z"))).toBe(5);

      report = await loadSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-07", preset: false });
      expect(report.window).toEqual({ start: "2026-10-01", end: "2026-10-07" });
      expect(report.totals).toMatchObject({ clicks: 98, impressions: 1960, ctr: 0.05, position: 8.25 });
      expect(report.pages.status === "available" && report.pages.rows.map((row) => row.key)).toEqual(["/services/consultation", "/", "/contact"]);
      expect(report.queries.status === "available" && report.queries.rows[0]).toMatchObject({ key: "fictional clinic", clicks: 42 });
      expect(report.daily.status === "available" && report.daily.rows.map((row) => row.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]);
      expect(report.previous).toMatchObject({ window: { start: "2026-09-24", end: "2026-09-30" }, totals: { clicks: 98 } });
      expect(report.latestDate).toBe("2026-10-07");
      // Nothing more to queue; a refresh queues the five reports again.
      expect(await prepareSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-07", refresh: false })).toBe(0);

      await prepareSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-14", refresh: false });
      await runQueuedSearchJobs(db, clinic.websiteId, fake, new Date("2099-01-01T01:00:00Z"));
      report = await loadSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-14", preset: false });
      expect(report.totals?.clicks).toBe(196);
      expect(report.pages.status === "available" && report.pages.rows[0]).toMatchObject({ key: "/services/consultation", clicks: 126 });
      expect(report.daily.status === "available" && report.daily.rows).toHaveLength(14);

      // Another environment of the website has none of it.
      expect((await loadSearchReport(db, { clientId: clinic.clientId, websiteId: clinic.stagingId, start: "2026-10-01", end: "2026-10-07", preset: false })).totals).toBeNull();
    });
  });

  it("shows a missing comparison as unavailable and does not prepare without a connection", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const ids = { clientId: clinic.clientId, websiteId: clinic.websiteId };
      expect(await prepareSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-07", refresh: false })).toBe(0);
      expect((await loadSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-07", preset: false })).connection.state).toBe("not_connected");
      await connectSearch(db, ids, admin.id);
      await prepareSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-07", refresh: false });
      // The previous window's job fails, so only the selected window is stored.
      await db.query("update analytics_jobs set state = 'cancelled' where website_id = $1 and start_date = '2026-09-24'", [clinic.websiteId]);
      await runQueuedSearchJobs(db, clinic.websiteId, fakeSearchConsole(SITE), new Date("2099-01-01T00:00:00Z"));
      const report = await loadSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-07", preset: false });
      expect(report.totals?.clicks).toBe(98);
      expect(report.previous).toBeNull();
    });
  });
});

type Served = (Partial<TextFetchResult> & { status: number }) | { error: string };
function site(pages: Record<string, Served>): TextFetcher {
  return async (url) => {
    const page = pages[url] ?? { status: 404 };
    if ("error" in page) throw new AiAccessFetchError(page.error);
    return { contentType: "text/html", body: "", bytes: 0, finalUrl: url, ...page };
  };
}
const html = (title: string, description?: string): Served => ({ status: 200, contentType: "text/html", body: `<html><head><title>${title}</title>${description ? `<meta name="description" content="${description}">` : ""}</head></html>` });

describe("SEO Work report (SEO-07.2)", () => {
  it("counts a resolution in its period and keeps today's open count the same for every period", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const ids = { clientId: clinic.clientId, websiteId: clinic.websiteId };
      for (const path of ["/services/consultation", "/contact"]) {
        await createSeoPage(db, clinic.clientId, { websiteId: clinic.websiteId, pagePath: path, pageTitle: "Page", primaryKeyword: null, secondaryKeywords: [], searchIntent: null, contentStatus: "published", ownerUserId: null, lastReviewedOn: null, nextReviewOn: null, mappingFlag: "none", flagNote: null, notes: null }, admin.id);
      }
      const check = async (pages: TextFetcher) => {
        const runId = (await startSiteCheckRun(db, { ...ids, actorUserId: admin.id }))!;
        await finishSiteCheckRun(db, { runId, ...ids, results: await runSiteChecks(pages, await siteCheckTargets(db, clinic.websiteId, SITE)) });
      };
      await check(site({ [`${SITE}/`]: html("Home", "Home"), [`${SITE}/services/consultation`]: html("Consultation"), [`${SITE}/contact`]: html("Contact") }));
      expect(await countOpenSeoIssues(db, clinic.websiteId)).toBe(2);

      const consultation = (await listSeoIssues(db, clinic.websiteId)).find((issue) => issue.pagePath === "/services/consultation")!;
      await moveSeoIssue(db, { websiteId: clinic.websiteId, issueId: consultation.id, to: "resolved_pending_verification", note: "Description added.", actorUserId: admin.id });
      await verifySeoIssue(db, { websiteId: clinic.websiteId, issueId: consultation.id, evidence: "recorded", note: "Checked the page source.", actorUserId: admin.id });
      await applyContext(db, staffCtx(admin));
      await saveSeoPageSetting(db, clinic.clientId, clinic.websiteId, { pagePath: "/services/consultation", title: null, description: "Book a consultation", canonicalPath: null, indexable: null }, admin.id);

      const today = todaySgt();
      const thisWeek = await loadWorkReport(db, { websiteId: clinic.websiteId, start: addDays(today, -6), end: today });
      const lastWeek = await loadWorkReport(db, { websiteId: clinic.websiteId, start: addDays(today, -13), end: addDays(today, -7) });
      expect(thisWeek.resolutions.map((row) => row.pagePath)).toEqual(["/services/consultation"]);
      expect(thisWeek.resolutions[0]).toMatchObject({ resolvedBy: "Demo Admin", currentStatus: "verified_closed" });
      expect(thisWeek.changes).toEqual([expect.objectContaining({ kind: "page_settings", pagePath: "/services/consultation", summary: "Page SEO settings saved: description", actor: "Demo Admin" })]);
      expect(lastWeek.resolutions).toEqual([]);
      expect(lastWeek.changes).toEqual([]);
      expect(thisWeek.openIssues.count).toBe(1);
      expect(lastWeek.openIssues.count).toBe(1);

      // A reopen changes today's count but not the recorded resolution.
      await applyContext(db, SERVICE);
      await check(site({ [`${SITE}/`]: html("Home", "Home"), [`${SITE}/services/consultation`]: html("Consultation"), [`${SITE}/contact`]: html("Contact") }));
      const after = await loadWorkReport(db, { websiteId: clinic.websiteId, start: addDays(today, -6), end: today });
      expect(after.resolutions).toHaveLength(1);
      expect(after.resolutions[0]?.currentStatus).toBe("reopened");
      expect(after.openIssues.count).toBe(2);
      // Another environment reports nothing.
      const staging = await loadWorkReport(db, { websiteId: clinic.stagingId, start: addDays(today, -6), end: today });
      expect([staging.resolutions.length, staging.changes.length, staging.openIssues.count]).toEqual([0, 0, 0]);
    });
  });
});

describe("AI report (SEO-07.3)", () => {
  it("reports the same three figures as AI Activity and shows an unavailable source as unavailable", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const range = { clientId: clinic.clientId, websiteId: clinic.websiteId, start: "2026-10-01", end: "2026-10-30" };
      await recordAnswerTest(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, platform: "chatgpt", question: "Which fictional clinic offers consultations?", testedOn: "2026-10-05", mentioned: true, citedUrl: null, answerExcerpt: null, actorUserId: admin.id });
      await applyContext(db, staffCtx(admin));
      const report = await loadAiReport(db, range);
      const activity = await loadAiActivity(db, range);
      expect(report.figures.crawlerVisits.value).toBe(activity.crawlers.total);
      expect(report.figures.referralSessions.value).toBe(activity.referrals.sessions);
      expect(report.figures.trackedMentions.value).toBe(activity.mentions.mentions);
      expect(report.figures.crawlerVisits).toEqual({ value: null, coverage: "No crawler log source is connected." });
      expect(report.figures.referralSessions).toEqual({ value: null, coverage: "No GA4 property is connected." });
      expect(report.figures.trackedMentions.value).toBe(1);
    });
  });
});

describe("SEO Overview insights (D76)", () => {
  it("ranks the largest increases and decreases, comparing only rows present in both periods", () => {
    const current = [{ key: "/a", value: 50 }, { key: "/b", value: 5 }, { key: "/c", value: 20 }, { key: "/new", value: 99 }, { key: "/same", value: 7 }, { key: "/gap", value: null }];
    const previous = [{ key: "/a", value: 10 }, { key: "/b", value: 30 }, { key: "/c", value: 18 }, { key: "/gone", value: 80 }, { key: "/same", value: 7 }, { key: "/gap", value: 3 }];
    const result = compareSearchRows(current, previous, 5);
    expect(result.increased.map((row) => [row.key, row.change])).toEqual([["/a", 40], ["/c", 2]]);
    expect(result.decreased.map((row) => [row.key, row.change])).toEqual([["/b", -25]]);
    expect(compareSearchRows(current, previous, 1).increased.map((row) => row.key)).toEqual(["/a"]);
  });

  it("compares stored page reports with the period before, and says which period is missing", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const ids = { clientId: clinic.clientId, websiteId: clinic.websiteId };
      await connectSearch(db, ids, admin.id);
      const window = { start: "2026-10-01", end: "2026-10-07" };
      expect(await loadSearchChanges(db, { ...ids, window, record: "pages", metric: "clicks" })).toEqual({ status: "not_stored", missing: "current" });
      const fake = fakeSearchConsole(SITE);
      await prepareSearchReport(db, { ...ids, ...window, refresh: false });
      await runQueuedSearchJobs(db, clinic.websiteId, fake, new Date("2099-01-01T00:00:00Z"));
      expect(await loadSearchChanges(db, { ...ids, window, record: "pages", metric: "clicks" })).toEqual({ status: "not_stored", missing: "previous" });
      await prepareSearchReport(db, { ...ids, start: "2026-09-24", end: "2026-09-30", refresh: false });
      await runQueuedSearchJobs(db, clinic.websiteId, fake, new Date("2099-01-01T00:00:00Z"));
      // The fixture returns the same figures for both periods: compared, with nothing increased or decreased.
      expect(await loadSearchChanges(db, { ...ids, window, record: "queries", metric: "impressions" })).toEqual({
        status: "available", increased: [], decreased: [], previousWindow: { start: "2026-09-24", end: "2026-09-30" },
      });
      // Another website's reports are never compared.
      expect((await loadSearchChanges(db, { clientId: clinic.clientId, websiteId: clinic.stagingId, window, record: "pages", metric: "clicks" })).status).toBe("not_stored");
    });
  });

  it("gives the latest crawl per platform, and Gemini only from a source that can attribute it", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const ids = { clientId: clinic.clientId, websiteId: clinic.websiteId };
      expect((await latestCrawlsByPlatform(db, clinic.websiteId)).map((row) => [row.provider, row.state, row.lastCrawledAt])).toEqual([
        ["chatgpt", "no_source", null], ["gemini", "no_source", null], ["claude", "no_source", null],
      ]);
      const source = await createCrawlerSource(db, { ...ids, kind: "request_log", label: "Fixture log", geminiAttribution: false, actorUserId: admin.id });
      const events = [
        { id: "e1", timestamp: "2026-11-01T02:00:00.000Z", userAgent: "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)", path: "/", status: 200 },
        { id: "e2", timestamp: "2026-11-03T02:00:00.000Z", userAgent: "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)", path: "/contact", status: 200 },
      ];
      await ingestCrawlerBatch(db, { tokenHash: crawlerTokenHash(source.token), websiteId: ids.websiteId, windowStart: "2026-11-01T00:00:00.000Z", windowEnd: "2026-11-04T00:00:00.000Z", events });
      const crawls = await latestCrawlsByPlatform(db, clinic.websiteId);
      expect(crawls.find((row) => row.provider === "chatgpt")).toEqual({ provider: "chatgpt", state: "measured", lastCrawledAt: new Date("2026-11-03T02:00:00.000Z") });
      expect(crawls.find((row) => row.provider === "claude")).toEqual({ provider: "claude", state: "measured", lastCrawledAt: null });
      expect(crawls.find((row) => row.provider === "gemini")).toEqual({ provider: "gemini", state: "not_measured", lastCrawledAt: null });
      // Another website of the same client shares nothing.
      expect((await latestCrawlsByPlatform(db, clinic.stagingId)).every((row) => row.state === "no_source")).toBe(true);
      // Staff read it under row-level security: an administrator sees the same; a specialist with no membership sees
      // no source and no crawl.
      await applyContext(db, staffCtx(admin));
      expect((await latestCrawlsByPlatform(db, clinic.websiteId)).find((row) => row.provider === "chatgpt")?.lastCrawledAt).toEqual(new Date("2026-11-03T02:00:00.000Z"));
      await applyContext(db, staffCtx(await staffByEmail("specialist-a@example.invalid")));
      expect((await latestCrawlsByPlatform(db, clinic.websiteId)).map((row) => row.state)).toEqual(["no_source", "no_source", "no_source"]);
    });
  });
});
