import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { enqueueJob, executeJob, leaseNext, sealedToken, type FetchLike } from "../src/analytics/sync";
import { createCrawlerSource, disconnectCrawlerSource, loadAiActivity, recordAnswerTest } from "../src/services/ai-visibility";
import { getPublishedSeoConfiguration, issueSeoSiteToken, saveSeoPageSetting } from "../src/services/seo-soft-launch";
import { recordLiveCheck } from "../src/services/seo-pages";
import { recordSetupReview } from "../src/services/seo-workflow";
import { loadAiReport, loadSearchReport, prepareSearchReport } from "../src/services/seo-reports";
import { loadChecklistHealth, loadRecentChanges } from "../src/services/seo-overview";
import { fakeSearchConsole, runQueuedSearchJobs } from "../src/testing/search-console-fixture";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const SITE = "https://check.example.invalid";
const gscToken = () => sealedToken({ accessToken: "fixture", expiresAt: "2100-01-01T00:00:00.000Z" });

describe("SEO Checklist & Health (SEO-01.2)", () => {
  it("shows 80% setup with four steps done and says no website check has run", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const ids = { clientId: clinic.clientId, websiteId: clinic.websiteId };
      const token = gscToken();
      await saveConnection(db, { ...ids, provider: "gsc", externalPropertyId: "sc-domain:check.example.invalid", streamOrSiteRef: null, providerTimezone: "America/Los_Angeles", tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId: admin.id });
      await applyContext(db, staffCtx(admin));
      for (const step of ["website_details", "homepage_seo", "indexing"] as const) await recordSetupReview(db, { ...ids, step, note: null, actorUserId: admin.id });
      const health = await loadChecklistHealth(db, { ...ids, today: "2026-11-20" });
      expect(health.setupPercent).toBe(80);
      expect(health.counts).toMatchObject({ setupDone: 4, setupTotal: 5, unresolvedIssues: 0, newRecommendations: 0, completedTasks: 0 });
      expect(health.next?.key).toBe("sitemap");
      expect(health.lastCheck).toBeNull();
      expect(health.completedWindow).toEqual({ start: "2026-10-22", end: "2026-11-20", days: 30 });
    });
  });
});

describe("SEO Assistant last updated (D74)", () => {
  it("has no last-updated time before any activity, then shows the newest evidence time", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const ids = { clientId: clinic.clientId, websiteId: clinic.websiteId };
      await applyContext(db, staffCtx(admin));
      const empty = await loadChecklistHealth(db, { ...ids, today: "2026-11-20" });
      expect(empty.lastUpdated).toBeNull();
      expect(empty.setupPercent).toBe(0);
      await recordSetupReview(db, { ...ids, step: "website_details", note: null, actorUserId: admin.id });
      const reviewed = (await db.query<{ at: Date }>("select max(reviewed_at) as at from seo_setup_reviews where website_id = $1", [clinic.websiteId])).rows[0]!.at;
      const health = await loadChecklistHealth(db, { ...ids, today: "2026-11-20" });
      expect(health.lastUpdated?.getTime()).toBe(reviewed.getTime());
      // Another website's activity never moves this website's time.
      expect((await loadChecklistHealth(db, { clientId: clinic.clientId, websiteId: clinic.stagingId, today: "2026-11-20" })).lastUpdated).toBeNull();
    });
  });
});

describe("Google Search Performance card (SEO-01.3)", () => {
  it("keeps the period totals when daily observations are missing", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const ids = { clientId: clinic.clientId, websiteId: clinic.websiteId };
      await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
      const token = gscToken();
      await saveConnection(db, { ...ids, provider: "gsc", externalPropertyId: "sc-domain:check.example.invalid", streamOrSiteRef: null, providerTimezone: "America/Los_Angeles", tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId: admin.id });
      await prepareSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-30", refresh: false });
      // The daily observations never arrive.
      await db.query("update analytics_jobs set state = 'cancelled' where website_id = $1 and template_key = 'gsc.daily'", [clinic.websiteId]);
      await runQueuedSearchJobs(db, clinic.websiteId, fakeSearchConsole(SITE), new Date("2099-01-01T00:00:00Z"));
      const card = await loadSearchReport(db, { ...ids, start: "2026-10-01", end: "2026-10-30", preset: true });
      expect(card.totals).toMatchObject({ clicks: 420, impressions: 8400, ctr: 0.05, position: 8.25 });
      expect(card.daily.status).toBe("not_stored");
      expect(card.latestDate).toBe("2026-10-30");
    });
  });
});

