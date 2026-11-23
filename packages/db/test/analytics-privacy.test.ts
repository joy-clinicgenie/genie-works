import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, type Queryable } from "../src/client";
import { response } from "../src/testing/fictional-analytics-provider";
import { adminPool, appPool, asContext, staffByEmail } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { publishedReport } from "../src/analytics/read";
import { enqueueJob, mergeDuplicateRows, runWorkerOnce, sealedToken, type FetchLike } from "../src/analytics/sync";
import { safeAnalyticsPath, safeSearchQuery } from "../src/analytics/measure";
import {
  PrivacyTally, classifyDimension, classifyPath, classifyQueryString, classifySearchQuery, keyTokens, sensitiveQueryKeys,
} from "../src/analytics/privacy";
import {
  LEGITIMATE_PATHS, LEGITIMATE_QUERIES, QUERY_STRING_PATHS, SENSITIVE_PATHS, SENSITIVE_QUERIES,
  legacySafeAnalyticsPath, legacySafeSearchQuery,
} from "./privacy-corpus";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const NOW = new Date("2026-11-12T04:00:00.000Z");
const TOKEN = sealedToken({ accessToken: "t", expiresAt: "2100-01-01T00:00:00.000Z" });

describe("privacy filter: legitimate clinic text is kept", () => {
  it("keeps every ordinary clinic search query", () => {
    const lost = LEGITIMATE_QUERIES.filter((q) => safeSearchQuery(q) === null);
    expect(lost).toEqual([]);
    expect(safeSearchQuery("  patient reviews dentist  ")).toBe("patient reviews dentist");
  });

  it("keeps every ordinary page path, including words like patient, phone and tel", () => {
    const lost = LEGITIMATE_PATHS.filter((p) => safeAnalyticsPath(p) === null);
    expect(lost).toEqual([]);
    expect(safeAnalyticsPath("/for-patients")).toBe("/for-patients");
    expect(safeAnalyticsPath("/blog/phone-etiquette")).toBe("/blog/phone-etiquette");
    expect(safeAnalyticsPath("https://clinic.example.invalid/services/whitening/")).toBe("/services/whitening");
  });

  it("does not mistake dates, years and prices for phone numbers", () => {
    for (const text of ["2026-11-12", "20261112", "2024 2025", "12/11/2026", "$12,500,000", "hdb 1,200,000", "open 9-5 mon-fri"]) {
      expect(classifySearchQuery(text).value, text).not.toBeNull();
    }
    expect(classifyPath("/archive/2026-11-12").value).toBe("/archive/2026-11-12");
    expect(classifyPath("/archive/20261112").value).toBe("/archive/20261112");
  });

  it("keeps a reserved GA4 placeholder as it is", () => {
    expect(classifyDimension("landingPage", "(not set)").value).toBe("(not set)");
    expect(classifyDimension("pagePath", "(other)").value).toBe("(other)");
  });
});

describe("privacy filter: sensitive text is withheld", () => {
  it("withholds every sensitive search query", () => {
    const leaked = SENSITIVE_QUERIES.filter((q) => safeSearchQuery(q) !== null);
    expect(leaked).toEqual([]);
  });

  it("withholds every sensitive path", () => {
    const leaked = SENSITIVE_PATHS.filter((p) => safeAnalyticsPath(p) !== null);
    expect(leaked).toEqual([]);
  });

  it("gives a reason for each, and never returns the text", () => {
    expect(classifySearchQuery("person@example.invalid")).toEqual({ value: null, reason: "email" });
    expect(classifySearchQuery("dentist 9123 4567").reason).toBe("phone_number");
    expect(classifySearchQuery("4111111111111111").reason).toBe("long_number");
    expect(classifySearchQuery("S1234567D").reason).toBe("government_id");
    expect(classifySearchQuery("password=hunter2xyz").reason).toBe("credential");
    expect(classifySearchQuery("my name is john tan").reason).toBe("self_disclosure");
    expect(classifyPath("/u/ABCD1234efgh5678IJKL9012mnop").reason).toBe("opaque_identifier");
    expect(classifyPath("tel:+6591234567").reason).toBe("non_web_scheme");
  });

  it("sees through encoding that hides an @", () => {
    expect(classifyPath("/thank-you/person%40example.invalid").value).toBeNull();
    expect(classifyPath("/thank-you/person%2540example.invalid").value).toBeNull();
  });
});

