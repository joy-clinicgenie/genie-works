import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, type Queryable } from "../src/client";
import { fictionalProviders, response } from "../src/testing/fictional-analytics-provider";
import { adminPool, appPool, asContext, staffByEmail } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { publishedReport } from "../src/analytics/read";
import { enqueueJob, MAX_PROVIDER_PAGES, runWorkerOnce, sealedToken, type FetchLike } from "../src/analytics/sync";
import { ga4ReportBody, parseGa4Report } from "../src/analytics/providers/ga4";
import { parseGscQuery } from "../src/analytics/providers/gsc";
import { parseWixData } from "../src/analytics/providers/wix";
import {
  assembleEvidence, compareNumbers, gscPropertyHost, propertyRef, recordingFetch, runMeasuredJob,
  summariseLatency, validateGa4, validateGsc, validateWix, ValidationBudgetError, type JobContext, type Provider,
} from "../src/analytics/validation";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const TOKEN = sealedToken({ accessToken: "fixture-token-do-not-print", expiresAt: "2100-01-01T00:00:00.000Z" });
const NOW = new Date("2026-11-12T04:00:00.000Z");
const FIXTURE_PROPERTY = { ga4: "700123", gsc: "sc-domain:validation.example.invalid", wix: "wix-validation-site" } as const;

async function setup(db: Queryable, provider: Provider, property: string = FIXTURE_PROPERTY[provider]) {
  const admin = await staffByEmail("admin@example.invalid");
  await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
  await db.query("update analytics_connections set status = 'disconnected', disconnected_at = now() where status = 'connected'");
  const { clientId, websiteId } = await provisionClinic(db, admin.id);
  const connection = await saveConnection(db, {
    clientId, websiteId, provider, externalPropertyId: property, streamOrSiteRef: null,
    providerTimezone: provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore",
    tokenCiphertext: TOKEN.ciphertext, tokenNonce: TOKEN.nonce, actorUserId: admin.id,
  });
  return { clientId, websiteId, connection, admin };
}

function context(db: Queryable, provider: Provider, ids: { clientId: string; websiteId: string; connection: { id: string } }, fetch: FetchLike, budget = 20): JobContext {
  const recorder = recordingFetch(fetch, budget);
  return { db, clientId: ids.clientId, websiteId: ids.websiteId, connectionId: ids.connection.id, provider, fetch, recorder, now: NOW };
}

async function qualityOf(db: Queryable, template: string, start: string, end: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ quality: Record<string, unknown> }>(
    "select quality from analytics_report_partitions where template_key = $1 and start_date = $2 and end_date = $3 order by generation desc limit 1", [template, start, end]);
  return rows[0]!.quality;
}

// ---------------------------------------------------------------------------------------------

