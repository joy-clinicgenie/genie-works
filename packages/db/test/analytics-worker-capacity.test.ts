import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVICE, applyContext, type Queryable } from "../src/client";
import { assertWorkerDatabase } from "../src/database-environment";
import { fictionalProviders, response } from "../src/testing/fictional-analytics-provider";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { publishedReport } from "../src/analytics/read";
import { enqueueDue, enqueueJob, reapExpiredLeases, sealedToken, succeededWindowIsStale, windowWasSettledWhenFetched, type FetchLike } from "../src/analytics/sync";
import { remainingWork, runWorkerInvocation, type InvocationReport } from "../src/analytics/worker-run";
import { applyQueueRecovery, QueueRecoveryApprovalError, queueRecoveryReport } from "../src/analytics/queue-recovery";
import { simulate, type FaultPlan } from "./simulation";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const TOKEN = sealedToken({ accessToken: "fixture-token", expiresAt: "2100-01-01T00:00:00.000Z" });
const NOW = new Date("2026-11-12T04:00:00.000Z"); // 12:00 on 12 Nov in Singapore.
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;

async function connect(db: Queryable, input: { clientId: string; websiteId: string; provider: "ga4" | "gsc" | "wix"; property: string }, actorId: string) {
  return saveConnection(db, {
    clientId: input.clientId, websiteId: input.websiteId, provider: input.provider, externalPropertyId: input.property, streamOrSiteRef: null,
    providerTimezone: input.provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore",
    tokenCiphertext: TOKEN.ciphertext, tokenNonce: TOKEN.nonce, actorUserId: actorId,
  });
}

async function clearQueue(db: Queryable): Promise<void> {
  await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
  await db.query("update analytics_connections set status = 'disconnected', disconnected_at = now() where status = 'connected'");
  // The application role cannot delete invocation records, so running ones are set aside instead.
  await db.query("update analytics_worker_invocations set state = 'abandoned' where state = 'running'");
}

/** A clinic with one GA4, one Search Console and one Wix source. */
async function standardClinic(db: Queryable, adminId: string, gscCount = 1) {
  const { clientId, websiteId } = await provisionClinic(db, adminId);
  await connect(db, { clientId, websiteId, provider: "ga4", property: "700001" }, adminId);
  for (let i = 0; i < gscCount; i += 1) await connect(db, { clientId, websiteId, provider: "gsc", property: `sc-domain:s${i}.example.invalid` }, adminId);
  await connect(db, { clientId, websiteId, provider: "wix", property: "wix-site-1" }, adminId);
  return { clientId, websiteId };
}

/** A fixed-clock invocation helper. Each provider request advances the clock by `latencyMs`. */
function harness(db: Queryable, start: Date, latencyMs: number, wrap?: (fetch: FetchLike) => FetchLike) {
  const provider = fictionalProviders();
  const state = { now: start.getTime(), requests: 0 };
  const inner: FetchLike = async (url, init) => {
    state.requests += 1;
    state.now += latencyMs;
    return provider.fetch(url, init);
  };
  const fetch = wrap ? wrap(inner) : inner;
  const run = async <T>(fn: (q: Queryable) => Promise<T>) => fn(db);
  const invoke = (at: Date | null, options: Parameters<typeof runWorkerInvocation>[2] = {}, runner: typeof run = run): Promise<InvocationReport> => {
    if (at) state.now = Math.max(state.now, at.getTime());
    return runWorkerInvocation(runner, { fetch, now: new Date(state.now) }, { owner: "test", trigger: "simulation", clock: () => state.now, ...options });
  };
  return { invoke, provider, state, run };
}

async function states(db: Queryable): Promise<Record<string, number>> {
  const { rows } = await db.query<{ state: string; n: number }>("select state, count(*)::int as n from analytics_jobs group by state");
  return Object.fromEntries(rows.map((row) => [row.state, row.n]));
}

// ---------------------------------------------------------------------------------------------

