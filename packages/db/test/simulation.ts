import type { Queryable } from "../src/client";
import { saveConnection } from "../src/analytics/connections";
import { sealedToken, type FetchLike, type FetchResponse } from "../src/analytics/sync";
import { runWorkerInvocation, type InvocationReport } from "../src/analytics/worker-run";
import { fictionalProviders, response } from "../src/testing/fictional-analytics-provider";
import { provisionClinic } from "./provision";

/**
 * Capacity simulation (Phase 2.2). Runs the real worker against the real local schema and a
 * fictional provider, on a virtual clock. No sleeping: each provider request advances the clock by
 * a stated latency, so seven days of 30-minute invocations take seconds of real time.
 *
 * What it measures is the queue, the stop rules and the request counts. What it assumes, and says
 * so in the report, is the latency per request and the fixed cost of storing a job.
 */

export type Provider = "ga4" | "gsc" | "wix";

export interface FaultContext {
  provider: Provider;
  /** Zero-based index of the connection within its provider. */
  index: number;
  nowMs: number;
}

/** Return a response to replace the provider's answer, throw to simulate a dropped connection, or undefined for a normal answer. */
export type FaultPlan = (context: FaultContext) => FetchResponse | undefined;

export interface SimulationOptions {
  days: number;
  tickMinutes: number;
  /** Seconds one provider request takes. */
  latencyMs: number;
  /** Fixed cost per request for parsing and storing, including database round trips. */
  overheadMs: number;
  budgetMs: number;
  jobLimit: number;
  maxConcurrent: number;
  planner: "v1" | "v2";
  counts: Record<Provider, number>;
  /** Virtual start. Midnight Asia/Singapore. */
  startAt: Date;
  faults?: FaultPlan;
  /** Hobby jitter: each scheduled run starts up to this many minutes late. */
  jitterMinutes: number;
}

export const DEFAULT_SIMULATION: SimulationOptions = {
  days: 7,
  tickMinutes: 30,
  latencyMs: 2000,
  overheadMs: 250,
  budgetMs: 90_000,
  jobLimit: 40,
  maxConcurrent: 2,
  planner: "v2",
  counts: { ga4: 1, gsc: 10, wix: 10 },
  startAt: new Date("2026-11-30T16:00:00.000Z"),
  jitterMinutes: 15,
};

export interface DaySummary {
  day: number;
  invocations: number;
  jobs: number;
  succeeded: number;
  failed: number;
  retried: number;
  enqueued: number;
  requests: Record<Provider, number>;
}

export interface SimulationResult {
  options: { latencySeconds: number; overheadMs: number; budgetSeconds: number; jobLimit: number; planner: string; tickMinutes: number; days: number; faults: boolean };
  invocations: number;
  idleInvocations: number;
  stopReasons: Record<string, number>;
  jobsQueued: number;
  jobsProcessed: number;
  succeeded: number;
  failed: number;
  retried: number;
  reconnectRequired: number;
  /** Windows whose latest job is `failed` and never succeeded afterwards. The failed rows stay as history. */
  unrecoveredFailedWindows: number;
  requests: Record<Provider, number>;
  rejectedRequests: Record<Provider, number>;
  maxQueueDepth: number;
  remainingAtEnd: { due: number; waiting: number; leased: number };
  jobsPerBusyInvocation: { mean: number; max: number };
  invocationSeconds: { mean: number; max: number };
  /** From the first tick that finds queued work to the first tick after which none is due or waiting. */
  clearHours: { episodes: number; mean: number; max: number };
  /** Same, but only counting work that is due (a job waiting out a backoff does not hold an episode open). */
  clearDueHours: { episodes: number; mean: number; max: number };
  busyInvocationsPerDay: number;
  daily: DaySummary[];
}

function stat(values: number[]): { mean: number; max: number } {
  if (values.length === 0) return { mean: 0, max: 0 };
  return { mean: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2), max: +Math.max(...values).toFixed(2) };
}

/** Local database only, and the caller must roll the transaction back: it sets other queued work and connections aside. */
export async function simulate(db: Queryable, adminId: string, partial: Partial<SimulationOptions> = {}): Promise<SimulationResult> {
  const options: SimulationOptions = { ...DEFAULT_SIMULATION, ...partial };
  const previousPlanner = process.env.ANALYTICS_PLANNER;
  process.env.ANALYTICS_PLANNER = options.planner;
  try {
    return await simulateWith(db, adminId, options);
  } finally {
    if (previousPlanner === undefined) delete process.env.ANALYTICS_PLANNER;
    else process.env.ANALYTICS_PLANNER = previousPlanner;
  }
}