describe("GA4 response edge cases (Phase 2.3)", () => {
  it("asks GA4 for the property quota, which it only returns when asked", () => {
    const body = ga4ReportBody({ start: "2026-11-01", end: "2026-11-07", metrics: ["sessions"] }) as Record<string, unknown>;
    expect(body.returnPropertyQuota).toBe(true);
  });

  it("reads the report's own warnings, quota and row count, and changes no number", () => {
    const report = parseGa4Report({
      dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "sessions" }],
      rows: [{ dimensionValues: [{ value: "20261101" }], metricValues: [{ value: "12" }] }],
      rowCount: 480,
      metadata: {
        timeZone: "America/Los_Angeles", dataLossFromOtherRow: true, subjectToThresholding: true, emptyReason: "x",
        samplingMetadatas: [{ samplesReadCount: "500000", samplingSpaceSize: "1000000" }],
      },
      propertyQuota: { tokensPerDay: { consumed: 9, remaining: 199_991 } },
    });
    expect(report.rows[0]!.metrics.sessions).toBe(12);
    expect(report.rowCount).toBe(480);
    expect(report.quota).toEqual({ tokens: 9 });
    expect(report.meta).toMatchObject({ timeZone: "America/Los_Angeles", dataLossFromOtherRow: true, subjectToThresholding: true, sampledShare: 0.5 });
  });

  it("does not turn a value that is not a number into a stored number", () => {
    const report = parseGa4Report({
      dimensionHeaders: [], metricHeaders: [{ name: "sessions" }, { name: "totalUsers" }],
      rows: [{ dimensionValues: [], metricValues: [{ value: "not-a-number" }, { value: "5" }] }],
    });
    expect(report.rows[0]!.metrics).toEqual({ totalUsers: 5 });
    expect(report.invalidValues).toBe(1);
  });

  it("records time zone mismatch, thresholding, sampling and the row count beside the report", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    void admin;
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "ga4");
      const fetch: FetchLike = async () => response(200, {
        dimensionHeaders: [], metricHeaders: [{ name: "sessions" }, { name: "totalUsers" }],
        rows: [{ dimensionValues: [], metricValues: [{ value: "10" }, { value: "oops" }] }],
        rowCount: 1,
        metadata: { timeZone: "America/New_York", subjectToThresholding: true, samplingMetadatas: [{ samplesReadCount: "1", samplingSpaceSize: "4" }] },
        propertyQuota: { tokensPerDay: { consumed: 7 } },
      });
      const ctx = context(db, "ga4", ids, fetch);
      const record = await runMeasuredJob(ctx, "ga4.traffic_range", { start: "2026-11-01", end: "2026-11-07" });
      expect(record).toMatchObject({ result: "succeeded", requests: 1, status: 200, rowsReturned: 1, pages: 1, quotaTokensConsumed: 7, retryRequired: false });
      const quality = await qualityOf(db, "ga4.traffic_range", "2026-11-01", "2026-11-07");
      expect(quality).toMatchObject({
        providerTimeZone: "America/New_York", timezoneMismatch: { property: "America/New_York", configured: "Asia/Singapore" },
        subjectToThresholding: true, sampledShare: 0.25, invalidValues: 1, providerRowCount: 1,
      });
      // The metric the provider sent as text is unavailable, not zero and not NaN.
      const report = await publishedReport(db, { clientId: ids.clientId, websiteId: ids.websiteId, templateKey: "ga4.traffic_range", start: "2026-11-01", end: "2026-11-07" });
      const users = report!.rows[0]!.metrics.find((m) => m.key === "totalUsers");
      expect(users).toMatchObject({ state: "unavailable", value: null });
      expect(report!.rows[0]!.metrics.find((m) => m.key === "sessions")).toMatchObject({ state: "available", value: 10 });
    });
  });

  it("marks a report truncated when the page cap stops it with more to read, and does not when it finished", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "ga4");
      // Endless pages: every request returns a full page and says the result is far larger.
      let serial = 0;
      const endless: FetchLike = async (_url, init) => {
        const limit = (JSON.parse(init!.body!) as { limit: number }).limit;
        return response(200, {
          dimensionHeaders: [{ name: "pagePath" }], metricHeaders: [{ name: "screenPageViews" }],
          rows: Array.from({ length: limit }, () => ({ dimensionValues: [{ value: `/page-${(serial += 1)}` }], metricValues: [{ value: "1" }] })),
          rowCount: 1_000_000,
        });
      };
      await enqueueJob(db, { clientId: ids.clientId, websiteId: ids.websiteId, connectionId: ids.connection.id, templateKey: "ga4.pages", start: "2026-11-01", end: "2026-11-07", now: NOW });
      const step = await runWorkerOnce(async (fn) => fn(db), "t", { fetch: endless, now: NOW, pageSize: 3 });
      expect(step.result).toBe("succeeded");
      const quality = await qualityOf(db, "ga4.pages", "2026-11-01", "2026-11-07");
      expect(quality).toMatchObject({ truncated: true, providerRowCount: 1_000_000, rowsReturned: 3 * MAX_PROVIDER_PAGES });
    });
  });

  it("keeps reading when a page is short but the provider's own row count says more remain", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "ga4");
      let calls = 0;
      const fetch: FetchLike = async (_url, init) => {
        calls += 1;
        const offset = (JSON.parse(init!.body!) as { offset: number }).offset;
        // Total of 5 rows, delivered 2 at a time with a page limit of 10: the pages are short but the count is 5.
        const take = Math.max(0, Math.min(2, 5 - offset));
        return response(200, {
          dimensionHeaders: [{ name: "pagePath" }], metricHeaders: [{ name: "screenPageViews" }],
          rows: Array.from({ length: take }, (_, i) => ({ dimensionValues: [{ value: `/p${offset + i}` }], metricValues: [{ value: "1" }] })),
          rowCount: 5,
        });
      };
      await enqueueJob(db, { clientId: ids.clientId, websiteId: ids.websiteId, connectionId: ids.connection.id, templateKey: "ga4.pages", start: "2026-11-01", end: "2026-11-07", now: NOW });
      await runWorkerOnce(async (fn) => fn(db), "t", { fetch, now: NOW, pageSize: 10 });
      expect(calls).toBe(3);
      const quality = await qualityOf(db, "ga4.pages", "2026-11-01", "2026-11-07");
      expect(quality).toMatchObject({ rowsReturned: 5, providerRowCount: 5 });
      expect(quality.truncated).toBeUndefined();
      expect(quality.rowCountMismatch).toBeUndefined();
    });
  });

  it("tells a zero-session day from a day the provider did not return", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "ga4");
      const fetch: FetchLike = async () => response(200, {
        dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "sessions" }],
        // 3 November has a recorded zero. 2 November is absent altogether.
        rows: [
          { dimensionValues: [{ value: "20261101" }], metricValues: [{ value: "4" }] },
          { dimensionValues: [{ value: "20261103" }], metricValues: [{ value: "0" }] },
        ],
      });
      await runMeasuredJob(context(db, "ga4", ids, fetch), "ga4.traffic_daily", { start: "2026-11-01", end: "2026-11-03" });
      const report = await publishedReport(db, { clientId: ids.clientId, websiteId: ids.websiteId, templateKey: "ga4.traffic_daily", start: "2026-11-01", end: "2026-11-03" });
      const byDate = Object.fromEntries(report!.rows.map((r) => [r.dimensions.date, r.metrics[0]]));
      expect(byDate["2026-11-03"]).toMatchObject({ state: "available", value: 0 });
      expect(byDate["2026-11-02"]).toBeUndefined();
    });
  });
});

