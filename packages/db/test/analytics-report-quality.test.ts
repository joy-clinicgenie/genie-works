import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, type Queryable } from "../src/client";
import { response } from "../src/testing/fictional-analytics-provider";
import { adminPool, appPool, asContext, staffByEmail } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { dailySessionSeriesWithPeriod, publishedReport, type PublishedReport } from "../src/analytics/read";
import { enqueueJob, listConnectionSyncStatus, runWorkerOnce, sealedToken, type FetchLike } from "../src/analytics/sync";
import { STALE_AFTER_HOURS, assessReport, summariseQuality, type QualityFinding } from "../src/analytics/quality";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const NOW = new Date("2026-11-12T04:00:00.000Z");
const TOKEN = sealedToken({ accessToken: "t", expiresAt: "2100-01-01T00:00:00.000Z" });

function report(over: Partial<PublishedReport> = {}): PublishedReport {
  return {
    id: "r", templateKey: "ga4.landing", start: "2026-11-01", end: "2026-11-07", timezone: "Asia/Singapore", provenance: "api", completeness: "complete",
    generation: 1, fetchedAt: NOW, measuredThrough: null, quality: {}, rows: [], ...over,
  };
}
const states = (findings: QualityFinding[]) => findings.map((f) => f.state);

describe("report quality states (Phase 2.3A)", () => {
  it("a complete report has one finding, 'complete', and the page shows nothing for it", () => {
    const findings = assessReport({ subject: "Landing pages", report: report(), now: NOW, source: "Google Analytics" });
    expect(states(findings)).toEqual(["complete"]);
    expect(summariseQuality(findings)).toEqual([]);
  });

  it("partial: days missing, a partial report, sampling, thresholding, an (other) row, a time zone mismatch", () => {
    const base = { subject: "Sessions", now: NOW, source: "Google Analytics" };
    expect(assessReport({ ...base, report: report(), coverage: { covered: 5, expected: 7 } })[0]).toMatchObject({ state: "partial", message: "5 of 7 days are recorded. Totals cover only those days." });
    expect(states(assessReport({ ...base, report: report({ completeness: "partial" }) }))).toEqual(["partial"]);
    const flags = assessReport({ ...base, report: report({ quality: { sampledShare: 0.25, subjectToThresholding: true, otherRowRolledUp: true, timezoneMismatch: { property: "America/New_York", configured: "Asia/Singapore" } } }) });
    expect(states(flags)).toEqual(["partial", "partial", "partial", "partial"]);
    expect(flags.map((f) => f.message).join(" ")).toMatch(/about 25% of events/);
    expect(flags.map((f) => f.message).join(" ")).toMatch(/thresholding/);
    expect(flags.map((f) => f.message).join(" ")).toMatch(/own time zone/);
  });

  it("stale: only when the last successful sync is older than the limit", () => {
    const sync = (hoursAgo: number) => ({ status: "connected", lastSuccessAt: new Date(NOW.getTime() - hoursAgo * 3_600_000), safeError: null });
    const base = { subject: "Sessions", report: report(), now: NOW, source: "Google Analytics" };
    expect(states(assessReport({ ...base, sync: sync(STALE_AFTER_HOURS - 1) }))).toEqual(["complete"]);
    const stale = assessReport({ ...base, sync: sync(STALE_AFTER_HOURS + 30) });
    expect(stale[0]).toMatchObject({ state: "stale", severity: "attention" });
    expect(stale[0]!.message).toMatch(/3 days ago/);
  });

  it("truncated: a list that hit the read limit", () => {
    const findings = assessReport({ subject: "Search queries", report: report({ templateKey: "gsc.queries", quality: { truncated: true } }), now: NOW, source: "Search Console" });
    expect(findings[0]).toMatchObject({ state: "truncated", severity: "attention" });
    expect(findings[0]!.message).toMatch(/More rows exist/);
  });

  it("withheld: rows left out, with the clicks or sessions they held, and query strings that carried personal details", () => {
    const gsc = assessReport({ subject: "Search queries", report: report({ quality: { withheldByPrivacyFilter: { rows: 3, clicks: 12000, impressions: 90, byReason: { email: 3 } } } }), now: NOW, source: "Search Console" });
    expect(gsc[0]).toMatchObject({ state: "withheld", severity: "info" });
    expect(gsc[0]!.message).toBe("3 rows were left out (12,000 clicks) because they carried personal identifiers or access tokens. Lists exclude them; totals do not.");
    const one = assessReport({ subject: "Landing pages", report: report({ quality: { withheldByPrivacyFilter: { rows: 1, sessions: 2, byReason: { opaque_identifier: 1 } } } }), now: NOW, source: "Google Analytics" });
    expect(one[0]!.message).toMatch(/^1 row was left out \(2 sessions\) because it carried/);
    const qs = assessReport({ subject: "Landing pages", report: report({ quality: { queryStringsStripped: { rows: 4, withPersonalData: 2 } } }), now: NOW, source: "Google Analytics" });
    expect(qs[0]).toMatchObject({ state: "withheld" });
    expect(qs[0]!.message).toMatch(/^2 page addresses had personal details after the "\?" removed/);
    // No personal details in the removed query strings: nothing to say.
    expect(states(assessReport({ subject: "x", report: report({ quality: { queryStringsStripped: { rows: 4, withPersonalData: 0 } } }), now: NOW, source: "x" }))).toEqual(["complete"]);
  });

  it("provider error: reconnect needed, or a failed sync with nothing recent to show", () => {
    const base = { subject: "Sessions", report: null, now: NOW, source: "Google Analytics" };
    expect(assessReport({ ...base, sync: { status: "reconnect_required", lastSuccessAt: null, safeError: "reconnect_required" } })[0]).toMatchObject({ state: "provider_error" });
    const failed = assessReport({ ...base, sync: { status: "connected", lastSuccessAt: null, safeError: "rate_limited" } });
    expect(failed[0]!.message).toBe("The last sync did not complete: Google Analytics was limiting requests. Figures shown are the last ones stored.");
    // A recent success makes an old error uninteresting.
    expect(assessReport({ ...base, sync: { status: "connected", lastSuccessAt: new Date(NOW.getTime() - 3_600_000), safeError: "rate_limited" } })).toEqual([]);
    // An unknown code never becomes provider text.
    expect(assessReport({ ...base, sync: { status: "connected", lastSuccessAt: null, safeError: "<script>x</script>" } })[0]!.message).toMatch(/returned an error/);
  });

  it("no data is not an error, and unavailable is not no data", () => {
    const empty = assessReport({ subject: "Search queries", report: report({ completeness: "empty" }), now: NOW, source: "Search Console" });
    expect(empty[0]).toMatchObject({ state: "no_data", severity: "info" });
    // No report stored and nothing wrong: the page's own "not prepared yet" wording applies.
    expect(assessReport({ subject: "x", report: null, now: NOW, source: "x" })).toEqual([]);
  });

  it("a genuine zero is explained, a missing value is not called a zero", () => {
    const base = { subject: "Sessions", report: report(), now: NOW, source: "Google Analytics" };
    const zero = assessReport({ ...base, figure: { value: 0, state: "available", noun: "sessions" } });
    expect(zero[0]).toMatchObject({ state: "genuine_zero", severity: "info" });
    expect(zero[0]!.message).toMatch(/recorded zero, not missing data/);
    expect(states(assessReport({ ...base, figure: { value: null, state: "unavailable", noun: "sessions" } }))).toEqual(["complete"]);
    expect(states(assessReport({ ...base, figure: { value: 12, state: "available", noun: "sessions" } }))).toEqual(["complete"]);
  });

  it("groups the same message across subjects, orders by what matters, and uses a word as well as a tone", () => {
    const findings: QualityFinding[] = [
      ...assessReport({ subject: "Sessions", report: report(), now: NOW, source: "Google Analytics", figure: { value: 0, state: "available", noun: "sessions" } }),
      ...assessReport({ subject: "Landing pages", report: report({ quality: { truncated: true } }), now: NOW, source: "Google Analytics" }),
      ...assessReport({ subject: "Pages", report: report({ quality: { truncated: true } }), now: NOW, source: "Google Analytics" }),
      ...assessReport({ subject: "Sessions", report: null, now: NOW, source: "Google Analytics", sync: { status: "reconnect_required", lastSuccessAt: null, safeError: null } }),
    ];
    const notes = summariseQuality(findings);
    expect(notes.map((x) => x.label)).toEqual(["Provider problem", "Truncated", "Recorded zero"]);
    expect(notes[1]!.text.startsWith("Landing pages, Pages: ")).toBe(true);
    expect(notes.every((x) => x.label.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// From real stored reports

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
const pull = async (db: Queryable, ids: { clientId: string; websiteId: string; connectionId: string }, template: string, fetch: FetchLike, window = { start: "2026-11-01", end: "2026-11-07" }, deps: { pageSize?: number } = {}) => {
  await enqueueJob(db, { ...ids, templateKey: template, start: window.start, end: window.end, now: NOW });
  return runWorkerOnce(async (fn) => fn(db), "t", { fetch, now: NOW, ...deps });
};

describe("quality from stored reports", () => {
  it("withheld rows and a truncated list are visible in the stored report, and the notes echo none of the withheld text", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await clinic(db, "gsc");
      let serial = 0;
      const fetch: FetchLike = async (_u, init) => {
        const { rowLimit } = JSON.parse(init!.body!) as { rowLimit: number };
        return response(200, { rows: Array.from({ length: rowLimit }, () => {
          serial += 1;
          // Every other row is an email address, which is withheld.
          return { keys: [serial % 2 === 0 ? `person${serial}@example.invalid` : `dental query ${serial}`], clicks: 1, impressions: 3, ctr: 0.33, position: 2 };
        }) });
      };
      await pull(db, ids, "gsc.queries", fetch, undefined, { pageSize: 4 });
      const stored = await publishedReport(db, { ...ids, templateKey: "gsc.queries", start: "2026-11-01", end: "2026-11-07" });
      const findings = assessReport({ subject: "Search queries", report: stored, now: NOW, source: "Search Console" });
      expect(states(findings).sort()).toEqual(["truncated", "withheld"]);
      const notes = summariseQuality(findings);
      const text = JSON.stringify(notes);
      expect(text).not.toMatch(/person\d|example\.invalid|dental query/);
      expect(text).toMatch(/left out \(\d+ clicks\)/);
    });
  });

  it("GA4 thresholding and a time zone mismatch reach the notes", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await clinic(db, "ga4");
      const fetch: FetchLike = async () => response(200, {
        dimensionHeaders: [], metricHeaders: [{ name: "sessions" }], rows: [{ dimensionValues: [], metricValues: [{ value: "9" }] }],
        metadata: { timeZone: "America/New_York", subjectToThresholding: true },
      });
      await pull(db, ids, "ga4.traffic_range", fetch);
      const stored = await publishedReport(db, { ...ids, templateKey: "ga4.traffic_range", start: "2026-11-01", end: "2026-11-07" });
      const notes = summariseQuality(assessReport({ subject: "Users", report: stored, now: NOW, source: "Google Analytics" }));
      expect(notes.map((x) => x.label)).toEqual(["Partial", "Partial"]);
      expect(notes.map((x) => x.text).join(" ")).toMatch(/thresholding/);
      expect(notes.map((x) => x.text).join(" ")).toMatch(/time zone/);
    });
  });

  it("no data (an empty answer) is told apart from a failure (no report at all)", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await clinic(db, "gsc");
      await pull(db, ids, "gsc.totals", async () => response(200, {}));
      const empty = await publishedReport(db, { ...ids, templateKey: "gsc.totals", start: "2026-11-01", end: "2026-11-07" });
      expect(states(assessReport({ subject: "Search totals", report: empty, now: NOW, source: "Search Console" }))).toEqual(["no_data"]);

      await pull(db, ids, "gsc.pages", async () => response(503, {}));
      expect(await publishedReport(db, { ...ids, templateKey: "gsc.pages", start: "2026-11-01", end: "2026-11-07" })).toBeNull();
      const sync = (await listConnectionSyncStatus(db, ids.clientId))[0]!;
      expect(sync.safeError).toBe("provider_unavailable");
      const findings = assessReport({ subject: "Search pages", report: null, now: new Date(sync.lastSuccessAt!.getTime() + 25 * 3_600_000), source: "Search Console", sync: { status: "connected", lastSuccessAt: sync.lastSuccessAt, safeError: sync.safeError } });
      expect(findings[0]).toMatchObject({ state: "provider_error" });
    });
  });

  it("a recorded zero day counts as covered; an unreturned day is not covered", async () => {
    await asContext(SERVICE, async (db) => {
      const ids = await clinic(db, "ga4");
      const fetch: FetchLike = async () => response(200, {
        dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "sessions" }],
        rows: [{ dimensionValues: [{ value: "20261101" }], metricValues: [{ value: "4" }] }, { dimensionValues: [{ value: "20261103" }], metricValues: [{ value: "0" }] }],
      });
      await pull(db, ids, "ga4.traffic_daily", fetch, { start: "2026-11-01", end: "2026-11-03" });
      const series = await dailySessionSeriesWithPeriod(db, { clientId: ids.clientId, websiteId: ids.websiteId, templateKey: "ga4.traffic_daily", metric: "sessions", start: "2026-11-01", end: "2026-11-03" });
      // 1 Nov and 3 Nov are recorded (3 Nov as a zero); 2 Nov was never returned.
      expect(series.period.covered).toBe(2);
      expect(series.period.expected).toBe(3);
      const findings = assessReport({ subject: "Sessions", report: null, now: NOW, source: "Google Analytics", coverage: { covered: series.period.covered, expected: series.period.expected } });
      expect(findings[0]!.message).toBe("2 of 3 days are recorded. Totals cover only those days.");
    });
  });

  it("a report cannot be read under another client's identifiers", async () => {
    await asContext(SERVICE, async (db) => {
      const a = await clinic(db, "gsc");
      await pull(db, a, "gsc.totals", async () => response(200, { rows: [{ keys: [], clicks: 1, impressions: 2, ctr: 0.5, position: 1 }] }));
      const admin = await staffByEmail("admin@example.invalid");
      const b = await provisionClinic(db, admin.id);
      const wrong = [
        { clientId: b.clientId, websiteId: a.websiteId },
        { clientId: a.clientId, websiteId: b.websiteId },
        { clientId: b.clientId, websiteId: b.websiteId },
      ];
      for (const ids of wrong) expect(await publishedReport(db, { ...ids, templateKey: "gsc.totals", start: "2026-11-01", end: "2026-11-07" })).toBeNull();
      expect(await publishedReport(db, { clientId: a.clientId, websiteId: a.websiteId, templateKey: "gsc.totals", start: "2026-11-01", end: "2026-11-07" })).not.toBeNull();
    });
  });
});