async function simulateWith(db: Queryable, adminId: string, options: SimulationOptions): Promise<SimulationResult> {
  // Only the simulation's own clinic is in play: other queued work is set aside for the run (the caller rolls back).
  await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
  await db.query("update analytics_connections set status = 'disconnected', disconnected_at = now() where status = 'connected'");
  const { clientId, websiteId } = await provisionClinic(db, adminId);
  const identity = new Map<string, { provider: Provider; index: number }>();
  const connect = async (provider: Provider, index: number) => {
    const token = `sim-${provider}-${index}`;
    identity.set(token, { provider, index });
    const sealed = sealedToken({ accessToken: token, expiresAt: "2100-01-01T00:00:00.000Z" });
    await saveConnection(db, {
      clientId, websiteId, provider,
      externalPropertyId: provider === "ga4" ? `8${String(index).padStart(5, "0")}` : provider === "gsc" ? `sc-domain:sim${index}.example.invalid` : `wix-sim-${index}`,
      streamOrSiteRef: null,
      providerTimezone: provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore",
      tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: adminId,
    });
  };
  for (const provider of ["ga4", "gsc", "wix"] as const) {
    for (let i = 0; i < options.counts[provider]; i += 1) await connect(provider, i);
  }

  let nowMs = options.startAt.getTime();
  const fictional = fictionalProviders();
  const requests: Record<Provider, number> = { ga4: 0, gsc: 0, wix: 0 };
  const rejected: Record<Provider, number> = { ga4: 0, gsc: 0, wix: 0 };
  const fetch: FetchLike = async (url, init) => {
    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
    const who = identity.get(authorization.replace(/^Bearer /, ""));
    const provider: Provider = url.includes("analyticsdata") ? "ga4" : url.includes("searchAnalytics") ? "gsc" : "wix";
    requests[provider] += 1;
    nowMs += options.latencyMs + options.overheadMs;
    const fault = who ? options.faults?.({ provider, index: who.index, nowMs }) : undefined;
    if (fault) {
      if (fault.status >= 400) rejected[provider] += 1;
      return fault;
    }
    return fictional.fetch(url, init);
  };

  const run = async <T>(fn: (q: Queryable) => Promise<T>) => fn(db);
  const reports: Array<{ at: number; report: InvocationReport }> = [];
  const dayMs = 86_400_000;
  const ticksPerDay = Math.round((24 * 60) / options.tickMinutes);
  const daily: DaySummary[] = [];
  let maxQueueDepth = 0;
  let jobsQueued = 0;

  for (let day = 0; day < options.days; day += 1) {
    const summary: DaySummary = { day: day + 1, invocations: 0, jobs: 0, succeeded: 0, failed: 0, retried: 0, enqueued: 0, requests: { ga4: 0, gsc: 0, wix: 0 } };
    const before = { ...requests };
    for (let tick = 0; tick < ticksPerDay; tick += 1) {
      const scheduled = options.startAt.getTime() + day * dayMs + tick * options.tickMinutes * 60_000;
      const jitter = ((day * ticksPerDay + tick) * 7 % (options.jitterMinutes + 1)) * 60_000;
      // A slow run never delays the next scheduled one, but the clock cannot move backwards inside this single-threaded model.
      nowMs = Math.max(nowMs, scheduled + jitter);
      const report = await runWorkerInvocation(
        run,
        { fetch, now: new Date(nowMs) },
        { owner: "sim", trigger: "simulation", clock: () => nowMs, budgetMs: options.budgetMs, jobLimit: options.jobLimit, maxConcurrent: options.maxConcurrent },
      );
      reports.push({ at: nowMs, report });
      jobsQueued += report.enqueued;
      summary.invocations += 1;
      summary.jobs += report.jobs;
      summary.succeeded += report.succeeded;
      summary.failed += report.failed;
      summary.retried += report.retryScheduled;
      summary.enqueued += report.enqueued;
      maxQueueDepth = Math.max(maxQueueDepth, report.remaining.due + report.remaining.waiting + report.remaining.leased + report.jobs);
    }
    summary.requests = { ga4: requests.ga4 - before.ga4, gsc: requests.gsc - before.gsc, wix: requests.wix - before.wix };
    daily.push(summary);
  }

  const episodes = (countWaiting: boolean) => {
    const hours: number[] = [];
    let openedAt: number | null = null;
    for (const { at, report } of reports) {
      const hadWork = report.jobs > 0 || report.enqueued > 0;
      const left = report.remaining.due + report.remaining.leased + (countWaiting ? report.remaining.waiting : 0);
      if (openedAt === null && (hadWork || left > 0)) openedAt = at - report.durationMs;
      if (openedAt !== null && left === 0) {
        hours.push((at - openedAt) / 3_600_000);
        openedAt = null;
      }
    }
    return { episodes: hours.length, ...stat(hours) };
  };

  const busy = reports.filter(({ report }) => report.jobs > 0);
  const last = reports[reports.length - 1]!.report.remaining;
  const reconnect = (await db.query<{ n: string }>("select count(*)::text as n from analytics_connections where status = 'reconnect_required'")).rows[0]!.n;
  const unrecovered = (await db.query<{ n: string }>(
    `select count(*)::text as n from (
       select distinct connection_id, template_key, start_date, end_date from analytics_jobs f
       where f.state = 'failed' and not exists (
         select 1 from analytics_jobs s where s.connection_id = f.connection_id and s.template_key = f.template_key
           and s.start_date = f.start_date and s.end_date = f.end_date and s.state in ('succeeded', 'queued', 'leased'))
     ) w`)).rows[0]!.n;
  const stopReasons: Record<string, number> = {};
  for (const { report } of reports) stopReasons[report.stopped] = (stopReasons[report.stopped] ?? 0) + 1;
  const total = (pick: (r: InvocationReport) => number) => reports.reduce((sum, { report }) => sum + pick(report), 0);
  return {
    options: {
      latencySeconds: options.latencyMs / 1000, overheadMs: options.overheadMs, budgetSeconds: options.budgetMs / 1000, jobLimit: options.jobLimit,
      planner: options.planner, tickMinutes: options.tickMinutes, days: options.days, faults: Boolean(options.faults),
    },
    invocations: reports.length,
    idleInvocations: stopReasons.idle ?? 0,
    stopReasons,
    jobsQueued,
    jobsProcessed: total((r) => r.jobs),
    succeeded: total((r) => r.succeeded),
    failed: total((r) => r.failed),
    retried: total((r) => r.retryScheduled),
    reconnectRequired: Number(reconnect),
    unrecoveredFailedWindows: Number(unrecovered),
    requests,
    rejectedRequests: rejected,
    maxQueueDepth,
    remainingAtEnd: { due: last.due, waiting: last.waiting, leased: last.leased },
    jobsPerBusyInvocation: stat(busy.map(({ report }) => report.jobs)),
    invocationSeconds: stat(busy.map(({ report }) => report.durationMs / 1000)),
    clearHours: episodes(true),
    clearDueHours: episodes(false),
    busyInvocationsPerDay: +(busy.length / options.days).toFixed(1),
    daily,
  };
}

