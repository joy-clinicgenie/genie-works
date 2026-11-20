import { afterAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { enqueueJob, executeJob, leaseNext, sealedToken, type FetchLike, type FetchResponse } from "../src/analytics/sync";
import { AiAccessFetchError, listAiAccessChecks, parseLlmsLinks, readAiAccess, recordAiAccessCheck, type TextFetcher, type TextFetchResult } from "../src/services/ai-access";
import {
  classifyCrawler,
  crawlerTokenHash,
  createCrawlerSource,
  disconnectCrawlerSource,
  ingestCrawlerBatch,
  listCrawlerEvents,
  loadAiActivity,
  nlwebEndpointProblem,
  parseNlwebResponse,
  recordAnswerTest,
  runNlwebTest,
} from "../src/services/ai-visibility";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const SITE = "https://check.example.invalid";
type Served = (Partial<TextFetchResult> & { status: number }) | { error: string };
function fixture(pages: Record<string, Served>): TextFetcher {
  return async (url) => {
    const page = pages[url] ?? { status: 404 };
    if ("error" in page) throw new AiAccessFetchError(page.error);
    return { contentType: "text/plain", body: "", bytes: 0, finalUrl: url, ...page };
  };
}

const UA = {
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot",
  searchbot: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot",
  chatgptUser: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  claudebot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  claudeUser: "Mozilla/5.0 (compatible; Claude-User/1.0)",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  perplexity: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  geminiNotebook: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 (compatible; Google-GeminiNotebook; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-gemininotebook)",
};

describe("llms.txt (SEO-05.1)", () => {
  it("shows both linked pages with relative links resolved, and a missing file without a preview", async () => {
    const file = "# North Clinic\n\n> Fictional clinic.\n\n## Pages\n\n- [Consultations](/services/consultation): What a first visit covers\n- [Contact](https://check.example.invalid/contact)\n";
    expect(parseLlmsLinks(file, `${SITE}/llms.txt`)).toEqual([
      { label: "Consultations", url: `${SITE}/services/consultation`, notes: "What a first visit covers" },
      { label: "Contact", url: `${SITE}/contact`, notes: null },
    ]);
    expect(parseLlmsLinks("- [Script](javascript:alert(1))", `${SITE}/llms.txt`)).toEqual([]);

    const found = await readAiAccess(fixture({ [`${SITE}/robots.txt`]: { status: 404 }, [`${SITE}/llms.txt`]: { status: 200, body: file, bytes: file.length } }), SITE);
    expect(found).toMatchObject({ llmsStatus: "found", llmsHttp: 200, llmsUrl: `${SITE}/llms.txt`, llmsBody: file });
    const missing = await readAiAccess(fixture({}), SITE);
    expect(missing).toMatchObject({ llmsStatus: "missing", llmsHttp: 404, llmsBody: null });

    const admin = await staffByEmail("admin@example.invalid");
    await asContext(staffCtx(admin), async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      await recordAiAccessCheck(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, userId: admin.id, reading: found });
      const [row] = await listAiAccessChecks(db, clinic.websiteId, 1);
      expect(row).toMatchObject({ llmsUrl: `${SITE}/llms.txt`, llmsBody: file, llmsHttp: 200 });
    });
  });
});

