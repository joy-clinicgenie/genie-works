import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, type Queryable } from "../src/client";
import { response } from "../src/testing/fictional-analytics-provider";
import { adminPool, appPool, asContext, staffByEmail } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { GA4_TEMPLATES } from "../src/analytics/providers/ga4";
import { deriveGscTotals, deriveSessionsByDimension } from "../src/analytics/scheduling";
import { scanStoredValues } from "../src/analytics/privacy-scan";
import { enqueueJob, runWorkerOnce, sealedToken, type FetchLike } from "../src/analytics/sync";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const NOW = new Date("2026-11-12T04:00:00.000Z");
const TOKEN = sealedToken({ accessToken: "t", expiresAt: "2100-01-01T00:00:00.000Z" });

async function clinic(db: Queryable, provider: "ga4" | "gsc") {
  const admin = await staffByEmail("admin@example.invalid");
  await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
  const { clientId, websiteId } = await provisionClinic(db, admin.id);
  const c = await saveConnection(db, {
    clientId, websiteId, provider, externalPropertyId: provider === "ga4" ? "700001" : "sc-domain:check.example.invalid", streamOrSiteRef: null,
    providerTimezone: provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore", tokenCiphertext: TOKEN.ciphertext, tokenNonce: TOKEN.nonce, actorUserId: admin.id,
  });
  return { clientId, websiteId, connectionId: c.id };
}

describe("stored values written before the privacy rules (read-only scan)", () => {
  it("counts what the current rules would withhold or strip, by template and reason, and prints no value", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await clinic(db, "ga4");
      // Reports as the old code stored them: unchecked GA4 values, written straight into the tables.
      const legacy = async (template: string, hash: string, keys: string[]) => {
        const p = await db.query<{ id: string }>(
          `insert into analytics_report_partitions (client_id, website_id, connection_id, template_key, query_hash, start_date, end_date, source_timezone, provenance, completeness, generation, published)
           values ($1, $2, $3, $4, $5, '2026-10-01', '2026-10-07', 'Asia/Singapore', 'api', 'complete', 1, true) returning id`,
          [ids.clientId, ids.websiteId, ids.connectionId, template, hash.repeat(64).slice(0, 64)]);
        for (const key of keys) {
          await db.query("insert into analytics_report_rows (partition_id, client_id, website_id, dimension_key, dimensions) values ($1, $2, $3, $4, '{}')", [p.rows[0]!.id, ids.clientId, ids.websiteId, key]);
        }
      };
      await legacy("ga4.landing", "a", ["/thank-you?email=person@example.invalid&phone=91234567", "/reset-password/a1b2c3d4e5f60718293a4b5c6d7e8f90", "/for-patients", "/contact"]);
      await legacy("gsc.queries", "b", ["dentist 9123 4567", "patient reviews dentist", "my email is"]);
      const scan = await scanStoredValues(db);
      const find = (template: string, issue: string) => scan.findings.find((f) => f.template === template && f.issue === issue);
      expect(find("ga4.landing", "query_string_in_value")).toMatchObject({ distinctValues: 1, rows: 1 });
      expect(find("ga4.landing", "opaque_identifier")).toMatchObject({ distinctValues: 1, rows: 1 });
      expect(find("gsc.queries", "phone_number")).toMatchObject({ distinctValues: 1, rows: 1 });
      expect(find("gsc.queries", "self_disclosure")).toMatchObject({ distinctValues: 1, rows: 1 });
      expect(scan.findings.some((f) => f.template === "ga4.landing" && f.issue === "email")).toBe(false);
      expect(scan.distinctValuesChecked).toBe(7);
      const text = JSON.stringify(scan);
      for (const needle of ["person@example", "91234567", "reset-password", "a1b2c3d4", "9123 4567", "my email"]) expect(text).not.toContain(needle);
    });
  });

  it("changes nothing", async () => {
    await asContext(SERVICE, async (db) => {
      await db.query("set transaction read only");
      await scanStoredValues(db);
      await expect(db.query("update analytics_report_rows set dimension_key = dimension_key")).rejects.toMatchObject({ code: "25006" });
    });
  });
});