describe("Phase 2.2 incremental planning", () => {
  it("fetches a window once: later invocations the same day queue and request nothing", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id);
      const h = harness(db, NOW, 100);
      const first = await h.invoke(null);
      expect(first).toMatchObject({ enqueued: 34, jobs: 34, succeeded: 34, failed: 0, stopped: "empty" });
      const requestsAfterFirst = h.state.requests;
      expect(requestsAfterFirst).toBe(34);
      // NOW is 20:00 on 11 Nov in Los Angeles, so the Search Console day rolls over at +240 min; stay inside it.
      for (const offset of [30, 60, 120, 210]) {
        const later = await h.invoke(new Date(NOW.getTime() + minutes(offset)));
        expect(later, `+${offset} min`).toMatchObject({ enqueued: 0, jobs: 0, stopped: "idle" });
      }
      expect(h.state.requests).toBe(requestsAfterFirst);
      // The next reporting day has new windows, so the work is due again, once.
      const nextDay = await h.invoke(new Date(NOW.getTime() + hours(24)));
      expect(nextDay).toMatchObject({ enqueued: 34, jobs: 34, succeeded: 34 });
      expect(h.state.requests).toBe(68);
    });
  });

  it("costs a small fixed number of statements and no provider request when nothing is due", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id);
      const h = harness(db, NOW, 100);
      await h.invoke(null);
      let statements = 0;
      const counting = { query: (...args: unknown[]) => { statements += 1; return (db.query as (...a: unknown[]) => unknown)(...args); } } as unknown as Queryable;
      const requestsBefore = h.state.requests;
      const idle = await h.invoke(new Date(NOW.getTime() + minutes(30)), {}, async (fn) => fn(counting));
      expect(idle.stopped).toBe("idle");
      expect(h.state.requests).toBe(requestsBefore);
      // Register (4), connections and existing jobs (3), reap and lease (a handful), remaining work (1), close (1).
      expect(statements).toBeLessThanOrEqual(16);
      expect(statements).toBeGreaterThan(5);
    });
  });

  it("costs two queries to find nothing to add, not one per planned job", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id);
      await harness(db, NOW, 100).invoke(null);
      let queries = 0;
      const counting = { query: (...args: unknown[]) => { queries += 1; return (db.query as (...a: unknown[]) => unknown)(...args); } } as unknown as Queryable;
      expect(await enqueueDue(counting, new Date(NOW.getTime() + minutes(30)))).toBe(0);
      expect(queries).toBe(2);
    });
  });

  it("refreshes the partial-day windows inside the day only when opted in, and never the final ones", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id);
      const h = harness(db, NOW, 100);
      await h.invoke(null);
      const later = new Date(NOW.getTime() + hours(3));
      await enqueueDue(db, later, undefined, { partialRefreshSeconds: 2 * 3600 });
      const rows = await db.query<{ template_key: string }>("select template_key from analytics_jobs where state = 'queued' order by template_key");
      // Only the GA4 daily series and the Wix 62-day window end on the provider's current day.
      expect(rows.rows.map((row) => row.template_key)).toEqual(["ga4.traffic_daily", "wix.data_daily"]);
      expect(succeededWindowIsStale(new Date(NOW), null, later)).toBe(false);
      expect(succeededWindowIsStale(new Date(NOW), 3600, later)).toBe(true);
      expect(succeededWindowIsStale(new Date(NOW), undefined, later)).toBe(true);
    });
  });

  it("decides whether a window had settled when it was fetched, by provider", () => {
    // GA4 reports a day for up to about two days after it ends.
    expect(windowWasSettledWhenFetched("ga4", "2026-11-11", new Date("2026-11-12T02:00:00Z"))).toBe(false);
    expect(windowWasSettledWhenFetched("ga4", "2026-11-11", new Date("2026-11-13T23:00:00Z"))).toBe(false);
    expect(windowWasSettledWhenFetched("ga4", "2026-11-11", new Date("2026-11-15T00:00:00Z"))).toBe(true);
    expect(windowWasSettledWhenFetched("wix", "2026-11-11", new Date("2026-11-12T02:00:00Z"))).toBe(false);
    // Search Console windows end three days back and are requested as final.
    expect(windowWasSettledWhenFetched("gsc", "2026-11-08", new Date("2026-11-12T02:00:00Z"))).toBe(true);
  });

  it("does not fetch a Search Console window twice when it comes back, but does fetch a GA4 one again", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id);
      const h = harness(db, NOW, 10);
      const first = await h.invoke(null);
      expect(first.jobs).toBe(34);
      const ga4Window = (call: { provider: string; body: Record<string, unknown> }, start: string, end: string) =>
        call.provider === "ga4" && JSON.stringify((call.body.dateRanges as unknown[])[0]) === JSON.stringify({ startDate: start, endDate: end });
      const gscWindow = (call: { provider: string; body: Record<string, unknown> }, start: string, end: string) =>
        call.provider === "gsc" && call.body.startDate === start && call.body.endDate === end;
      // Day 0: the current 7-day windows. A week later the previous-7-day window is exactly this one.
      const ga4Before = h.provider.calls.filter((c) => ga4Window(c, "2026-11-05", "2026-11-11")).length;
      const gscBefore = h.provider.calls.filter((c) => gscWindow(c, "2026-11-02", "2026-11-08")).length;
      expect(gscBefore).toBe(2); // pages and queries
      const week = await h.invoke(new Date(NOW.getTime() + hours(24 * 7)));
      // Search Console: the two reappearing windows are not fetched. GA4: its reappearing window is.
      expect(week.jobs).toBe(34 - 2);
      expect(h.provider.calls.filter((c) => gscWindow(c, "2026-11-02", "2026-11-08")).length).toBe(gscBefore);
      expect(h.provider.calls.filter((c) => ga4Window(c, "2026-11-05", "2026-11-11")).length).toBe(ga4Before + 1);
    });
  });

  it("gives a window whose jobs ran out of attempts to a provider outage one fresh set after six hours, and keeps the failed row", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id);
      const start = new Date("2026-11-12T10:00:00.000Z"); // 02:00 in Los Angeles: the Search Console day lasts 22 more hours
      const h = harness(db, start, 10);
      await h.invoke(null);
      const target = async () => (await db.query<{ id: string }>(
        `select id from analytics_jobs where template_key = 'gsc.pages' and (end_date - start_date) = 6 order by end_date desc, created_at limit 1`)).rows[0]!.id;
      const id = await target();
      const failWith = async (code: string) => db.query(
        "update analytics_jobs set state = 'failed', safe_error_code = $2, failed_at = $3, updated_at = $3 where id = $1", [id, code, start.toISOString()]);
      const rowsFor = async () => (await db.query<{ state: string }>(
        `select state from analytics_jobs where template_key = 'gsc.pages' and (end_date - start_date) = 6
           and end_date = (select end_date from analytics_jobs where id = $1) order by created_at`, [id])).rows.map((row) => row.state);

      await failWith("provider_unavailable");
      await enqueueDue(db, new Date(start.getTime() + hours(3)));
      expect(await rowsFor()).toEqual(["failed"]); // too soon
      await enqueueDue(db, new Date(start.getTime() + hours(7)));
      expect(await rowsFor()).toEqual(["failed", "queued"]); // history kept, one fresh attempt set
      await enqueueDue(db, new Date(start.getTime() + hours(8)));
      expect(await rowsFor()).toEqual(["failed", "queued"]); // not queued twice

      // A request the provider rejected is not asked again: it would get the same answer.
      await db.query("update analytics_jobs set state = 'cancelled' where id <> $1 and template_key = 'gsc.pages' and state = 'queued'", [id]);
      await failWith("provider_rejected");
      await db.query("update analytics_jobs set state = 'cancelled' where template_key = 'gsc.pages' and state = 'queued' and id <> $1", [id]);
      await enqueueDue(db, new Date(start.getTime() + hours(9)));
      expect((await rowsFor()).filter((state) => state === "queued")).toEqual([]);
    });
  });

  it("still queues the same window again for a manual refresh (no policy given)", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      const connection = await connect(db, { clientId, websiteId, provider: "gsc", property: "sc-domain:m.example.invalid" }, admin.id);
      const input = { clientId, websiteId, connectionId: connection.id, templateKey: "gsc.pages", start: "2026-11-01", end: "2026-11-07" };
      const first = await enqueueJob(db, input);
      await db.query("update analytics_jobs set state = 'succeeded' where id = $1", [first.id]);
      await enqueueJob(db, { ...input, refreshAfterSeconds: null });
      expect((await states(db)).succeeded).toBe(1);
      await enqueueJob(db, input);
      expect((await states(db)).queued).toBe(1);
    });
  });
});