describe("Search Console response edge cases (Phase 2.3)", () => {
  it("drops a row whose numbers are not numbers and counts it", () => {
    const parsed = parseGscQuery({ rows: [
      { keys: ["a"], clicks: 1, impressions: 10, ctr: 0.1, position: 3 },
      { keys: ["b"], clicks: "x", impressions: 10, ctr: 0.1, position: 3 },
    ] });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.invalidRows).toBe(1);
  });

  it("counts what the privacy filter withholds, so a list can be reconciled with its total", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "gsc");
      const fetch: FetchLike = async () => response(200, { rows: [
        { keys: ["dental implants cost"], clicks: 5, impressions: 50, ctr: 0.1, position: 4 },
        { keys: ["symptoms of gum disease"], clicks: 3, impressions: 40, ctr: 0.075, position: 6 },
        { keys: ["mobile dentist near me"], clicks: 2, impressions: 20, ctr: 0.1, position: 5 },
        { keys: ["jane@example.invalid"], clicks: 1, impressions: 2, ctr: 0.5, position: 1 },
      ] });
      await runMeasuredJob(context(db, "gsc", ids, fetch), "gsc.queries", { start: "2026-11-01", end: "2026-11-07" });
      const quality = await qualityOf(db, "gsc.queries", "2026-11-01", "2026-11-07");
      // Since Phase 2.3A only the email address is withheld; the three ordinary queries are kept.
      expect(quality.withheldByPrivacyFilter).toEqual({ rows: 1, clicks: 1, impressions: 2, byReason: { email: 1 } });
      expect(quality.rowsReturned).toBe(3);
    });
  });

  it("marks a list truncated at the page cap", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "gsc");
      let serial = 0;
      const endless: FetchLike = async (_url, init) => {
        const { rowLimit } = JSON.parse(init!.body!) as { rowLimit: number };
        return response(200, { rows: Array.from({ length: rowLimit }, () => ({ keys: [`dental query ${(serial += 1)}`], clicks: 1, impressions: 2, ctr: 0.5, position: 2 })) });
      };
      await enqueueJob(db, { clientId: ids.clientId, websiteId: ids.websiteId, connectionId: ids.connection.id, templateKey: "gsc.queries", start: "2026-11-01", end: "2026-11-07", now: NOW });
      await runWorkerOnce(async (fn) => fn(db), "t", { fetch: endless, now: NOW, pageSize: 2 });
      expect(await qualityOf(db, "gsc.queries", "2026-11-01", "2026-11-07")).toMatchObject({ truncated: true });
    });
  });
});

describe("Wix response edge cases (Phase 2.3)", () => {
  it("reads a missing value as zero (as before) and drops a value that is not a number", () => {
    const points = parseWixData({ data: [{ type: "TOTAL_SESSIONS", values: [{ date: "2026-11-01", value: 5 }, { date: "2026-11-02" }, { date: "2026-11-03", value: "n/a" }] }] });
    expect(points).toEqual([{ measure: "TOTAL_SESSIONS", date: "2026-11-01", value: 5 }, { measure: "TOTAL_SESSIONS", date: "2026-11-02", value: 0 }]);
  });
});