describe("NLWeb (SEO-05.2)", () => {
  const ASK = `${SITE}/ask`;
  const askUrl = (q: string) => `${ASK}?query=${encodeURIComponent(q).replace(/%20/g, "+")}&mode=summarize&streaming=false`;

  it("shows the answer and its source, and reports a timeout and an empty answer", async () => {
    const question = "Do you offer weekend consultations?";
    const answered = await runNlwebTest(fixture({ [askUrl(question)]: { status: 200, contentType: "application/json", body: JSON.stringify({ query_id: "q1", summary: "Consultations run on Saturdays.", results: [{ url: `${SITE}/services/consultation`, name: "Consultations", description: "Weekend hours", site: "north", score: 0.9 }] }) } }), ASK, question);
    expect(answered).toEqual({ outcome: "answered", httpStatus: 200, answer: "Consultations run on Saturdays.", sources: [{ url: `${SITE}/services/consultation`, name: "Consultations" }], errorCode: null });
    expect(await runNlwebTest(fixture({ [askUrl(question)]: { error: "timeout" } }), ASK, question)).toMatchObject({ outcome: "timeout", errorCode: "timeout", answer: null });
    expect(await runNlwebTest(fixture({ [askUrl(question)]: { status: 200, body: JSON.stringify({ query_id: "q2", results: [] }) } }), ASK, question)).toMatchObject({ outcome: "empty" });
    expect(await runNlwebTest(fixture({ [askUrl(question)]: { status: 200, body: "<html>" } }), ASK, question)).toMatchObject({ outcome: "error", errorCode: "not_json" });
    expect(parseNlwebResponse({ itemListElement: [{ item: { url: `${SITE}/a`, name: "A", description: "From an ItemList" } }] })).toEqual({ answer: "From an ItemList", sources: [{ url: `${SITE}/a`, name: "A" }] });
  });

  it("accepts only an HTTPS endpoint on the website's own domain", () => {
    expect(nlwebEndpointProblem(`${SITE}/ask`, SITE)).toBeNull();
    expect(nlwebEndpointProblem("https://nlweb.check.example.invalid/ask", SITE)).toBeNull();
    expect(nlwebEndpointProblem("https://other.example.test/ask", SITE)).toMatch(/own domain/);
    expect(nlwebEndpointProblem("http://check.example.invalid/ask", SITE)).toMatch(/HTTPS/);
    expect(nlwebEndpointProblem(`${SITE}/ask?site=x`, SITE)).toMatch(/query string/);
  });
});