describe("Phase 2.2 worker invocation", () => {
  it("stops before the deadline, records why, and the next invocation finishes the rest with no repeated request", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id);
      const h = harness(db, NOW, 4000);
      const first = await h.invoke(null, { budgetMs: 90_000 });
      // 90 s budget, 25 s margin: 65 s of job time at 4 s a request.
      expect(first.stopped).toBe("deadline");
      expect(first.jobs).toBeGreaterThanOrEqual(14);
      expect(first.jobs).toBeLessThanOrEqual(17);
      expect(first.durationMs).toBeLessThanOrEqual(90_000 - 25_000 + 4000);
      expect(first.remaining.due).toBe(34 - first.jobs);
      let guard = 0;
      let last = first;
      while (last.remaining.due > 0 && guard++ < 10) last = await h.invoke(new Date(h.state.now + minutes(30)), { budgetMs: 90_000 });
      expect(h.state.requests).toBe(34);
      expect(await states(db)).toEqual({ succeeded: 34 });
      const rows = await db.query<{ stop_reason: string; jobs: number; remaining_due: number; duration_ms: number; state: string }>(
        "select stop_reason, jobs, remaining_due, duration_ms, state from analytics_worker_invocations where owner = 'test' order by started_at");
      expect(rows.rows[0]).toMatchObject({ stop_reason: "deadline", jobs: first.jobs, remaining_due: first.remaining.due, state: "finished" });
      expect(rows.rows.reduce((sum, row) => sum + row.jobs, 0)).toBe(34);
    });
  });

  it("stops at the job limit and says so", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id);
      const h = harness(db, NOW, 10);
      const limited = await h.invoke(null, { jobLimit: 5 });
      expect(limited).toMatchObject({ stopped: "limit", jobs: 5 });
      expect(limited.remaining.due).toBe(29);
    });
  });

  it("refuses to run more invocations at once than allowed, and abandons ones that never reported back", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id);
      const insert = (at: Date) => db.query(
        "insert into analytics_worker_invocations (owner, trigger, started_at, budget_ms, job_limit) values ('other', 'schedule', $1, 90000, 40)", [at.toISOString()]);
      await insert(NOW);
      await insert(NOW);
      const h = harness(db, NOW, 10);
      const refused = await h.invoke(new Date(NOW.getTime() + minutes(1)), { maxConcurrent: 2 });
      expect(refused).toMatchObject({ stopped: "overlap", jobs: 0, enqueued: 0 });
      expect(h.state.requests).toBe(0);
      expect(await states(db)).toEqual({});
      // Two hours later the earlier two are older than a budget plus two minutes: they are abandoned and the run proceeds.
      const proceeded = await h.invoke(new Date(NOW.getTime() + hours(2)), { maxConcurrent: 2 });
      expect(proceeded).toMatchObject({ stopped: "empty", jobs: 34 });
      const abandoned = await db.query("select 1 from analytics_worker_invocations where state = 'abandoned' and safe_error_code = 'worker_interrupted'");
      expect(abandoned.rowCount).toBe(2);
    });
  });

  it("lets two overlapping invocations share the queue without taking a job twice", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id, 4);
      await db.query(
        "insert into analytics_worker_invocations (owner, trigger, started_at, budget_ms, job_limit) values ('other', 'schedule', $1, 90000, 40)", [NOW.toISOString()]);
      const h = harness(db, NOW, 10);
      // One other invocation is running; the cap of two admits this one. Both are cooperative: the lease table is the arbiter.
      const mine = await h.invoke(new Date(NOW.getTime() + minutes(1)), { maxConcurrent: 2, jobLimit: 100 });
      expect(mine.stopped).toBe("empty");
      const duplicates = await db.query("select connection_id, template_key, start_date, end_date from analytics_jobs where state = 'succeeded' group by 1,2,3,4 having count(*) > 1");
      expect(duplicates.rowCount).toBe(0);
    });
  });

  it("records a database failure against the invocation and recovers the lease on the next one", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId } = await standardClinic(db, admin.id);
      const h = harness(db, NOW, 10);
      let calls = 0;
      // Calls: 1 register, 2 plan, 3 claim, 4 store. Fail the store as a dropped connection would.
      const failingStore = async <T>(fn: (q: Queryable) => Promise<T>): Promise<T> => {
        calls += 1;
        if (calls === 4) throw new Error("connection terminated unexpectedly");
        return fn(db);
      };
      await expect(h.invoke(null, {}, failingStore)).rejects.toThrow("connection terminated");
      const row = (await db.query<{ state: string; stop_reason: string; safe_error_code: string }>(
        "select state, stop_reason, safe_error_code from analytics_worker_invocations where owner = 'test'")).rows[0]!;
      expect(row).toMatchObject({ state: "finished", stop_reason: "error", safe_error_code: "worker_error" });
      const leased = await db.query<{ id: string }>("select id from analytics_jobs where state = 'leased'");
      expect(leased.rowCount).toBe(1);
      expect(await publishedReport(db, { clientId, websiteId, templateKey: "ga4.traffic_daily", start: "2026-05-16", end: "2026-11-12" })).toBeNull();
      // The lease runs out (150 s) and the next invocation takes the job again, without anyone touching it by hand.
      expect(await reapExpiredLeases(db, new Date(NOW.getTime() + minutes(10)))).toBe(1);
      const next = await h.invoke(new Date(NOW.getTime() + minutes(40)));
      expect(next).toMatchObject({ jobs: 34, succeeded: 34 });
    });
  });

  it("keeps jobs queued without spending attempts when the server is not configured, and records it", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id);
      const key = process.env.ANALYTICS_TOKEN_KEY;
      delete process.env.ANALYTICS_TOKEN_KEY;
      try {
        const h = harness(db, NOW, 10);
        const report = await h.invoke(null);
        expect(h.state.requests).toBe(0);
        expect(report.notConfigured).toBe(34);
        expect(report.succeeded).toBe(0);
        const jobs = await db.query<{ attempts: number; state: string }>("select attempts, state from analytics_jobs where state not in ('cancelled')");
        expect(jobs.rows.every((row) => row.attempts === 0 && row.state === "queued")).toBe(true);
        // Waiting out a missing setting is not a backlog of due work.
        expect(report.remaining.due).toBe(0);
        expect(report.remaining.waiting).toBe(34);
      } finally {
        process.env.ANALYTICS_TOKEN_KEY = key;
      }
    });
  });
});