/**
 * The partial-failure scenario: a provider outage, rate limiting, a timeout burst and one revoked grant,
 * each placed when that provider has work, which is just after it replans: GA4 and Wix at midnight
 * Singapore, Search Console at midnight Pacific (16:00 Singapore).
 */
export function partialFailurePlan(startAt: Date): FaultPlan {
  const hour = 3_600_000;
  const at = (day: number, h: number) => startAt.getTime() + day * 86_400_000 + h * hour;
  return ({ provider, index, nowMs }) => {
    // From day 2: one Search Console property loses its grant for the rest of the run.
    if (provider === "gsc" && index === 9 && nowMs >= at(1, 0)) return response(401, { error: { status: "UNAUTHENTICATED" } });
    // Day 3, 16:00 to 22:00: Search Console is down for everyone, from the moment it replans.
    if (provider === "gsc" && nowMs >= at(2, 16) && nowMs < at(2, 22)) return response(503, {});
    // Day 4, 00:00 to 02:00: three Wix sites are rate limited and ask for 15 minutes.
    if (provider === "wix" && index < 3 && nowMs >= at(3, 0) && nowMs < at(3, 2)) return response(429, {}, { "retry-after": "900" });
    // Day 5, 00:00 to 01:00: the GA4 property times out.
    if (provider === "ga4" && nowMs >= at(4, 0) && nowMs < at(4, 1)) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    return undefined;
  };
}