describe("Zero, missing and failed are different things (Phase 2.3)", () => {
  it("compares a missing value as not comparable, never as zero", () => {
    const w = { start: "2026-11-01", end: "2026-11-07" };
    expect(compareNumbers("a", w, 0, 0).verdict).toBe("match");
    expect(compareNumbers("a", w, 0, null).verdict).toBe("not_comparable");
    expect(compareNumbers("a", w, null, 0).verdict).toBe("not_comparable");
    expect(compareNumbers("a", w, 0, 3)).toMatchObject({ verdict: "differs", abs: 3, pct: null });
    expect(compareNumbers("a", w, 1000, 1004)).toMatchObject({ verdict: "within_tolerance", abs: 4, pct: 0.4 });
    expect(compareNumbers("a", w, 1000, 1100)).toMatchObject({ verdict: "differs", pct: 10 });
    expect(compareNumbers("a", w, 100, 60, 0, "x", true).verdict).toBe("expected_difference");
  });

  it("stores a provider failure as a failure, with no report and no zero", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "gsc");
      const record = await runMeasuredJob(context(db, "gsc", ids, async () => response(503, {})), "gsc.totals", { start: "2026-11-01", end: "2026-11-07" });
      expect(record).toMatchObject({ result: "retry", status: 503, retryRequired: true, requests: 1 });
      expect(await publishedReport(db, { clientId: ids.clientId, websiteId: ids.websiteId, templateKey: "gsc.totals", start: "2026-11-01", end: "2026-11-07" })).toBeNull();
    });
  });

  it("stores a real empty answer as an empty report", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "gsc");
      const record = await runMeasuredJob(context(db, "gsc", ids, async () => response(200, {})), "gsc.totals", { start: "2026-11-01", end: "2026-11-07" });
      expect(record).toMatchObject({ result: "succeeded", rowsReturned: 0 });
      expect((await publishedReport(db, { clientId: ids.clientId, websiteId: ids.websiteId, templateKey: "gsc.totals", start: "2026-11-01", end: "2026-11-07" }))?.completeness).toBe("empty");
    });
  });
});