describe("Phase 2.2 failure isolation", () => {
  const siteOf = (url: string) => decodeURIComponent(url);

  it("holds a provider's healthy connections while three of its connections fail, then resumes them", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id, 5);
      const attempted = new Set<string>();
      let down = true;
      const h = harness(db, NOW, 10, (inner) => async (url, init) => {
        if (down && url.includes("searchAnalytics")) {
          attempted.add(siteOf(url).match(/s\d(?=\.example)/)![0]);
          return response(503, {});
        }
        return inner(url, init);
      });
      const first = await h.invoke(null);
      // Three Search Console properties were tried and failed; the other two were never asked.
      expect(attempted.size).toBe(3);
      // GA4 and Wix finished everything, unaffected: 20 + 1 jobs, plus 3 failed attempts.
      expect(first.succeeded).toBe(21);
      expect(first.failed).toBe(0);
      expect(first.retryScheduled).toBe(3);
      const gsc = await db.query<{ n: number }>(
        "select count(*)::int as n from analytics_jobs j join analytics_connections c on c.id = j.connection_id where c.provider = 'gsc' and j.state = 'queued'");
      expect(gsc.rows[0]!.n).toBe(5 * 13);
      // The provider recovers. Probes go first; the first success closes the breaker and everything proceeds.
      down = false;
      let last = await h.invoke(new Date(NOW.getTime() + minutes(45)));
      for (let i = 0; i < 6 && last.remaining.due + last.remaining.waiting > 0; i += 1) last = await h.invoke(new Date(h.state.now + minutes(30)));
      expect(last.remaining).toMatchObject({ due: 0, waiting: 0 });
      expect((await states(db)).succeeded).toBe(20 + 1 + 5 * 13);
    });
  });

  it("marks only the connection with an expired grant, and carries on with the rest", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id, 3);
      const h = harness(db, NOW, 10, (inner) => async (url, init) =>
        siteOf(url).includes("s1.example") ? response(401, { error: { status: "UNAUTHENTICATED" } }) : inner(url, init));
      const report = await h.invoke(null, { jobLimit: 100 });
      expect(report.reconnectRequired).toBeGreaterThanOrEqual(1);
      const status = await db.query<{ external_property_id: string; status: string }>(
        "select external_property_id, status from analytics_connections where status <> 'disconnected' order by external_property_id");
      expect(status.rows.filter((row) => row.status === "reconnect_required").map((row) => row.external_property_id)).toEqual(["sc-domain:s1.example.invalid"]);
      expect(report.succeeded).toBe(20 + 1 + 2 * 13);
    });
  });

  it("retries a timeout, honours a rate limit's Retry-After, and keeps other providers moving", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      await standardClinic(db, admin.id);
      let mode: "timeout" | "limit" | "ok" = "timeout";
      const h = harness(db, NOW, 10, (inner) => async (url, init) => {
        if (url.includes("analyticsdata") && mode === "timeout") throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
        if (url.includes("wixapis") && mode === "limit") return response(429, {}, { "retry-after": "900" });
        return inner(url, init);
      });
      const timeout = await h.invoke(null);
      expect(timeout.retryScheduled).toBe(1); // one GA4 attempt, then the connection pauses
      expect(timeout.succeeded).toBe(13 + 1);
      mode = "limit";
      const limited = await h.invoke(new Date(NOW.getTime() + minutes(30)));
      expect(limited.stopped).toBeDefined();
      const wix = await db.query<{ next_attempt_at: Date }>("select next_attempt_at from analytics_jobs where template_key = 'wix.data_daily' and state = 'queued'");
      // Wix succeeded in the first invocation, so a window that is final for the day is not asked again; nothing to rate-limit.
      expect(wix.rowCount).toBe(0);
      mode = "ok";
      let last = limited;
      for (let i = 0; i < 6 && last.remaining.due + last.remaining.waiting > 0; i += 1) last = await h.invoke(new Date(h.state.now + minutes(30)));
      expect((await states(db)).succeeded).toBe(34);
    });
  });

  it("never stores a malformed answer over a good report", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId } = await standardClinic(db, admin.id);
      const h = harness(db, NOW, 10);
      await h.invoke(null);
      const window = { clientId, websiteId, templateKey: "gsc.totals", start: "2026-11-02", end: "2026-11-08" };
      const good = await publishedReport(db, window);
      expect(good).not.toBeNull();
      // The next day the provider answers with garbage for every request.
      const day2 = new Date(NOW.getTime() + hours(24));
      const h2 = harness(db, day2, 10, () => async () => response(200, "<html>maintenance</html>"));
      const bad = await h2.invoke(null);
      expect(bad.succeeded).toBe(0);
      expect(bad.retryScheduled).toBeGreaterThan(0);
      // Yesterday's good report is still the published one, and the new day's window has nothing rather than garbage.
      expect((await publishedReport(db, window))?.generation).toBe(good!.generation);
      expect(await publishedReport(db, { ...window, start: "2026-11-03", end: "2026-11-09" })).toBeNull();
    });
  });
});