describe("privacy filter: query strings are handled by parameter, and only categories are kept", () => {
  it("removes every query string and fragment, keeping the path", () => {
    for (const { input, path } of QUERY_STRING_PATHS) expect(classifyPath(input).value, input).toBe(path);
  });

  it("flags personal data in a query string by key and by value shape", () => {
    for (const { input, personal } of QUERY_STRING_PATHS) {
      const decision = classifyPath(input);
      expect(decision.queryStringStripped, input).toBe(input.includes("?") || input.includes("#"));
      expect(Boolean(decision.queryStringPersonalData), input).toBe(personal);
    }
  });

  it("reads parameter names as whole words, so hotel_id is not a tel field", () => {
    expect(keyTokens("hotel_id")).toEqual(["hotel", "id"]);
    expect(keyTokens("firstName")).toEqual(["first", "name"]);
    expect(classifyQueryString("hotel_id=12").personalData).toBe(false);
    expect(classifyQueryString("phone=91234567").categories).toContain("personal_field");
    expect(classifyQueryString("access_token=abc").categories).toContain("credential");
    expect(classifyQueryString("gclid=abc").categories).toEqual(["click_identifier"]);
    expect(sensitiveQueryKeys("?hotel_id=12&email=a@b.invalid&utm_source=x&gclid=1")).toEqual(["email", "gclid"]);
  });
});

