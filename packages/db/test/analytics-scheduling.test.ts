import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, applyContext, type Queryable } from "../src/client";
import { assertTestDatabase, assertWorkerDatabase } from "../src/database-environment";
import { addDays } from "../src/services/dates";
import { fictionalProviders, response } from "../src/testing/fictional-analytics-provider";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { publishedReport } from "../src/analytics/read";
import {
  dueJobs, enqueueDue, enqueueJob, leaseNext, reapExpiredLeases, resilientFetch, runWorkerOnce, sealedToken,
  type FetchLike, type FetchResponse,
} from "../src/analytics/sync";
import { drainProviderJobs } from "../src/analytics/worker-run";
import {
  BUNDLES, capacityBudget, deriveGscTotals, deriveSessionsByDimension, planDueJobs, plannedReportWindows,
} from "../src/analytics/scheduling";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

// ---------------------------------------------------------------------------------------------
const TOKEN = sealedToken({ accessToken: "fixture-token", expiresAt: "2100-01-01T00:00:00.000Z" });

async function connect(db: Queryable, input: { clientId: string; websiteId: string; provider: "ga4" | "gsc" | "wix"; property: string; timezone?: string }, actorId: string) {
  return saveConnection(db, {
    clientId: input.clientId, websiteId: input.websiteId, provider: input.provider, externalPropertyId: input.property, streamOrSiteRef: null,
    providerTimezone: input.timezone ?? (input.provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore"),
    tokenCiphertext: TOKEN.ciphertext, tokenNonce: TOKEN.nonce, actorUserId: actorId,
  });
}

/** Fresh jobs are stamped with the database clock. The tests run on a fixed clock, so make never-tried jobs due on it. Retry times are left alone. */
async function makeDue(db: Queryable, at: Date): Promise<void> {
  await db.query(
    "update analytics_jobs set next_attempt_at = $1 where state = 'queued' and attempts = 0 and safe_error_code is null and next_attempt_at > $1",
    [at.toISOString()],
  );
}

/** Runs the worker until nothing is due. The loop is the worker's own: lease, pull, store. */
async function drain(db: Queryable, now: Date, fetch: FetchLike, max = 400): Promise<string[]> {
  const results: string[] = [];
  while (results.length < max) {
    await makeDue(db, now);
    const step = await runWorkerOnce(async (fn) => fn(db), "test-worker", { fetch, now });
    if (!step.worked) break;
    results.push(step.result ?? "none");
  }
  return results;
}

async function clearQueue(db: Queryable): Promise<void> {
  await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
}

const NOW = new Date("2026-11-12T04:00:00.000Z"); // 12:00 on 12 Nov in Singapore.

async function jobCounts(db: Queryable, connectionIds: string[]): Promise<Record<string, number>> {
  const { rows } = await db.query<{ state: string; n: number }>(
    "select state, count(*)::int as n from analytics_jobs where connection_id = any($1::uuid[]) group by state", [connectionIds],
  );
  return Object.fromEntries(rows.map((row) => [row.state, row.n]));
}

// ---------------------------------------------------------------------------------------------

describe("Phase 2.1 planning (no database)", () => {
  it("asks each provider for fewer requests than version 1, for the same reporting windows", () => {
    const v2 = { ga4: planDueJobs("ga4", NOW, "Asia/Singapore").length, gsc: planDueJobs("gsc", NOW, null).length, wix: planDueJobs("wix", NOW, "Asia/Singapore").length };
    const v1 = { ga4: dueJobs("ga4", NOW, "Asia/Singapore").length, gsc: dueJobs("gsc", NOW, null).length, wix: dueJobs("wix", NOW, "Asia/Singapore").length };
    expect(v1).toEqual({ ga4: 31, gsc: 18, wix: 1 });
    expect(v2).toEqual({ ga4: 20, gsc: 13, wix: 1 });
    // 1 GA4 + 10 Search Console + 10 Wix connections, as in the diagnostic.
    expect(v1.ga4 + 10 * v1.gsc + 10 * v1.wix).toBe(221);
    expect(v2.ga4 + 10 * v2.gsc + 10 * v2.wix).toBe(160);
  });

  for (const [label, instant] of [["Singapore morning", NOW], ["Pacific evening", new Date("2026-11-12T23:30:00.000Z")], ["month boundary", new Date("2026-12-31T20:00:00.000Z")]] as const) {
    it(`still makes every window version 1 made available (${label})`, () => {
      for (const [provider, zone] of [["ga4", "Asia/Singapore"], ["ga4", "America/Los_Angeles"], ["gsc", null], ["wix", "Asia/Singapore"]] as const) {
        const available = new Set(plannedReportWindows(planDueJobs(provider, instant, zone)).map((w) => `${w.templateKey} ${w.start}..${w.end}`));
        for (const job of dueJobs(provider, instant, zone)) {
          expect(available.has(`${job.templateKey} ${job.start}..${job.end}`), `${provider} ${job.templateKey} ${job.start}..${job.end}`).toBe(true);
        }
      }
    });
  }

  it("never sums ratios: CTR is clicks over impressions and position is weighted by impressions", () => {
    const rows = [
      { date: "2026-11-01", clicks: 1, impressions: 100, ctr: 0.01, position: 10 },
      { date: "2026-11-02", clicks: 9, impressions: 10, ctr: 0.9, position: 2 },
    ];
    const [total] = deriveGscTotals(rows, { start: "2026-11-01", end: "2026-11-02" });
    const metric = (key: string) => total!.metrics.find((m) => m.key === key)!.value;
    expect(metric("clicks")).toBe(10);
    expect(metric("impressions")).toBe(110);
    expect(metric("ctr")).toBeCloseTo(10 / 110, 10);
    expect(metric("ctr")).not.toBeCloseTo(0.01 + 0.9, 2);
    expect(metric("position")).toBeCloseTo((10 * 100 + 2 * 10) / 110, 10);
    expect(metric("position")).not.toBeCloseTo(6, 1); // a plain mean
    const [none] = deriveGscTotals([{ date: "2026-11-01", clicks: 0, impressions: 0, ctr: 0, position: 0 }], { start: "2026-11-01", end: "2026-11-01" });
    expect(none!.metrics.find((m) => m.key === "ctr")).toMatchObject({ value: null, state: "unavailable" });
    expect(deriveGscTotals(rows, { start: "2027-01-01", end: "2027-01-02" })).toEqual([]);
  });

  it("sums sessions only inside the window and keeps a zero", () => {
    const rows = [
      { date: "2026-11-01", value: "Direct", sessions: 5 }, { date: "2026-11-02", value: "Direct", sessions: 0 },
      { date: "2026-11-03", value: "Direct", sessions: 4 }, { date: "2026-11-02", value: "Organic Search", sessions: null },
    ];
    const derived = deriveSessionsByDimension(rows, "sessionDefaultChannelGroup", { start: "2026-11-01", end: "2026-11-02" });
    expect(derived).toHaveLength(1);
    expect(derived[0]!.metrics[0]).toMatchObject({ key: "sessions", value: 5, state: "available" });
  });

  it("budgets capacity from measured seconds and states when it does not fit", () => {
    const fits = capacityBudget({
      jobsPerConnection: { ga4: 20, gsc: 13, wix: 1 }, connections: { ga4: 1, gsc: 10, wix: 10 },
      secondsPerJob: { ga4: 2, gsc: 2, wix: 2 }, invocationBudgetSeconds: 240, invocationsPerDay: 4,
    });
    expect(fits.jobsPerDay).toBe(160);
    expect(fits.workSecondsPerDay).toBe(320);
    expect(fits.invocationsNeeded).toBe(2);
    expect(fits.fitsDaily).toBe(true);
    expect(fits.fitsWithinOneInvocation).toBe(false);
    const tooSlow = capacityBudget({
      jobsPerConnection: { ga4: 20, gsc: 13, wix: 1 }, connections: { ga4: 1, gsc: 10, wix: 10 },
      secondsPerJob: { ga4: 30, gsc: 30, wix: 30 }, invocationBudgetSeconds: 60, invocationsPerDay: 1,
    });
    expect(tooSlow.fitsDaily).toBe(false);
  });

  it("covers every bundle with a provider template that can be requested", () => {
    for (const [key, spec] of Object.entries(BUNDLES)) {
      expect(key.startsWith(`${spec.provider}.bundle.`)).toBe(true);
      expect(spec.days).toBeGreaterThanOrEqual(spec.withPrevious ? 180 : 90);
    }
  });
});

describe("Phase 2.1 bounded drain", () => {
  it("says whether a drain stopped because nothing was due, the job limit, or the time budget", async () => {
    let remaining = 5;
    const step = async () => (remaining-- > 0 ? { worked: true, result: "succeeded" as const } : { worked: false });
    expect((await drainProviderJobs(step, { limit: 100, deadlineAt: Date.now() + 10_000 })).stopped).toBe("empty");
    remaining = 5;
    const limited = await drainProviderJobs(step, { limit: 3, deadlineAt: Date.now() + 10_000 });
    expect(limited).toMatchObject({ stopped: "limit", jobs: 3 });
    remaining = 5;
    let clock = 0;
    const timed = await drainProviderJobs(step, { limit: 100, deadlineAt: 2, now: () => clock++ });
    expect(timed).toMatchObject({ stopped: "deadline", jobs: 1 });
  });
});

describe("Phase 2.1 synchronisation (local database, fictional provider)", () => {
  it("runs a normal daily synchronisation for GA4, Search Console and Wix with one request per planned job", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      const ga4 = await connect(db, { clientId, websiteId, provider: "ga4", property: "700100" }, admin.id);
      const gsc = await connect(db, { clientId, websiteId, provider: "gsc", property: "sc-domain:fixture.example.invalid" }, admin.id);
      const wix = await connect(db, { clientId, websiteId, provider: "wix", property: "wix-fixture-site" }, admin.id);
      expect(await enqueueDue(db, NOW, websiteId)).toBe(34);
      const provider = fictionalProviders();
      const results = await drain(db, NOW, provider.fetch);
      expect(results).toHaveLength(34);
      expect(new Set(results)).toEqual(new Set(["succeeded"]));
      expect(provider.calls).toHaveLength(34);
      expect(provider.calls.filter((c) => c.provider === "ga4")).toHaveLength(20);
      expect(await jobCounts(db, [ga4.id, gsc.id, wix.id])).toEqual({ succeeded: 34 });

      // Derived GA4 reports are ordinary exact-window reports, equal to the sum of the days.
      const today = "2026-11-12";
      const yesterday = addDays(today, -1);
      const acquisition = await publishedReport(db, { clientId, websiteId, templateKey: "ga4.acquisition", start: addDays(yesterday, -29), end: yesterday });
      const bySessions = Object.fromEntries(acquisition!.rows.map((row) => [row.dimensions.sessionDefaultChannelGroup, row.metrics.find((m) => m.key === "sessions")!.value]));
      expect(bySessions).toEqual({ "Organic Search": 30, Direct: 60 });
      const previous = await publishedReport(db, { clientId, websiteId, templateKey: "ga4.acquisition", start: addDays(yesterday, -89 - 90), end: addDays(yesterday, -90) });
      expect(previous?.completeness).toBe("complete");
      for (const template of ["ga4.landing", "ga4.device", "ga4.country"]) {
        const report = await publishedReport(db, { clientId, websiteId, templateKey: template, start: addDays(yesterday, -6), end: yesterday });
        expect(report?.rows.length, template).toBe(2);
      }

      // Search Console totals come from the daily rows; CTR and position are recomputed.
      const latest = addDays("2026-11-11", -3); // Search Console days are Pacific: 20:00 on 11 Nov there.
      const totals = await publishedReport(db, { clientId, websiteId, templateKey: "gsc.totals", start: addDays(latest, -6), end: latest });
      const value = (key: string) => totals!.rows[0]!.metrics.find((m) => m.key === key)!.value!;
      expect(value("clicks")).toBe(14);
      expect(value("ctr")).toBeCloseTo(value("clicks") / value("impressions"), 10);
      expect(totals!.rows[0]!.dimensionKey).toBe("property");
      const wixDaily = await publishedReport(db, { clientId, websiteId, templateKey: "wix.data_daily", start: addDays(today, -61), end: today });
      expect(wixDaily?.rows.length).toBe(62);
    });
  });

  it("derives the same figures a direct request for the same window returns", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      const ga4 = await connect(db, { clientId, websiteId, provider: "ga4", property: "700120" }, admin.id);
      const gsc = await connect(db, { clientId, websiteId, provider: "gsc", property: "sc-domain:parity.example.invalid" }, admin.id);
      const provider = fictionalProviders();
      await enqueueDue(db, NOW, websiteId);
      await drain(db, NOW, provider.fetch);
      const ga4Windows = [{ start: "2026-10-13", end: "2026-11-11" }, { start: "2026-11-05", end: "2026-11-11" }, { start: "2026-08-14", end: "2026-11-11" }];
      const gscWindows = [{ start: "2026-10-10", end: "2026-11-08" }, { start: "2026-11-02", end: "2026-11-08" }, { start: "2026-08-11", end: "2026-11-08" }];
      const read = async (templateKey: string, window: { start: string; end: string }) => {
        const report = await publishedReport(db, { clientId, websiteId, templateKey, start: window.start, end: window.end });
        return Object.fromEntries(report!.rows.map((row) => [row.dimensionKey, Object.fromEntries(row.metrics.map((m) => [m.key, m.value]))]));
      };
      const derived = new Map<string, unknown>();
      for (const window of ga4Windows) derived.set(`ga4.acquisition ${window.start}`, await read("ga4.acquisition", window));
      for (const window of gscWindows) derived.set(`gsc.totals ${window.start}`, await read("gsc.totals", window));
      // Now ask the provider for each window directly, as version 1 did, and compare.
      for (const window of ga4Windows) await enqueueJob(db, { clientId, websiteId, connectionId: ga4.id, templateKey: "ga4.acquisition", start: window.start, end: window.end });
      for (const window of gscWindows) await enqueueJob(db, { clientId, websiteId, connectionId: gsc.id, templateKey: "gsc.totals", start: window.start, end: window.end });
      expect((await drain(db, NOW, provider.fetch)).filter((r) => r !== "succeeded")).toEqual([]);
      for (const window of ga4Windows) expect(await read("ga4.acquisition", window), `ga4 ${window.start}`).toEqual(derived.get(`ga4.acquisition ${window.start}`));
      for (const window of gscWindows) {
        const direct = (await read("gsc.totals", window)).property!;
        const mine = (derived.get(`gsc.totals ${window.start}`) as Record<string, Record<string, number>>).property!;
        for (const key of ["clicks", "impressions"]) expect(direct[key], `${window.start} ${key}`).toBe(mine[key]);
        for (const key of ["ctr", "position"]) expect(direct[key]!, `${window.start} ${key}`).toBeCloseTo(mine[key]!, 9);
      }
    });
  });

  it("keeps a recorded zero-session day and leaves an unreturned day unavailable", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      const connection = await connect(db, { clientId, websiteId, provider: "ga4", property: "700101" }, admin.id);
      const zeroDay: FetchLike = async () => response(200, {
        dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "sessions" }],
        rows: [
          { dimensionValues: [{ value: "20261101" }], metricValues: [{ value: "7" }] },
          { dimensionValues: [{ value: "20261102" }], metricValues: [{ value: "0" }] },
          // 3 November is not returned at all.
          { dimensionValues: [{ value: "20261104" }], metricValues: [{ value: "3" }] },
        ],
      });
      await enqueueJob(db, { clientId, websiteId, connectionId: connection.id, templateKey: "ga4.traffic_daily", start: "2026-11-01", end: "2026-11-04" });
      expect(await drain(db, NOW, zeroDay)).toEqual(["succeeded"]);
      const report = await publishedReport(db, { clientId, websiteId, templateKey: "ga4.traffic_daily", start: "2026-11-01", end: "2026-11-04" });
      const sessions = Object.fromEntries(report!.rows.map((row) => [row.dimensions.date, row.metrics[0]]));
      expect(sessions["2026-11-02"]).toMatchObject({ value: 0, state: "available" });
      expect(sessions["2026-11-03"]).toBeUndefined();
      const covered = await db.query<{ source_date: string }>("select source_date::text from analytics_coverage where connection_id = $1 order by source_date", [connection.id]);
      expect(covered.rows.map((r) => r.source_date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-04"]);
    });
  });

  it("marks the provider's current day partial, then complete once the day has ended", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      const connection = await connect(db, { clientId, websiteId, provider: "ga4", property: "700102" }, admin.id);
      const provider = fictionalProviders();
      await enqueueJob(db, { clientId, websiteId, connectionId: connection.id, templateKey: "ga4.traffic_daily", start: "2026-11-10", end: "2026-11-12" });
      await drain(db, NOW, provider.fetch);
      const state = async () => Object.fromEntries((await db.query<{ source_date: string; state: string }>(
        "select source_date::text, state from analytics_coverage where connection_id = $1", [connection.id])).rows.map((r) => [r.source_date, r.state]));
      expect(await state()).toEqual({ "2026-11-10": "complete", "2026-11-11": "complete", "2026-11-12": "partial" });
      const nextDay = new Date(NOW.getTime() + 86_400_000);
      await enqueueJob(db, { clientId, websiteId, connectionId: connection.id, templateKey: "ga4.traffic_daily", start: "2026-11-10", end: "2026-11-12" });
      await drain(db, nextDay, provider.fetch);
      expect((await state())["2026-11-12"]).toBe("complete");
    });
  });

  it("queues each report once however often planning runs, and the database refuses a second queued copy", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      const connection = await connect(db, { clientId, websiteId, provider: "ga4", property: "700103" }, admin.id);
      expect(await enqueueDue(db, NOW, websiteId)).toBe(20);
      expect(await enqueueDue(db, NOW, websiteId)).toBe(0);
      expect(await enqueueDue(db, new Date(NOW.getTime() + 3_600_000), websiteId)).toBe(0);
      expect((await jobCounts(db, [connection.id])).queued).toBe(20);
      const job = await db.query<Record<string, string>>(
        "select client_id, website_id, connection_id, template_key, query_hash, start_date::text, end_date::text from analytics_jobs where connection_id = $1 limit 1", [connection.id]);
      const row = job.rows[0]!;
      await db.query("savepoint dup");
      await expect(db.query(
        `insert into analytics_jobs (client_id, website_id, connection_id, template_key, query_hash, start_date, end_date)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [row.client_id, row.website_id, row.connection_id, row.template_key, row.query_hash, row.start_date, row.end_date],
      )).rejects.toMatchObject({ code: "23505" });
      await db.query("rollback to savepoint dup");
    });
  });

  it("serves every connection's essential reports before anyone's extras, so no provider starves another", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const a = await provisionClinic(db, admin.id);
      const b = await provisionClinic(db, admin.id);
      const connections = [
        await connect(db, { clientId: a.clientId, websiteId: a.websiteId, provider: "gsc", property: "sc-domain:a.example.invalid" }, admin.id),
        await connect(db, { clientId: a.clientId, websiteId: a.stagingId, provider: "gsc", property: "sc-domain:b.example.invalid" }, admin.id),
        await connect(db, { clientId: b.clientId, websiteId: b.websiteId, provider: "gsc", property: "sc-domain:c.example.invalid" }, admin.id),
        await connect(db, { clientId: b.clientId, websiteId: b.stagingId, provider: "ga4", property: "700104" }, admin.id),
      ];
      await enqueueDue(db, NOW, a.websiteId);
      await enqueueDue(db, NOW, a.stagingId);
      await enqueueDue(db, NOW, b.websiteId);
      await enqueueDue(db, NOW, b.stagingId);
      await makeDue(db, NOW);
      const order: Array<{ connection: string; priority: number }> = [];
      for (;;) {
        const job = await leaseNext(db, "fair", NOW);
        if (!job) break;
        const { rows } = await db.query<{ priority: number }>("select priority from analytics_jobs where id = $1", [job.id]);
        order.push({ connection: job.connection_id, priority: rows[0]!.priority });
        await db.query("update analytics_jobs set state = 'succeeded', lease_owner = null, lease_until = null where id = $1", [job.id]);
      }
      expect(order).toHaveLength(13 * 3 + 20);
      // The first four leases go to four different connections.
      expect(new Set(order.slice(0, 4).map((o) => o.connection))).toEqual(new Set(connections.map((c) => c.id)));
      // Priority never goes backwards: all essentials precede all extras, across providers.
      const priorities = order.map((o) => o.priority);
      expect(priorities).toEqual([...priorities].sort((x, y) => x - y));
      // The GA4 connection's first report is among the first four leases, however many Search Console jobs exist.
      expect(order.slice(0, 4).some((o) => o.connection === connections[3]!.id)).toBe(true);
    });
  });

  it("holds the queue at one plan per connection over seven days, where version 1 grew without limit", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const v2 = await provisionClinic(db, admin.id);
      const v2Connection = await connect(db, { clientId: v2.clientId, websiteId: v2.websiteId, provider: "ga4", property: "700105" }, admin.id);
      const v1Connection = await connect(db, { clientId: v2.clientId, websiteId: v2.stagingId, provider: "ga4", property: "700106" }, admin.id);
      for (let day = 0; day < 7; day += 1) {
        const instant = new Date(NOW.getTime() + day * 86_400_000);
        await enqueueDue(db, instant, v2.websiteId, { planner: "v2" });
        await enqueueDue(db, instant, v2.stagingId, { planner: "v1" });
        const queued = (await jobCounts(db, [v2Connection.id])).queued;
        expect(queued).toBeLessThanOrEqual(20);
      }
      const v2Counts = await jobCounts(db, [v2Connection.id]);
      const v1Counts = await jobCounts(db, [v1Connection.id]);
      expect(v2Counts.queued).toBe(20);
      expect(v2Counts.cancelled).toBeGreaterThanOrEqual(6 * 17); // older windows retired, not deleted
      expect(v1Counts.queued).toBeGreaterThan(100);
    });
  });

  it("completes seven consecutive days with a worker each day and keeps earlier days' reports", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      const ga4 = await connect(db, { clientId, websiteId, provider: "ga4", property: "700107" }, admin.id);
      const gsc = await connect(db, { clientId, websiteId, provider: "gsc", property: "sc-domain:week.example.invalid" }, admin.id);
      const wix = await connect(db, { clientId, websiteId, provider: "wix", property: "wix-week" }, admin.id);
      const provider = fictionalProviders();
      for (let day = 0; day < 7; day += 1) {
        const instant = new Date(NOW.getTime() + day * 86_400_000);
        await enqueueDue(db, instant, websiteId);
        const results = await drain(db, instant, provider.fetch);
        expect(results.filter((r) => r !== "succeeded"), `day ${day}`).toEqual([]);
        expect(results).toHaveLength(34);
        const counts = await jobCounts(db, [ga4.id, gsc.id, wix.id]);
        expect(counts.queued ?? 0).toBe(0);
        expect(counts.leased ?? 0).toBe(0);
        expect(counts.failed ?? 0).toBe(0);
      }
      expect(provider.calls).toHaveLength(7 * 34);
      // Day 0's 30-day window is still published after six later days.
      const day0Yesterday = "2026-11-11";
      const old = await publishedReport(db, { clientId, websiteId, templateKey: "ga4.acquisition", start: addDays(day0Yesterday, -29), end: day0Yesterday });
      expect(old?.rows.length).toBe(2);
    });
  });

  it("retries a provider timeout with backoff, pauses only that connection, and fails the job after the retry limit", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId, stagingId } = await provisionClinic(db, admin.id);
      const broken = await connect(db, { clientId, websiteId, provider: "ga4", property: "700108" }, admin.id);
      const healthy = await connect(db, { clientId, websiteId: stagingId, provider: "ga4", property: "700109" }, admin.id);
      for (const connection of [broken, healthy]) {
        await enqueueJob(db, { clientId, websiteId: connection === broken ? websiteId : stagingId, connectionId: connection.id, templateKey: "ga4.traffic_daily", start: "2026-11-01", end: "2026-11-02", windowClass: "daily180", priority: 10 });
        await enqueueJob(db, { clientId, websiteId: connection === broken ? websiteId : stagingId, connectionId: connection.id, templateKey: "ga4.traffic_range", start: "2026-11-01", end: "2026-11-07", windowClass: "p7", priority: 20 });
      }
      const ok = fictionalProviders();
      const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      const flaky: FetchLike = async (url, init) => {
        if (url.includes("700108")) throw timeout;
        return ok.fetch(url, init);
      };
      const results = await drain(db, NOW, flaky);
      // The broken connection is tried once and then waits; the healthy one finishes both jobs.
      expect(results.sort()).toEqual(["retry", "succeeded", "succeeded"]);
      expect((await jobCounts(db, [healthy.id]))).toEqual({ succeeded: 2 });
      const row = (await db.query<{ cooldown_until: Date; consecutive_failures: number }>("select cooldown_until, consecutive_failures from analytics_connections where id = $1", [broken.id])).rows[0]!;
      expect(row.consecutive_failures).toBe(1);
      expect(row.cooldown_until.getTime()).toBeGreaterThan(NOW.getTime());
      const retried = (await db.query<{ attempts: number; safe_error_code: string; state: string; next_attempt_at: Date }>(
        "select attempts, safe_error_code, state, next_attempt_at from analytics_jobs where connection_id = $1 and attempts > 0", [broken.id])).rows[0]!;
      expect(retried).toMatchObject({ attempts: 1, safe_error_code: "provider_unavailable", state: "queued" });
      expect(retried.next_attempt_at.getTime()).toBeGreaterThan(NOW.getTime());

      // Later passes keep failing until the retry limit marks the job failed. Time moves on each pass.
      let instant = NOW;
      let last = "retry";
      for (let pass = 0; pass < 12 && last !== "failed"; pass += 1) {
        instant = new Date(instant.getTime() + 2 * 3_600_000);
        const step = await runWorkerOnce(async (fn) => fn(db), "test-worker", { fetch: flaky, now: instant });
        if (step.worked) last = step.result!;
      }
      const failed = await db.query("select 1 from analytics_jobs where connection_id = $1 and state = 'failed' and attempts = 5", [broken.id]);
      expect(failed.rowCount).toBe(1);
    });
  });

  it("treats a rate limit as a pause that honours Retry-After, and an invalid response as a retry that stores nothing", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId, stagingId } = await provisionClinic(db, admin.id);
      const limited = await connect(db, { clientId, websiteId, provider: "gsc", property: "sc-domain:limited.example.invalid" }, admin.id);
      const garbled = await connect(db, { clientId, websiteId: stagingId, provider: "ga4", property: "700110" }, admin.id);
      await enqueueJob(db, { clientId, websiteId, connectionId: limited.id, templateKey: "gsc.pages", start: "2026-11-01", end: "2026-11-07" });
      const limitedFetch: FetchLike = async () => response(429, {}, { "retry-after": "900" });
      expect(await drain(db, NOW, limitedFetch)).toEqual(["retry"]);
      const job = (await db.query<{ next_attempt_at: Date; safe_error_code: string }>("select next_attempt_at, safe_error_code from analytics_jobs where connection_id = $1", [limited.id])).rows[0]!;
      expect(job.safe_error_code).toBe("rate_limited");
      expect(job.next_attempt_at.getTime() - NOW.getTime()).toBeGreaterThanOrEqual(900_000);
      const cooldown = (await db.query<{ cooldown_until: Date }>("select cooldown_until from analytics_connections where id = $1", [limited.id])).rows[0]!;
      expect(cooldown.cooldown_until.getTime() - NOW.getTime()).toBeGreaterThanOrEqual(900_000);

      // A good report first, then provider answers that are not reports.
      await enqueueJob(db, { clientId, websiteId: stagingId, connectionId: garbled.id, templateKey: "ga4.traffic_daily", start: "2026-11-01", end: "2026-11-02" });
      await drain(db, NOW, fictionalProviders().fetch);
      const before = await publishedReport(db, { clientId, websiteId: stagingId, templateKey: "ga4.traffic_daily", start: "2026-11-01", end: "2026-11-02" });
      expect(before?.rows).toHaveLength(2);
      const bodies: Array<() => Promise<FetchResponse>> = [
        async () => response(200, {}),
        async () => response(200, "not an object"),
        async () => response(200, { rows: "nope" }),
        async () => ({ status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError("Unexpected token <"); }, text: async () => "<html>" }),
      ];
      await db.query("update analytics_jobs set state = 'cancelled' where connection_id = $1", [limited.id]);
      let instant = NOW;
      for (const body of bodies) {
        instant = new Date(instant.getTime() + 3 * 3_600_000);
        await db.query("update analytics_jobs set state = 'succeeded' where connection_id = $1", [garbled.id]);
        await enqueueJob(db, { clientId, websiteId: stagingId, connectionId: garbled.id, templateKey: "ga4.traffic_daily", start: "2026-11-01", end: "2026-11-02" });
        const results = await drain(db, instant, async () => body());
        expect(results).toEqual(["retry"]);
        const stored = await db.query<{ safe_error_code: string }>("select safe_error_code from analytics_jobs where connection_id = $1 and state = 'queued'", [garbled.id]);
        expect(stored.rows[0]!.safe_error_code).toBe("invalid_response");
        await db.query("update analytics_connections set cooldown_until = null where id = $1", [garbled.id]);
      }
      const after = await publishedReport(db, { clientId, websiteId: stagingId, templateKey: "ga4.traffic_daily", start: "2026-11-01", end: "2026-11-02" });
      expect(after?.generation).toBe(before?.generation);
      expect(after?.rows).toHaveLength(2);
    });
  });

  it("recovers an expired lease and fails a job whose last attempt expired", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      const connection = await connect(db, { clientId, websiteId, provider: "ga4", property: "700111" }, admin.id);
      const queued = await enqueueJob(db, { clientId, websiteId, connectionId: connection.id, templateKey: "ga4.traffic_daily", start: "2026-11-01", end: "2026-11-02" });
      await makeDue(db, NOW);
      const first = await leaseNext(db, "crashed-worker", NOW);
      expect(first?.id).toBe(queued.id);
      // While the lease is live nothing else is leased for this connection.
      expect(await leaseNext(db, "second", new Date(NOW.getTime() + 60_000))).toBeNull();
      // The reaper requeues the job with a short backoff, so it is due a little after the reap.
      const later = new Date(NOW.getTime() + 600_000);
      expect(await reapExpiredLeases(db, later)).toBe(1);
      expect(await leaseNext(db, "too-early", later)).toBeNull();
      const again = await leaseNext(db, "healthy-worker", new Date(later.getTime() + 60_000));
      expect(again?.id).toBe(queued.id);
      expect(again?.attempts).toBe(2);
      expect(again?.lease_owner).toBe("healthy-worker");

      await db.query("update analytics_jobs set attempts = 5, lease_until = $2 where id = $1", [queued.id, new Date(NOW.getTime() - 1000).toISOString()]);
      expect(await reapExpiredLeases(db, NOW)).toBe(1);
      const row = (await db.query<{ state: string; safe_error_code: string }>("select state, safe_error_code from analytics_jobs where id = $1", [queued.id])).rows[0]!;
      expect(row).toEqual({ state: "failed", safe_error_code: "lease_expired" });
    });
  });

  it("keeps a job queued without using an attempt when a server credential is missing", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId, stagingId } = await provisionClinic(db, admin.id);
      const expiring = sealedToken({ accessToken: "old", refreshToken: "refresh", expiresAt: "2020-01-01T00:00:00.000Z" });
      const noClient = await saveConnection(db, {
        clientId, websiteId, provider: "ga4", externalPropertyId: "700112", streamOrSiteRef: null, providerTimezone: "Asia/Singapore",
        tokenCiphertext: expiring.ciphertext, tokenNonce: expiring.nonce, actorUserId: admin.id,
      });
      const noKey = await connect(db, { clientId, websiteId: stagingId, provider: "ga4", property: "700113" }, admin.id);
      await enqueueJob(db, { clientId, websiteId, connectionId: noClient.id, templateKey: "ga4.traffic_daily", start: "2026-11-01", end: "2026-11-02" });
      const provider = fictionalProviders();
      expect(await drain(db, NOW, provider.fetch)).toEqual(["not_configured"]); // no Google client id or secret
      await enqueueJob(db, { clientId, websiteId: stagingId, connectionId: noKey.id, templateKey: "ga4.traffic_daily", start: "2026-11-01", end: "2026-11-02" });
      const key = process.env.ANALYTICS_TOKEN_KEY;
      delete process.env.ANALYTICS_TOKEN_KEY;
      try {
        expect(await drain(db, NOW, provider.fetch)).toEqual(["not_configured"]);
      } finally {
        process.env.ANALYTICS_TOKEN_KEY = key;
      }
      const rows = await db.query<{ attempts: number; state: string; safe_error_code: string }>(
        "select attempts, state, safe_error_code from analytics_jobs where connection_id = any($1::uuid[])", [[noClient.id, noKey.id]]);
      expect(rows.rows.every((r) => r.attempts === 0 && r.state === "queued" && r.safe_error_code === "not_configured")).toBe(true);
      const statuses = await db.query<{ status: string }>("select status from analytics_connections where id = any($1::uuid[])", [[noClient.id, noKey.id]]);
      expect(statuses.rows.every((r) => r.status === "connected")).toBe(true);
      expect(provider.calls).toHaveLength(0);
    });
  });

  it("keeps each client's reports apart and hidden from staff without access", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const outsider = await staffByEmail("specialist-b@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const a = await provisionClinic(db, admin.id);
      const b = await provisionClinic(db, admin.id);
      const ga = await connect(db, { clientId: a.clientId, websiteId: a.websiteId, provider: "ga4", property: "700114" }, admin.id);
      const gb = await connect(db, { clientId: b.clientId, websiteId: b.websiteId, provider: "ga4", property: "700115" }, admin.id);
      await enqueueDue(db, NOW, a.websiteId);
      await enqueueDue(db, NOW, b.websiteId);
      const results = await drain(db, NOW, fictionalProviders().fetch);
      expect(results).toHaveLength(40);
      const crossed = await db.query(
        `select 1 from analytics_report_partitions where (connection_id = $1 and client_id <> $2) or (connection_id = $3 and client_id <> $4)`,
        [ga.id, a.clientId, gb.id, b.clientId]);
      expect(crossed.rowCount).toBe(0);
      expect(await publishedReport(db, { clientId: b.clientId, websiteId: a.websiteId, templateKey: "ga4.acquisition", start: "2026-10-14", end: "2026-11-11" })).toBeNull();
      expect(await publishedReport(db, { clientId: a.clientId, websiteId: a.websiteId, templateKey: "ga4.acquisition", start: "2026-10-13", end: "2026-11-11" })).not.toBeNull();
      await applyContext(db, staffCtx(outsider));
      for (const table of ["analytics_report_partitions", "analytics_jobs", "analytics_sync_runs"]) {
        const seen = await db.query(`select 1 from ${table} where connection_id = any($1::uuid[])`, [[ga.id, gb.id]]);
        expect(seen.rowCount, table).toBe(0);
      }
    });
  });

  it("does not store a derived report when the write fails, and recovers on the next lease", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      const connection = await connect(db, { clientId, websiteId, provider: "gsc", property: "sc-domain:txn.example.invalid" }, admin.id);
      const job = await enqueueJob(db, { clientId, websiteId, connectionId: connection.id, templateKey: "gsc.bundle.daily", start: "2026-05-17", end: "2026-11-09", windowClass: "b180", priority: 10 });
      const provider = fictionalProviders();
      // The store step is rolled back as a failed commit would be: claim succeeds, finalisation does not.
      let calls = 0;
      const failingRun = async <T>(fn: (q: Queryable) => Promise<T>): Promise<T> => {
        calls += 1;
        if (calls === 1) return fn(db); // the claim
        await db.query("savepoint store");
        await fn(db);
        await db.query("rollback to savepoint store");
        throw new Error("commit failed");
      };
      await makeDue(db, NOW);
      await expect(runWorkerOnce(failingRun, "txn-worker", { fetch: provider.fetch, now: NOW })).rejects.toThrow("commit failed");
      const state = (await db.query<{ state: string }>("select state from analytics_jobs where id = $1", [job.id])).rows[0]!.state;
      expect(state).toBe("leased");
      expect(await publishedReport(db, { clientId, websiteId, templateKey: "gsc.totals", start: "2026-11-03", end: "2026-11-09" })).toBeNull();
      // The lease expires and the next worker completes the job.
      expect(await reapExpiredLeases(db, new Date(NOW.getTime() + 600_000))).toBe(1);
      const results = await drain(db, new Date(NOW.getTime() + 700_000), provider.fetch);
      expect(results).toEqual(["succeeded"]);
      expect(await publishedReport(db, { clientId, websiteId, templateKey: "gsc.totals", start: "2026-11-03", end: "2026-11-09" })).not.toBeNull();
    });
  });

  it("refuses to run tests or the worker against a database marked production", () => {
    const env = { PRODUCTION_DATABASE_HOSTS: "prod-fixture.invalid", NONPRODUCTION_DATABASE_HOSTS: "prod-fixture.invalid", ANALYTICS_ALLOW_REMOTE_WORKER: "1" };
    const url = "postgresql://user:pass@prod-fixture.invalid/neondb";
    expect(() => assertTestDatabase(url, env)).toThrow(/Refusing/);
    expect(() => assertWorkerDatabase(url, env)).toThrow(/Refusing/);
    expect(() => assertWorkerDatabase("postgresql://user:pass@unlisted.invalid/db", { ANALYTICS_ALLOW_REMOTE_WORKER: "1" })).toThrow(/Refusing/);
  });

  it("turns a network fault into a retryable error and a bad body into an invalid response", async () => {
    const reset = resilientFetch(async () => { throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }); });
    await expect(reset("https://x.invalid")).rejects.toMatchObject({ code: "provider_unavailable" });
    const ours = resilientFetch(async () => { throw new Error("non-local provider url refused"); });
    await expect(ours("https://x.invalid")).rejects.toThrow("non-local provider url refused");
    const html = resilientFetch(async () => ({ status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError("x"); }, text: async () => "" }));
    await expect((await html("https://x.invalid")).json()).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("Phase 2.1 concurrent workers (committed fixture, removed afterwards)", () => {
  it("never leases the same job twice and never two jobs of one connection at once", async () => {
    const site = (await adminPool.query<{ id: string; client_id: string }>("select id, client_id from websites order by created_at limit 1")).rows[0];
    if (!site) throw new Error("Seed website missing. Run npm run db:seed.");
    const created: string[] = [];
    try {
      for (const [provider, property] of [["ga4", "concurrent-1"], ["gsc", "concurrent-2"], ["wix", "concurrent-3"]] as const) {
        const { rows } = await adminPool.query<{ id: string }>(
          `insert into analytics_connections (client_id, website_id, provider, external_property_id, provider_timezone, status)
           values ($1, $2, $3, $4, 'UTC', 'connected') returning id`, [site.client_id, site.id, provider, property]);
        created.push(rows[0]!.id);
        for (let i = 0; i < 5; i += 1) {
          await adminPool.query(
            `insert into analytics_jobs (client_id, website_id, connection_id, template_key, query_hash, start_date, end_date, priority, next_attempt_at)
             values ($1, $2, $3, 'ga4.traffic_range', $4, '2026-11-01', $5, 10, '2026-01-01T00:00:00Z')`,
            [site.client_id, site.id, rows[0]!.id, `${i}`.padStart(64, "a"), `2026-11-0${i + 1}`]);
        }
      }
      const attempts = await Promise.all(Array.from({ length: 9 }, (_, i) =>
        asContext(SERVICE, (db) => leaseNext(db, `worker-${i}`, NOW), { commit: true })));
      const leased = attempts.filter((job) => job !== null);
      expect(new Set(leased.map((job) => job!.id)).size).toBe(leased.length);
      const leasedConnections = leased.map((job) => job!.connection_id);
      expect(new Set(leasedConnections).size).toBe(leasedConnections.length);
      expect(leased.length).toBeGreaterThan(0);
      expect(leased.length).toBeLessThanOrEqual(3);
      const perConnection = await adminPool.query(
        "select connection_id from analytics_jobs where connection_id = any($1::uuid[]) and state = 'leased' group by 1 having count(*) > 1", [created]);
      expect(perConnection.rowCount).toBe(0);
      // The database itself refuses a second lease on a connection.
      const spare = await adminPool.query<{ id: string }>("select id from analytics_jobs where connection_id = $1 and state = 'queued' limit 1", [leasedConnections[0]]);
      await expect(adminPool.query("update analytics_jobs set state = 'leased' where id = $1", [spare.rows[0]!.id])).rejects.toMatchObject({ code: "23505" });
    } finally {
      if (created.length > 0) {
        await adminPool.query("delete from analytics_sync_runs where connection_id = any($1::uuid[])", [created]);
        await adminPool.query("delete from analytics_jobs where connection_id = any($1::uuid[])", [created]);
        await adminPool.query("delete from analytics_connections where id = any($1::uuid[])", [created]);
      }
    }
  });
});

describe("Phase 2.1 schema recovery", () => {
  it("rolls 0053 back without touching any row, and the migration applies again afterwards", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const down = readFileSync(join(__dirname, "../rollback/0053_analytics_scheduling.down.sql"), "utf8");
    const up = readFileSync(join(__dirname, "../migrations/0053_analytics_scheduling.sql"), "utf8");
    const client = await adminPool.connect();
    try {
      await client.query("begin");
      const before = (await client.query("select (select count(*) from analytics_jobs) jobs, (select count(*) from analytics_connections) connections, (select count(*) from analytics_report_partitions) partitions")).rows[0];
      await client.query(down.replace(/^begin;|commit;$/gm, ""));
      const gone = await client.query(
        `select column_name from information_schema.columns
         where table_name in ('analytics_jobs', 'analytics_connections') and column_name in ('window_class', 'priority', 'last_served_at', 'cooldown_until', 'consecutive_failures')`);
      expect(gone.rowCount).toBe(0);
      expect((await client.query("select 1 from schema_migrations where name = '0053_analytics_scheduling.sql'")).rowCount).toBe(0);
      const after = (await client.query("select (select count(*) from analytics_jobs) jobs, (select count(*) from analytics_connections) connections, (select count(*) from analytics_report_partitions) partitions")).rows[0];
      expect(after).toEqual(before);
      await client.query(up);
      const back = await client.query(
        `select column_name from information_schema.columns
         where table_name in ('analytics_jobs', 'analytics_connections') and column_name in ('window_class', 'priority', 'last_served_at', 'cooldown_until', 'consecutive_failures')`);
      expect(back.rowCount).toBe(5);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