describe("Phase 2.2 queue recovery", () => {
  async function legacyQueue(db: Queryable, adminId: string) {
    await clearQueue(db);
    const { clientId, websiteId } = await standardClinic(db, adminId);
    process.env.ANALYTICS_PLANNER = "v1";
    try {
      // Three consecutive daily runs of the version 1 plan, none of which ever got a worker: the diagnostic's backlog.
      for (const day of [0, 1, 2]) await enqueueDue(db, new Date(NOW.getTime() + hours(24 * day)), websiteId);
    } finally {
      delete process.env.ANALYTICS_PLANNER;
    }
    // They have waited three days for a worker that never ran.
    await db.query("update analytics_jobs set created_at = $1 where state = 'queued'", [new Date(NOW.getTime() - hours(24)).toISOString()]);
    return { clientId, websiteId };
  }

  it("lists obsolete queued jobs in a read-only dry run and changes nothing", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await legacyQueue(db, admin.id);
      const before = await states(db);
      await db.query("savepoint dry");
      await db.query("set transaction read only");
      const report = await queueRecoveryReport(db, new Date(NOW.getTime() + hours(48)));
      await expect(db.query("update analytics_jobs set state = 'cancelled'")).rejects.toMatchObject({ code: "25006" });
      await db.query("rollback to savepoint dry");
      expect(report.queuedLegacy).toBe(3 * 50);
      // Windows of the first two days each have a newer same-length sibling; the third day's are the current ones.
      expect(report.obsolete.eligible).toBe(2 * 50);
      expect(report.obsolete.needsReview).toBe(50);
      expect(report.approvalToken).toMatch(/^recover:100:0:[0-9a-f]{12}$/);
      expect(await states(db)).toEqual(before);
    });
  });

  it("refuses to apply without the exact approval, then cancels only what was listed and deletes nothing", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const { clientId, websiteId } = await legacyQueue(db, admin.id);
      // A finished job, a failed job and a published report that cleanup must leave alone.
      const h = harness(db, new Date(NOW.getTime() + hours(48)), 10);
      await db.query("update analytics_jobs set state = 'failed', safe_error_code = 'provider_rejected', failed_at = now() where id = (select id from analytics_jobs where state = 'queued' order by end_date desc, template_key limit 1)");
      const at = new Date(NOW.getTime() + hours(48));
      const report = await queueRecoveryReport(db, at);
      await expect(applyQueueRecovery(db, at, "")).rejects.toBeInstanceOf(QueueRecoveryApprovalError);
      await expect(applyQueueRecovery(db, at, "recover:999:0:abcdefabcdef")).rejects.toBeInstanceOf(QueueRecoveryApprovalError);
      expect((await states(db)).cancelled ?? 0).toBeGreaterThanOrEqual(0);
      const totalBefore = Number((await db.query<{ n: string }>("select count(*)::text as n from analytics_jobs")).rows[0]!.n);
      const failedBefore = (await states(db)).failed;
      const outcome = await applyQueueRecovery(db, at, report.approvalToken);
      expect(outcome.cancelled).toBe(report.obsolete.eligible);
      const after = await states(db);
      expect(after.failed).toBe(failedBefore);
      expect(Number((await db.query<{ n: string }>("select count(*)::text as n from analytics_jobs")).rows[0]!.n)).toBe(totalBefore);
      const cancelled = await db.query("select 1 from analytics_jobs where safe_error_code = 'superseded_recovery'");
      expect(cancelled.rowCount).toBe(report.obsolete.eligible);
      // The approval was for that set. Asking again with the same token now refuses, because the queue is different.
      await expect(applyQueueRecovery(db, at, report.approvalToken)).rejects.toBeInstanceOf(QueueRecoveryApprovalError);
      // What remains is the current day's plan, which the worker still processes normally.
      const worked = await h.invoke(null);
      expect(worked.succeeded).toBeGreaterThan(0);
      expect(await publishedReport(db, { clientId, websiteId, templateKey: "gsc.pages", start: "2026-11-09", end: "2026-11-15" })).toBeDefined();
    });
  });

  it("does not touch a leased job, a version 2 job, or a range nobody scheduled", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await clearQueue(db);
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      const connection = await connect(db, { clientId, websiteId, provider: "gsc", property: "sc-domain:r.example.invalid" }, admin.id);
      const base = { clientId, websiteId, connectionId: connection.id, templateKey: "gsc.pages" };
      const seven = (end: string, start: string) => enqueueJob(db, { ...base, start, end });
      const old = await seven("2026-11-07", "2026-11-01");
      const current = await seven("2026-11-08", "2026-11-02"); // today's own 7-day window
      const previous = await seven("2026-11-01", "2026-10-26"); // today's previous-period window
      const recent = await seven("2026-10-07", "2026-10-01"); // an old window, but only just queued
      const custom = await enqueueJob(db, { ...base, start: "2026-10-01", end: "2026-10-12" }); // 12 days: no plan uses it
      await enqueueJob(db, { ...base, start: "2026-09-01", end: "2026-09-12" });
      await enqueueJob(db, { ...base, start: "2026-09-13", end: "2026-09-24" }); // newer but not a planned length
      const v2 = await enqueueJob(db, { ...base, start: "2026-10-20", end: "2026-10-26", windowClass: "p7" });
      await enqueueJob(db, { ...base, start: "2026-10-27", end: "2026-11-02", windowClass: "p7" }); // retires v2 itself
      const leased = await seven("2026-10-14", "2026-10-08");
      // Everything but `recent` has waited more than a day and a half.
      await db.query("update analytics_jobs set created_at = $2 where id <> $1", [recent.id, new Date(NOW.getTime() - hours(48)).toISOString()]);
      await db.query("update analytics_jobs set state = 'leased', lease_owner = 'w', lease_until = $2 where id = $1", [leased.id, NOW.toISOString()]);
      const at = new Date(NOW.getTime() + hours(1));
      const report = await queueRecoveryReport(db, at);
      expect(report.expiredLeases).toBe(1);
      // The leased job's window is also old, but it is leased; `old` and `recent` differ only in age.
      expect(report.obsolete.eligible).toBe(1);
      const outcome = await applyQueueRecovery(db, at, report.approvalToken);
      expect(outcome.cancelled).toBe(1);
      expect(outcome.leasesRecovered).toBe(1);
      const state = async (id: string) => (await db.query<{ state: string; safe_error_code: string | null }>("select state, safe_error_code from analytics_jobs where id = $1", [id])).rows[0]!;
      expect(await state(old.id)).toMatchObject({ state: "cancelled", safe_error_code: "superseded_recovery" });
      expect((await state(custom.id)).state).toBe("queued");
      expect((await state(current.id)).state).toBe("queued");
      expect((await state(previous.id)).state).toBe("queued");
      expect((await state(recent.id)).state).toBe("queued");
      expect((await state(v2.id)).safe_error_code).toBe("superseded");
      expect((await state(leased.id)).state).toBe("queued"); // the expired lease was recovered, not cancelled
    });
  });

  it("keeps jobs and invocation records invisible to staff with no access to the clinic", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specialist = await staffByEmail("specialist-a@example.invalid");
    await asContext(SERVICE, async (db) => {
      await legacyQueue(db, admin.id);
      const h = harness(db, NOW, 10);
      await h.invoke(null, { jobLimit: 3 });
      expect(Number((await db.query<{ n: string }>("select count(*)::text as n from analytics_jobs")).rows[0]!.n)).toBeGreaterThan(100);
      // Same transaction, now as a specialist who is not a member of this new clinic.
      await applyContext(db, staffCtx(specialist));
      expect((await db.query("select 1 from analytics_jobs")).rowCount).toBe(0);
      expect((await db.query("select 1 from analytics_worker_invocations")).rowCount).toBe(0);
      await expect(db.query("insert into analytics_worker_invocations (owner, started_at) values ('x', now())")).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("Phase 2.2 capacity simulation (21 sources)", () => {
  it("clears each day's 160 jobs between scheduled invocations at 2 s a request, with a bounded queue", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const result = await simulate(db, admin.id, { days: 3, latencyMs: 2000 });
      // Day one queues everything. After that GA4 and Wix replan at Singapore midnight and Search Console at Pacific midnight.
      expect(result.jobsQueued).toBe(160 + 2 * 30 + 3 * 130);
      expect(result.jobsProcessed).toBe(result.jobsQueued);
      expect(result.succeeded).toBe(result.jobsQueued);
      expect(result.failed + result.retried).toBe(0);
      expect(result.remainingAtEnd).toEqual({ due: 0, waiting: 0, leased: 0 });
      expect(result.requests.ga4 + result.requests.gsc + result.requests.wix).toBe(result.jobsQueued);
      expect(result.maxQueueDepth).toBeLessThanOrEqual(170);
      expect(result.clearHours.max).toBeLessThanOrEqual(6);
      expect(result.idleInvocations).toBeGreaterThan(result.invocations / 2);
    });
  }, 120_000);

  it("keeps working through a six-hour Search Console outage and a revoked grant, and clears the backlog afterwards", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const start = new Date("2026-11-30T16:00:00.000Z");
      const faults: FaultPlan = ({ provider, index, nowMs }) => {
        if (provider === "gsc" && index === 9) return response(401, { error: { status: "UNAUTHENTICATED" } });
        // Search Console replans at 16:00 Singapore; it is down from then for six hours.
        if (provider === "gsc" && nowMs >= start.getTime() + hours(16) && nowMs < start.getTime() + hours(22)) return response(503, {});
        return undefined;
      };
      const result = await simulate(db, admin.id, { days: 2, latencyMs: 2000, faults, startAt: start });
      expect(result.reconnectRequired).toBe(1);
      expect(result.remainingAtEnd).toEqual({ due: 0, waiting: 0, leased: 0 });
      // The outage was really hit, and cost a bounded number of rejected calls, not one per queued job
      // (130 Search Console jobs were waiting, and the 12 half-hour invocations in the outage could each have tried many).
      expect(result.retried).toBeGreaterThan(0);
      // Anything that ran out of attempts during the outage was queued again afterwards, so no window is left unfetched.
      expect(result.unrecoveredFailedWindows).toBe(0);
      expect(result.rejectedRequests.gsc).toBeGreaterThan(1);
      expect(result.rejectedRequests.gsc).toBeLessThan(60);
      // GA4 and Wix were never behind and never failed: exactly their planned requests (GA4 replans once, at midnight of day 2).
      expect(result.requests.ga4).toBe(2 * 20);
      expect(result.requests.wix).toBe(2 * 10);
      // A few jobs did run out of attempts during six hours of failures (their rows stay as history); none is left unfetched.
      expect(result.failed).toBeGreaterThan(0);
      expect(result.failed).toBeLessThanOrEqual(10);
    });
  }, 120_000);
});