describe("AI Visibility card (SEO-01.4)", () => {
  it("shows measured zero referrals, unavailable crawler visits after a disconnect, and the report's mentions", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const ids = { clientId: clinic.clientId, websiteId: clinic.websiteId };
      const range = { ...ids, start: "2026-10-21", end: "2026-11-19" };
      await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
      const token = gscToken();
      const ga4 = await saveConnection(db, { ...ids, provider: "ga4", externalPropertyId: "123456", streamOrSiteRef: null, providerTimezone: "Asia/Singapore", tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId: admin.id });
      await enqueueJob(db, { ...ids, connectionId: ga4.id, templateKey: "ga4.session_source", start: range.start, end: range.end });
      // GA4 reports sessions, none from an AI assistant: a measured zero.
      const fetchReport: FetchLike = async () => ({ status: 200, headers: { get: () => null }, text: async () => "", json: async () => ({
        dimensionHeaders: [{ name: "sessionSource" }], metricHeaders: [{ name: "sessions" }],
        rows: [{ dimensionValues: [{ value: "google" }], metricValues: [{ value: "40" }] }],
      }) });
      const job = await leaseNext(db, "overview-ai", new Date("2099-01-01T00:00:00Z"));
      expect((await executeJob(db, job!, { fetch: fetchReport, now: new Date("2099-01-01T00:00:00Z") })).result).toBe("succeeded");
      const source = await createCrawlerSource(db, { ...ids, kind: "request_log", label: "Fixture request log", geminiAttribution: false, actorUserId: admin.id });
      expect(await disconnectCrawlerSource(db, { websiteId: clinic.websiteId, sourceId: source.id })).toBe(true);
      await recordAnswerTest(db, { ...ids, platform: "claude", question: "Which fictional clinic is open on weekends?", testedOn: "2026-11-02", mentioned: true, citedUrl: null, answerExcerpt: null, actorUserId: admin.id });

      await applyContext(db, staffCtx(admin));
      const card = await loadAiReport(db, range);
      expect(card.figures.referralSessions.value).toBe(0);
      expect(card.figures.crawlerVisits).toEqual({ value: null, coverage: "The crawler log source is disconnected." });
      expect(card.figures.trackedMentions.value).toBe(1);
      expect(card.figures.trackedMentions.value).toBe((await loadAiActivity(db, range)).mentions.mentions);
    });
  });
});

describe("Recent changes (SEO-01.6)", () => {
  it("lists exactly the latest five edits in order, with publication evidence and live verification pending", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const siteToken = await issueSeoSiteToken(db, clinic.clientId, clinic.websiteId, admin.id);
      await applyContext(db, staffCtx(admin));
      const save = (path: string, description: string, at: string) => saveSeoPageSetting(db, clinic.clientId, clinic.websiteId, { pagePath: path, title: null, description, canonicalPath: null, indexable: null }, admin.id, new Date(at));
      await save("/a", "Edit 1", "2026-11-20T01:00:00Z");
      await save("/b", "Edit 2", "2026-11-20T01:01:00Z");
      await save("/c", "Edit 3", "2026-11-20T01:02:00Z");
      await save("/d", "Edit 4", "2026-11-20T01:03:00Z");
      // Edit 5 is published: the website fetches the settings API after it, and before edit 6.
      await save("/e", "Edit 5", "2026-11-20T01:04:00Z");
      await applyContext(db, SERVICE);
      expect(await getPublishedSeoConfiguration(db, clinic.websiteId, siteToken, new Date("2026-11-20T01:04:30Z"))).not.toBeNull();
      await applyContext(db, staffCtx(admin));
      // Edit 6 changes /a again, so edit 1's later evidence belongs to edit 6.
      // Edit 6 uses the database clock (microsecond precision), as a real save does.
      await saveSeoPageSetting(db, clinic.clientId, clinic.websiteId, { pagePath: "/a", title: null, description: "Edit 6", canonicalPath: null, indexable: null }, admin.id);
      await applyContext(db, SERVICE);
      await recordLiveCheck(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, pagePath: "/b", pageUrl: `${SITE}/b`, httpStatus: 200, head: { title: "B", description: "Edit 2", robots: null }, errorCode: null, actorUserId: admin.id, now: new Date("2026-11-20T01:10:00Z") });
      await applyContext(db, staffCtx(admin));

      const changes = await loadRecentChanges(db, clinic.websiteId, 5);
      expect(changes.map((change) => change.pagePath)).toEqual(["/a", "/e", "/d", "/c", "/b"]);
      expect(changes[0]).toMatchObject({ summary: "Page SEO settings saved: description", actor: "Demo Admin", published: { state: "waiting" }, live: { state: "pending" } });
      expect(changes[1]).toMatchObject({ published: { state: "published", at: new Date("2026-11-20T01:04:30Z") }, live: { state: "pending" } });
      // Saved before the fetch, so the same fetch is publication evidence for /d too.
      expect(changes[2]?.published.state).toBe("published");
      expect(changes[4]).toMatchObject({ pagePath: "/b", live: { state: "checked", at: new Date("2026-11-20T01:10:00Z"), result: "matches" } });
      expect(changes.every((change) => change.pageId)).toBe(true);
      // Another environment has no edits.
      expect(await loadRecentChanges(db, clinic.stagingId, 5)).toEqual([]);
    });
  });
});