describe("privacy filter: before and after", () => {
  it("never lets through anything the old filter blocked because it was an identifier", () => {
    // Old blocked and new keeps => only acceptable if the text holds no identifier. The sensitive corpus holds identifiers only.
    const regressions = [...SENSITIVE_QUERIES.filter((q) => legacySafeSearchQuery(q) === null && safeSearchQuery(q) !== null),
      ...SENSITIVE_PATHS.filter((p) => legacySafeAnalyticsPath(p) === null && safeAnalyticsPath(p) !== null)];
    expect(regressions).toEqual([]);
  });

  it("records the difference: ordinary text the old filter lost, and identifiers it missed", () => {
    const lostBefore = {
      queries: LEGITIMATE_QUERIES.filter((q) => legacySafeSearchQuery(q) === null),
      paths: LEGITIMATE_PATHS.filter((p) => legacySafeAnalyticsPath(p) === null),
    };
    const missedBefore = {
      queries: SENSITIVE_QUERIES.filter((q) => legacySafeSearchQuery(q) !== null),
      paths: SENSITIVE_PATHS.filter((p) => legacySafeAnalyticsPath(p) !== null),
    };
    // The numbers below are the before-and-after result reported in the Phase 2.3A report.
    expect({ legitQueries: LEGITIMATE_QUERIES.length, lostBefore: lostBefore.queries.length, lostAfter: 0 }).toMatchObject({ lostAfter: 0 });
    expect(lostBefore.queries.length).toBeGreaterThan(10);
    expect(lostBefore.paths.length).toBeGreaterThan(8);
    expect(missedBefore.queries.length).toBeGreaterThan(5);
    expect(missedBefore.paths.length).toBeGreaterThan(3);
    // Specific, documented examples.
    expect(missedBefore.queries).toContain("john tan 91234567");
    expect(missedBefore.queries).toContain("dentist 9123 4567");
    expect(missedBefore.paths).toContain("/appointment/confirm/3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(lostBefore.queries).toContain("hotel near dental clinic");
    expect(lostBefore.paths).toContain("/for-patients");
  });
});

describe("privacy evidence never holds the text it withheld", () => {
  it("counts reasons and additive metrics only", () => {
    const tally = new PrivacyTally();
    for (const q of SENSITIVE_QUERIES) {
      const d = classifySearchQuery(q);
      tally.note(d);
      tally.withhold(d.reason!, { clicks: 2, impressions: 10, ctr: 0.2, position: 3, activeUsers: 5 });
    }
    const quality = tally.toQuality();
    const text = JSON.stringify(quality);
    for (const q of SENSITIVE_QUERIES) expect(text.includes(q), q).toBe(false);
    for (const needle of ["example.invalid", "9123", "hunter2", "john", "S1234567"]) expect(text).not.toContain(needle);
    const withheld = quality.withheldByPrivacyFilter as { rows: number; clicks: number; impressions: number; byReason: Record<string, number>; ctr?: number; activeUsers?: number };
    expect(withheld.rows).toBe(SENSITIVE_QUERIES.length);
    expect(withheld.clicks).toBe(2 * SENSITIVE_QUERIES.length);
    // Ratios and distinct counts are not added up.
    expect(withheld.ctr).toBeUndefined();
    expect(withheld.activeUsers).toBeUndefined();
    expect(Object.keys(withheld.byReason).sort()).toEqual(["credential", "email", "government_id", "long_number", "opaque_identifier", "phone_number", "self_disclosure"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Stored data

async function connection(db: Queryable, provider: "ga4" | "gsc") {
  const admin = await staffByEmail("admin@example.invalid");
  await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
  const { clientId, websiteId } = await provisionClinic(db, admin.id);
  const c = await saveConnection(db, {
    clientId, websiteId, provider, externalPropertyId: provider === "ga4" ? "700001" : "sc-domain:check.example.invalid", streamOrSiteRef: null,
    providerTimezone: provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore", tokenCiphertext: TOKEN.ciphertext, tokenNonce: TOKEN.nonce, actorUserId: admin.id,
  });
  return { clientId, websiteId, connectionId: c.id };
}

async function run(db: Queryable, ids: { clientId: string; websiteId: string; connectionId: string }, template: string, fetch: FetchLike, window = { start: "2026-11-01", end: "2026-11-07" }) {
  await enqueueJob(db, { ...ids, templateKey: template, start: window.start, end: window.end, now: NOW });
  return runWorkerOnce(async (fn) => fn(db), "t", { fetch, now: NOW });
}

const quality = async (db: Queryable, template: string) =>
  (await db.query<{ quality: Record<string, unknown> }>("select quality from analytics_report_partitions where template_key = $1 order by fetched_at desc limit 1", [template])).rows[0]!.quality;

describe("what is stored (GA4 dimensions were unfiltered before this phase)", () => {
  it("stores GA4 landing pages without the query string, withholds identifier paths, and counts both", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await connection(db, "ga4");
      const fetch: FetchLike = async () => response(200, {
        dimensionHeaders: [{ name: "landingPage" }], metricHeaders: [{ name: "sessions" }],
        rows: [
          ["/thank-you?email=person@example.invalid&phone=91234567", "3"],
          ["/thank-you?name=Jane", "4"],
          ["/reset-password/a1b2c3d4e5f60718293a4b5c6d7e8f90", "2"],
          ["/for-patients", "9"],
          ["(not set)", "1"],
        ].map(([page, n]) => ({ dimensionValues: [{ value: page }], metricValues: [{ value: n }] })),
        rowCount: 5,
      });
      expect((await run(db, ids, "ga4.landing", fetch)).result).toBe("succeeded");
      const report = await publishedReport(db, { ...ids, templateKey: "ga4.landing", start: "2026-11-01", end: "2026-11-07" });
      const sessions = Object.fromEntries(report!.rows.map((r) => [r.dimensionKey, r.metrics[0]!.value]));
      // Two rows differed only by a removed query string: they are one row, with their sessions added.
      expect(sessions).toEqual({ "/thank-you": 7, "/for-patients": 9, "(not set)": 1 });
      const stored = JSON.stringify(report);
      for (const needle of ["person@example.invalid", "91234567", "Jane", "a1b2c3d4e5f6", "reset-password"]) expect(stored).not.toContain(needle);
      const q = await quality(db, "ga4.landing");
      expect(q.withheldByPrivacyFilter).toEqual({ rows: 1, sessions: 2, byReason: { opaque_identifier: 1 } });
      expect(q.queryStringsStripped).toEqual({ rows: 2, withPersonalData: 2 });
      expect(q.duplicateRowsMerged).toBe(1);
      // Every row GA4 returned is accounted for: kept (3 incl. merged), merged, or withheld. No false mismatch alarm.
      expect(q.rowCountMismatch).toBeUndefined();
      expect(JSON.stringify(q)).not.toMatch(/example\.invalid|91234567|Jane|reset-password/);
    });
  });

  it("applies the same rules inside a bundle, so derived windows are clean too", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await connection(db, "ga4");
      const fetch: FetchLike = async () => response(200, {
        dimensionHeaders: [{ name: "date" }, { name: "landingPage" }], metricHeaders: [{ name: "sessions" }],
        rows: [
          ["20261105", "/contact?email=person@example.invalid", "2"],
          ["20261106", "/contact", "3"],
          ["20261106", "/verify/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig1234567890abc", "5"],
        ].map(([d, page, n]) => ({ dimensionValues: [{ value: d }, { value: page }], metricValues: [{ value: n }] })),
      });
      await run(db, ids, "ga4.bundle.landing", fetch, { start: "2026-08-10", end: "2026-11-07" });
      const report = await publishedReport(db, { ...ids, templateKey: "ga4.landing", start: "2026-11-01", end: "2026-11-07" });
      expect(report!.rows.map((r) => [r.dimensionKey, r.metrics[0]!.value])).toEqual([["/contact", 5]]);
      expect(JSON.stringify(report)).not.toMatch(/example\.invalid|eyJ/);
    });
  });

  it("stores Search Console pages and queries by the new rules and records what it withheld", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await connection(db, "gsc");
      const queries = [
        ["symptoms of gum disease", 3, 40], ["patient reviews dentist", 2, 25], ["mobile dentist near me", 1, 20],
        ["hotel near dental clinic", 1, 10], ["dentist 9123 4567", 4, 8], ["jane@example.invalid", 1, 2],
      ] as const;
      const fetch: FetchLike = async () => response(200, { rows: queries.map(([q, clicks, impressions]) => ({ keys: [q], clicks, impressions, ctr: clicks / impressions, position: 4 })) });
      await run(db, ids, "gsc.queries", fetch);
      const report = await publishedReport(db, { ...ids, templateKey: "gsc.queries", start: "2026-11-01", end: "2026-11-07" });
      expect(report!.rows.map((r) => r.dimensionKey).sort()).toEqual(["hotel near dental clinic", "mobile dentist near me", "patient reviews dentist", "symptoms of gum disease"]);
      const q = await quality(db, "gsc.queries");
      expect(q.withheldByPrivacyFilter).toEqual({ rows: 2, clicks: 5, impressions: 10, byReason: { phone_number: 1, email: 1 } });
      expect(JSON.stringify(q)).not.toMatch(/9123|jane|example/i);
    });
  });

  it("combines Search Console pages that differ only by a removed query string instead of failing the job", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await connection(db, "gsc");
      const fetch: FetchLike = async () => response(200, { rows: [
        { keys: ["https://check.example.invalid/services?utm_source=a"], clicks: 2, impressions: 20, ctr: 0.1, position: 4 },
        { keys: ["https://check.example.invalid/services?utm_source=b"], clicks: 3, impressions: 30, ctr: 0.1, position: 6 },
      ] });
      expect((await run(db, ids, "gsc.pages", fetch)).result).toBe("succeeded");
      const report = await publishedReport(db, { ...ids, templateKey: "gsc.pages", start: "2026-11-01", end: "2026-11-07" });
      expect(report!.rows).toHaveLength(1);
      const metric = (key: string) => report!.rows[0]!.metrics.find((m) => m.key === key)!.value;
      expect(metric("clicks")).toBe(5);
      expect(metric("impressions")).toBe(50);
      expect(metric("ctr")).toBeCloseTo(0.1, 10);
      expect(metric("position")).toBeCloseTo((4 * 20 + 6 * 30) / 50, 10); // weighted by impressions, not (4 + 6) / 2
    });
  });

  it("does not add up what cannot be added when it merges rows", () => {
    const merged = mergeDuplicateRows([
      { dimensionKey: "/a", dimensions: {}, metrics: [{ key: "sessions", value: 2, state: "available" }, { key: "activeUsers", value: 5, state: "available" }] },
      { dimensionKey: "/a", dimensions: {}, metrics: [{ key: "sessions", value: 3, state: "available" }, { key: "activeUsers", value: 4, state: "available" }] },
    ]);
    expect(merged.merged).toBe(1);
    const m = Object.fromEntries(merged.rows[0]!.metrics.map((x) => [x.key, x]));
    expect(m.sessions).toMatchObject({ value: 5, state: "available" });
    expect(m.activeUsers).toMatchObject({ value: null, state: "unavailable" });
  });

  it("keeps categorical dimensions and withholds one that looks like an identifier", () => {
    expect(classifyDimension("deviceCategory", "mobile").value).toBe("mobile");
    expect(classifyDimension("country", "Singapore").value).toBe("Singapore");
    expect(classifyDimension("sessionDefaultChannelGroup", "Organic Search").value).toBe("Organic Search");
    expect(classifyDimension("deviceCategory", "person@example.invalid").value).toBeNull();
    expect(classifyDimension("country", "a1b2c3d4e5f60718293a4b5c6d7e8f90").reason).toBe("opaque_identifier");
  });
});