describe("Phase 2.2 environment safety", () => {
  it("still refuses the production database outside the production deployment", () => {
    const env = { PRODUCTION_DATABASE_HOSTS: "prod-fixture.invalid", NONPRODUCTION_DATABASE_HOSTS: "prod-fixture.invalid", ANALYTICS_ALLOW_REMOTE_WORKER: "1" };
    expect(() => assertWorkerDatabase("postgresql://user:pass@prod-fixture.invalid/neondb", env)).toThrow(/Refusing/);
  });

  it("leaves the repository schedule exactly as D55 set it: one daily schedule, no cron entry, nothing new registered", () => {
    const config = JSON.parse(readFileSync(join(__dirname, "../../../vercel.json"), "utf8")) as { schedules?: Record<string, { schedule: string; path: string }>; crons?: unknown };
    expect(config.crons).toBeUndefined();
    expect(Object.keys(config.schedules ?? {})).toEqual(["analytics-worker"]);
    expect(config.schedules!["analytics-worker"]).toMatchObject({ schedule: "0 2 * * *", path: "/api/internal/analytics/worker" });
  });

  it("reports remaining work without writing", async () => {
    await asContext(SERVICE, async (db) => {
      await db.query("set transaction read only");
      expect(await remainingWork(db, NOW)).toMatchObject({ due: expect.any(Number), waiting: expect.any(Number) });
    });
  });
});

describe("Phase 2.2 schema recovery", () => {
  it("rolls 0054 back without touching a job, report or connection, and the migration applies again", async () => {
    const down = readFileSync(join(__dirname, "../rollback/0054_analytics_worker_invocations.down.sql"), "utf8");
    const up = readFileSync(join(__dirname, "../migrations/0054_analytics_worker_invocations.sql"), "utf8");
    const client = await adminPool.connect();
    try {
      await client.query("begin");
      const counts = () => client.query("select (select count(*) from analytics_jobs) jobs, (select count(*) from analytics_connections) connections, (select count(*) from analytics_report_partitions) partitions");
      const before = (await counts()).rows[0];
      await client.query(down.replace(/^begin;|commit;$/gm, ""));
      expect((await client.query("select to_regclass('analytics_worker_invocations') as t")).rows[0].t).toBeNull();
      expect((await client.query("select 1 from schema_migrations where name = '0054_analytics_worker_invocations.sql'")).rowCount).toBe(0);
      expect((await counts()).rows[0]).toEqual(before);
      await client.query(up);
      expect((await client.query("select to_regclass('analytics_worker_invocations') as t")).rows[0].t).not.toBeNull();
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