describe("validation harness against the fictional provider (Phase 2.3)", () => {
  it("validates GA4: derived channel windows equal direct ones, within the request cap", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "ga4");
      const ctx = context(db, "ga4", ids, fictionalProviders().fetch, 14);
      const plan = await validateGa4(ctx, "2026-11-08");
      expect(ctx.recorder.total()).toBeLessThanOrEqual(14);
      expect(plan.comparisons.length).toBeGreaterThanOrEqual(7);
      expect(plan.comparisons.filter((c) => c.verdict === "differs" || c.verdict === "not_comparable")).toEqual([]);
      expect(plan.requests.every((r) => r.result === "succeeded")).toBe(true);
      expect(plan.requests.find((r) => r.template === "ga4.bundle.channel")).toMatchObject({ requests: 1, pages: 1 });
    });
  });

  it("validates Search Console: derived totals equal the property total, and list shortfalls are expected differences", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "gsc");
      const ctx = context(db, "gsc", ids, fictionalProviders().fetch, 8);
      const plan = await validateGsc(ctx, "2026-11-08");
      const totals = plan.comparisons.filter((c) => c.name.includes("derived from daily rows"));
      expect(totals).toHaveLength(8);
      expect(totals.every((c) => c.verdict === "match")).toBe(true);
      const lists = plan.comparisons.filter((c) => c.name.includes(": sum of"));
      expect(lists).toHaveLength(4);
      expect(lists.every((c) => c.verdict === "expected_difference")).toBe(true);
    });
  });

  it("validates Wix: totals add up, distinct visitors are flagged as not additive, and the day boundary check runs", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "wix");
      const ctx = context(db, "wix", ids, fictionalProviders().fetch, 4);
      const plan = await validateWix(ctx, "2026-11-12", { accessToken: "t", timezone: "Asia/Singapore" });
      const byName = (needle: string) => plan.comparisons.find((c) => c.name.startsWith(needle))!;
      expect(byName("total_sessions").verdict).toBe("match");
      expect(byName("clicks_to_contact").verdict).toBe("match");
      expect(byName("total_forms_submitted").verdict).toBe("match");
      expect(byName("total_unique_visitors")).toMatchObject({ verdict: "expected_difference" });
      expect(byName("sessions, days whose value changes").verdict).toBe("match");
      expect(ctx.recorder.total()).toBe(3);
    });
  });

  it("REPORTS a difference rather than hiding it: a provider whose daily rows do not add up to its range total", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "ga4");
      const real = fictionalProviders().fetch;
      // The range total is two sessions short of the sum of the days, as thresholding or attribution could cause.
      const skewed: FetchLike = async (url, init) => {
        const res = await real(url, init);
        const body = JSON.parse(init?.body ?? "{}") as { dimensions?: unknown[]; metrics?: Array<{ name: string }> };
        if ((body.dimensions ?? []).length === 0 && body.metrics?.[0]?.name === "sessions") {
          const json = (await res.json()) as { rows: Array<{ metricValues: Array<{ value: string }> }> };
          json.rows[0]!.metricValues[0]!.value = String(Number(json.rows[0]!.metricValues[0]!.value) - 2);
          return response(200, json);
        }
        return res;
      };
      const plan = await validateGa4(context(db, "ga4", ids, skewed, 14), "2026-11-08");
      const sums = plan.comparisons.filter((c) => c.name.startsWith("sessions, 7 days: sum of daily rows"));
      expect(sums[0]).toMatchObject({ verdict: "differs", abs: 2, direct: 19, derived: 21 });
      expect(sums[0]!.pct).toBeCloseTo(10.5263, 3);
    });
  });

  it("stops at the request cap instead of making more requests", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "ga4");
      const ctx = context(db, "ga4", ids, fictionalProviders().fetch, 2);
      const records: string[] = [];
      try {
        const plan = await validateGa4(ctx, "2026-11-08");
        records.push(...plan.requests.map((r) => r.result));
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationBudgetError);
      }
      expect(ctx.recorder.total()).toBe(2);
    });
  });

  it("writes numbers and labels only: no token, property id or site", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await setup(db, "gsc");
      const ctx = context(db, "gsc", ids, fictionalProviders().fetch, 8);
      const plan = await validateGsc(ctx, "2026-11-08");
      const evidence = { ...assembleEvidence({ mode: "fictional", provider: "gsc", propertyId: FIXTURE_PROPERTY.gsc, plan }), latency: summariseLatency(plan.requests) };
      const text = JSON.stringify(evidence);
      for (const secret of ["fixture-token-do-not-print", "validation.example.invalid", "sc-domain", "Bearer", "googleapis.com"]) expect(text).not.toContain(secret);
      expect(evidence.propertyRef).toBe(propertyRef(FIXTURE_PROPERTY.gsc));
      expect(evidence.propertyRef).toMatch(/^[0-9a-f]{8}$/);
      expect(Object.keys(evidence.latency)).toContain("gsc.bundle.daily");
    });
  });

  it("keeps each report with its own website and client", async () => {
    await asContext(SERVICE, async (db) => {
      const a = await setup(db, "gsc");
      const b = await (async () => {
        const admin = await staffByEmail("admin@example.invalid");
        const { clientId, websiteId } = await provisionClinic(db, admin.id);
        const connection = await saveConnection(db, {
          clientId, websiteId, provider: "gsc", externalPropertyId: "sc-domain:other.example.invalid", streamOrSiteRef: null,
          providerTimezone: "America/Los_Angeles", tokenCiphertext: TOKEN.ciphertext, tokenNonce: TOKEN.nonce, actorUserId: admin.id,
        });
        return { clientId, websiteId, connection };
      })();
      await validateGsc(context(db, "gsc", a, fictionalProviders().fetch, 8), "2026-11-08");
      // Nothing was stored for the other clinic.
      expect(await publishedReport(db, { clientId: b.clientId, websiteId: b.websiteId, templateKey: "gsc.totals", start: "2026-11-02", end: "2026-11-08" })).toBeNull();
      expect(await publishedReport(db, { clientId: a.clientId, websiteId: b.websiteId, templateKey: "gsc.totals", start: "2026-11-02", end: "2026-11-08" })).toBeNull();
      expect(await publishedReport(db, { clientId: a.clientId, websiteId: a.websiteId, templateKey: "gsc.totals", start: "2026-11-02", end: "2026-11-08" })).not.toBeNull();
    });
  });
});

describe("property association audit (Phase 2.3)", () => {
  it("reads a Search Console property's host from both property types", () => {
    expect(gscPropertyHost("sc-domain:Example.COM")).toBe("example.com");
    expect(gscPropertyHost("https://www.example.com/")).toBe("example.com"); // a leading www. is not part of the identity
    expect(gscPropertyHost("not a url")).toBeNull();
  });
  // The audit itself is tested in analytics-property-association.test.ts (Phase 2.3A).
});

describe("Postgres and NaN (why a non-numeric provider value must never reach storage)", () => {
  it("accepts NaN as at least zero, which the metric check would not catch", async () => {
    const { rows } = await adminPool.query("select ('NaN'::numeric >= 0) as passes");
    expect(rows[0].passes).toBe(true);
  });
});