describe("metric definitions are unchanged (Phase 2.3A)", () => {
  it("keeps the GA4 metrics each report asks for, including the two different users measures", () => {
    const metrics = (key: string) => GA4_TEMPLATES[key]!.metrics;
    expect(metrics("ga4.traffic_range")).toEqual(["sessions", "totalUsers"]); // headline Users
    expect(metrics("ga4.pages")).toEqual(["screenPageViews", "userEngagementDuration", "activeUsers"]);
    expect(metrics("ga4.visitor_type")).toEqual(["activeUsers"]);
    expect(metrics("ga4.engagement")).toEqual(["engagementRate", "averageSessionDuration", "screenPageViewsPerSession", "bounceRate"]);
    expect(metrics("ga4.traffic_daily")).toEqual(["sessions"]);
    for (const key of ["ga4.acquisition", "ga4.landing", "ga4.device", "ga4.country"]) expect(metrics(key)).toEqual(["sessions"]);
    expect(GA4_TEMPLATES["ga4.traffic_range"]!.dimensions).toEqual([]);
  });

  it("keeps the derivations: sessions add, CTR is clicks over impressions, position is weighted", () => {
    const [total] = deriveGscTotals([
      { date: "2026-11-01", clicks: 1, impressions: 100, ctr: 0.01, position: 10 },
      { date: "2026-11-02", clicks: 9, impressions: 10, ctr: 0.9, position: 2 },
    ], { start: "2026-11-01", end: "2026-11-02" });
    const metric = (k: string) => total!.metrics.find((m) => m.key === k)!.value;
    expect([metric("clicks"), metric("impressions")]).toEqual([10, 110]);
    expect(metric("ctr")).toBeCloseTo(10 / 110, 12);
    expect(metric("position")).toBeCloseTo((10 * 100 + 2 * 10) / 110, 12);
    expect(deriveSessionsByDimension([{ date: "2026-11-01", value: "a", sessions: 2 }, { date: "2026-11-02", value: "a", sessions: 3 }], "x", { start: "2026-11-01", end: "2026-11-02" })[0]!.metrics[0]!.value).toBe(5);
  });

  it("stores the same numbers for the same provider answer: filtering never alters a kept value", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await clinic(db, "ga4");
      const fetch: FetchLike = async () => response(200, {
        dimensionHeaders: [{ name: "landingPage" }], metricHeaders: [{ name: "sessions" }],
        rows: [["/", "120"], ["/services", "45"], ["/contact", "0"]].map(([p, n]) => ({ dimensionValues: [{ value: p }], metricValues: [{ value: n }] })), rowCount: 3,
      });
      await enqueueJob(db, { ...ids, templateKey: "ga4.landing", start: "2026-11-01", end: "2026-11-07", now: NOW });
      await runWorkerOnce(async (fn) => fn(db), "t", { fetch, now: NOW });
      const { rows } = await db.query<{ dimension_key: string; value_numeric: string; value_state: string }>(
        `select r.dimension_key, m.value_numeric, m.value_state from analytics_report_rows r join analytics_metric_values m on m.report_row_id = r.id
         join analytics_report_partitions p on p.id = r.partition_id where p.template_key = 'ga4.landing' order by r.dimension_key`);
      expect(rows.map((r) => [r.dimension_key, Number(r.value_numeric), r.value_state])).toEqual([["/", 120, "available"], ["/contact", 0, "available"], ["/services", 45, "available"]]);
    });
  });
});

describe("nothing published is ever deleted", () => {
  it("a newer pull supersedes the older report by flag only: both generations and every row remain", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await clinic(db, "ga4");
      const answer = (extra: string[]) => async () => response(200, {
        dimensionHeaders: [{ name: "landingPage" }], metricHeaders: [{ name: "sessions" }],
        rows: ["/", ...extra].map((p) => ({ dimensionValues: [{ value: p }], metricValues: [{ value: "5" }] })),
      });
      const pull = async (fetch: FetchLike) => {
        await enqueueJob(db, { ...ids, templateKey: "ga4.landing", start: "2026-11-01", end: "2026-11-07", now: NOW, refreshAfterSeconds: undefined });
        await db.query("update analytics_jobs set state = 'queued', next_attempt_at = $1 where state = 'succeeded'", [NOW.toISOString()]);
        return runWorkerOnce(async (fn) => fn(db), "t", { fetch, now: NOW });
      };
      await pull(answer(["/services"]));
      const count = async () => (await db.query<{ partitions: number; rows: number }>(
        `select count(distinct p.id)::int as partitions, count(r.id)::int as rows from analytics_report_partitions p left join analytics_report_rows r on r.partition_id = p.id where p.template_key = 'ga4.landing'`)).rows[0]!;
      const before = await count();
      await pull(answer(["/services", "/about"]));
      const after = await count();
      expect(after.partitions).toBe(before.partitions + 1);
      expect(after.rows).toBe(before.rows + 3);
      const gens = await db.query<{ generation: number; published: boolean }>("select generation, published from analytics_report_partitions where template_key = 'ga4.landing' order by generation");
      expect(gens.rows).toEqual([{ generation: 1, published: false }, { generation: 2, published: true }]);
    });
  });

  it("the application role cannot delete a report, a row or a metric value", async () => {
    await asContext(SERVICE, async (db) => {
      for (const table of ["analytics_report_partitions", "analytics_report_rows", "analytics_metric_values", "analytics_jobs", "analytics_connections"]) {
        await db.query("savepoint s");
        await expect(db.query(`delete from ${table}`), table).rejects.toMatchObject({ code: "42501" });
        await db.query("rollback to savepoint s");
      }
    });
  });
});