function jsonResponse(status: number, body: unknown): FetchResponse {
  return { status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
}

async function website(db: pg.PoolClient, adminId: string) {
  const clinic = await provisionClinic(db, adminId);
  return { ...clinic, ids: { clientId: clinic.clientId, websiteId: clinic.websiteId } };
}

describe("AI Activity (SEO-05.3)", () => {
  const range = { start: "2026-11-01", end: "2026-11-07" };
  const windowStart = "2026-10-31T16:00:00Z"; // 1 Nov 00:00 Singapore
  const windowEnd = "2026-11-07T16:00:00Z"; // 8 Nov 00:00 Singapore

  it("classifies only documented ChatGPT and Claude agents, and Gemini only with documented attribution", () => {
    const plain = { geminiAttribution: false };
    expect(classifyCrawler({ userAgent: UA.gptbot }, plain)).toEqual({ provider: "chatgpt", agent: "GPTBot", purpose: "training" });
    expect(classifyCrawler({ userAgent: UA.searchbot }, plain)).toEqual({ provider: "chatgpt", agent: "OAI-SearchBot", purpose: "search" });
    expect(classifyCrawler({ userAgent: UA.chatgptUser }, plain)).toEqual({ provider: "chatgpt", agent: "ChatGPT-User", purpose: "user" });
    expect(classifyCrawler({ userAgent: UA.claudebot }, plain)).toEqual({ provider: "claude", agent: "ClaudeBot", purpose: "training" });
    expect(classifyCrawler({ userAgent: UA.claudeUser }, plain)).toEqual({ provider: "claude", agent: "Claude-User", purpose: "user" });
    expect(classifyCrawler({ userAgent: UA.googlebot }, plain)).toBeNull();
    expect(classifyCrawler({ userAgent: "Google-Extended" }, { geminiAttribution: true })).toBeNull();
    expect(classifyCrawler({ userAgent: UA.perplexity }, plain)).toBeNull();
    expect(classifyCrawler({ userAgent: UA.geminiNotebook }, plain)).toBeNull();
    expect(classifyCrawler({ userAgent: UA.geminiNotebook }, { geminiAttribution: true })).toEqual({ provider: "gemini", agent: "Google-GeminiNotebook", purpose: "user" });
    expect(classifyCrawler({ userAgent: UA.googlebot, provider: "gemini" }, plain)).toBeNull();
    expect(classifyCrawler({ userAgent: UA.googlebot, provider: "gemini", purpose: "search" }, { geminiAttribution: true })).toEqual({ provider: "gemini", agent: "Gemini (source attribution)", purpose: "search" });
  });

  it("counts the two eligible requests once and marks Gemini unavailable without attribution", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const { ids } = await website(db, admin.id);
      const source = await createCrawlerSource(db, { ...ids, kind: "request_log", label: "Fixture log", geminiAttribution: false, actorUserId: admin.id });
      const events = [
        { id: "e1", timestamp: "2026-11-02T03:00:00Z", userAgent: UA.gptbot, path: "/services/consultation?utm=1", status: 200 },
        { id: "e2", timestamp: "2026-11-03T03:00:00Z", userAgent: UA.claudebot, path: "/", status: 200 },
        { id: "e3", timestamp: "2026-11-03T04:00:00Z", userAgent: UA.googlebot, path: "/", status: 200 },
        { id: "e4", timestamp: "2026-11-03T05:00:00Z", userAgent: UA.perplexity, path: "/", status: 200 },
      ];
      expect(await ingestCrawlerBatch(db, { tokenHash: crawlerTokenHash(source.token), websiteId: ids.websiteId, windowStart, windowEnd, events })).toEqual({ accepted: 2, duplicates: 0, ignored: 2 });
      expect(await ingestCrawlerBatch(db, { tokenHash: crawlerTokenHash("wrong"), websiteId: ids.websiteId, windowStart, windowEnd, events })).toBe("unknown_source");

      await applyContext(db, staffCtx(admin));
      const activity = await loadAiActivity(db, { ...ids, ...range });
      expect(activity.crawlers).toMatchObject({ status: "covered", total: 2, unavailableProviders: ["gemini"] });
      expect(activity.crawlers.providers.chatgpt).toEqual({ availability: "available", count: 1, byPurpose: { training: 1 } });
      expect(activity.crawlers.providers.claude).toEqual({ availability: "available", count: 1, byPurpose: { training: 1 } });
      expect(activity.crawlers.providers.gemini).toEqual({ availability: "unavailable", count: null, byPurpose: {} });
      const events2 = await listCrawlerEvents(db, { websiteId: ids.websiteId, ...range, provider: "chatgpt" });
      expect(events2).toEqual([expect.objectContaining({ agent: "GPTBot", pagePath: "/services/consultation", httpStatus: 200 })]);
    });
  });

  it("counts a documented Gemini attribution under Gemini once, even when re-imported", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const { ids } = await website(db, admin.id);
      const source = await createCrawlerSource(db, { ...ids, kind: "platform_feed", label: "Fixture feed with Gemini attribution", geminiAttribution: true, actorUserId: admin.id });
      const batch = { tokenHash: crawlerTokenHash(source.token), websiteId: ids.websiteId, windowStart, windowEnd, events: [{ id: "g1", timestamp: "2026-11-04T01:00:00Z", userAgent: UA.googlebot, provider: "gemini", purpose: "user", path: "/" }] };
      expect(await ingestCrawlerBatch(db, batch)).toEqual({ accepted: 1, duplicates: 0, ignored: 0 });
      expect(await ingestCrawlerBatch(db, batch)).toEqual({ accepted: 0, duplicates: 1, ignored: 0 });
      const activity = await loadAiActivity(db, { ...ids, ...range });
      expect(activity.crawlers.providers.gemini).toEqual({ availability: "available", count: 1, byPurpose: { user: 1 } });
      expect(activity.crawlers).toMatchObject({ total: 1, unavailableProviders: [] });
    });
  });

  it("keeps referral sessions and mentions independent of crawler counts", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const { ids } = await website(db, admin.id);
      const token = sealedToken({ accessToken: "fixture", expiresAt: "2100-01-01T00:00:00.000Z" });
      const ga4 = await saveConnection(db, { ...ids, provider: "ga4", externalPropertyId: "123456", streamOrSiteRef: null, providerTimezone: "Asia/Singapore", tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId: admin.id });
      // Before the report is prepared, referrals say so rather than zero.
      expect((await loadAiActivity(db, { ...ids, ...range })).referrals.status).toBe("not_prepared");
      await enqueueJob(db, { ...ids, connectionId: ga4.id, templateKey: "ga4.session_source", start: range.start, end: range.end });
      expect((await loadAiActivity(db, { ...ids, ...range })).referrals.status).toBe("preparing");
      const fetchReport: FetchLike = async () => jsonResponse(200, {
        dimensionHeaders: [{ name: "sessionSource" }],
        metricHeaders: [{ name: "sessions" }],
        rows: [
          { dimensionValues: [{ value: "chatgpt.com" }], metricValues: [{ value: "1" }] },
          { dimensionValues: [{ value: "claude.ai" }], metricValues: [{ value: "1" }] },
          { dimensionValues: [{ value: "google" }], metricValues: [{ value: "40" }] },
        ],
      });
      const job = await leaseNext(db, "ai-referrals", new Date("2099-01-01T00:00:00Z"));
      expect(job?.template_key).toBe("ga4.session_source");
      expect((await executeJob(db, job!, { fetch: fetchReport, now: new Date("2099-01-01T00:00:00Z") })).result).toBe("succeeded");
      await recordAnswerTest(db, { ...ids, platform: "chatgpt", question: "Which clinic offers weekend consultations nearby?", testedOn: "2026-11-05", mentioned: true, citedUrl: `${SITE}/services/consultation`, answerExcerpt: null, actorUserId: admin.id });
      await recordAnswerTest(db, { ...ids, platform: "claude", question: "Best clinic for consultations?", testedOn: "2026-11-05", mentioned: false, citedUrl: null, answerExcerpt: null, actorUserId: admin.id });

      await applyContext(db, staffCtx(admin));
      const activity = await loadAiActivity(db, { ...ids, ...range });
      expect(activity.referrals).toMatchObject({ status: "available", sessions: 2, byProvider: { chatgpt: 1, gemini: 0, claude: 1 } });
      expect(activity.mentions).toMatchObject({ tests: 2, mentions: 1, byProvider: { chatgpt: 1, gemini: 0, claude: 0 } });
      expect(activity.mentions.recent[0]).toMatchObject({ platform: "chatgpt", question: "Which clinic offers weekend consultations nearby?", citedUrl: `${SITE}/services/consultation` });
      // No crawler source: crawler counts stay unavailable and are not filled by referrals or mentions.
      expect(activity.crawlers).toMatchObject({ status: "no_source", total: null });
    });
  });

  it("shows zero for a covered range with no eligible events, and unavailable after disconnect or for an uncovered range", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const { ids, stagingId } = await website(db, admin.id);
      const source = await createCrawlerSource(db, { ...ids, kind: "request_log", label: "Fixture log", geminiAttribution: false, actorUserId: admin.id });
      await ingestCrawlerBatch(db, { tokenHash: crawlerTokenHash(source.token), websiteId: ids.websiteId, windowStart, windowEnd, events: [{ id: "x", timestamp: "2026-11-02T00:00:00Z", userAgent: UA.googlebot }] });
      let activity = await loadAiActivity(db, { ...ids, ...range });
      expect(activity.crawlers).toMatchObject({ status: "covered", total: 0 });
      expect(activity.crawlers.providers.chatgpt.count).toBe(0);
      expect((await loadAiActivity(db, { ...ids, start: "2026-10-01", end: "2026-11-07" })).crawlers).toMatchObject({ status: "not_covered", total: null });
      // The other environment has its own (absent) sources.
      expect((await loadAiActivity(db, { clientId: ids.clientId, websiteId: stagingId, ...range })).crawlers.status).toBe("no_source");

      expect(await disconnectCrawlerSource(db, { websiteId: ids.websiteId, sourceId: source.id })).toBe(true);
      activity = await loadAiActivity(db, { ...ids, ...range });
      expect(activity.crawlers).toMatchObject({ status: "disconnected", total: null });
      expect(activity.crawlers.providers.claude.availability).toBe("unavailable");
      expect(await ingestCrawlerBatch(db, { tokenHash: crawlerTokenHash(source.token), websiteId: ids.websiteId, windowStart, windowEnd, events: [] })).toBe("unknown_source");
    });
  });

  it("hides another clinic's activity", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    await asContext(SERVICE, async (db) => {
      const { ids } = await website(db, admin.id);
      const source = await createCrawlerSource(db, { ...ids, kind: "request_log", label: "Fixture log", geminiAttribution: false, actorUserId: admin.id });
      await ingestCrawlerBatch(db, { tokenHash: crawlerTokenHash(source.token), websiteId: ids.websiteId, windowStart, windowEnd, events: [{ id: "e1", timestamp: "2026-11-02T03:00:00Z", userAgent: UA.gptbot }] });
      await applyContext(db, staffCtx(specB));
      expect((await loadAiActivity(db, { ...ids, ...range })).crawlers).toMatchObject({ status: "no_source", total: null });
      expect(await listCrawlerEvents(db, { websiteId: ids.websiteId, ...range })).toEqual([]);
    });
  });
});
