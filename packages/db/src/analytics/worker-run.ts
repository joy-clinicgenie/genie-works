import type { Queryable } from "../client";
import { enqueueDue, runWorkerOnce, type SyncDeps, type WorkerJobResult } from "./sync";
import { PROVIDER_BREAKER_THRESHOLD } from "./sync";

/**
 * Analytics Phase 2.2: one bounded, recorded worker invocation.
 *
 * A scheduled run (every 30 minutes in the proposal) is cheap when there is nothing to do and
 * stops early enough to finish inside the hosting limit when there is. Everything it does is
 * written to `analytics_worker_invocations`, so a run can be audited and overlapping runs can be
 * capped. Job-level safety (one lease per connection, no duplicate queued job) stays in the
 * database; this layer adds the time budget, the overlap cap and the record.
 */

export type DrainStop = "idle" | "empty" | "limit" | "deadline" | "overlap";

/** The worker stops starting jobs this long before its budget ends, leaving room for the last job to store. */
export const DEADLINE_MARGIN_MS = 25_000;
export const DEFAULT_BUDGET_MS = 90_000;
export const MIN_BUDGET_MS = 30_000;
export const MAX_BUDGET_MS = 240_000;
export const DEFAULT_JOB_LIMIT = 40;
export const MAX_JOB_LIMIT = 100;
/** Concurrent invocations allowed. Leases already keep two of them off the same job; this bounds provider concurrency. */
export const DEFAULT_MAX_CONCURRENT = 2;

export interface InvocationOptions {
  owner?: string;
  trigger?: "schedule" | "manual" | "cli" | "simulation";
  jobLimit?: number;
  budgetMs?: number;
  /** Milliseconds clock. Defaults to Date.now; the simulation injects a virtual one. */
  clock?: () => number;
  maxConcurrent?: number;
  /** False skips the invocation table and the overlap cap (rollback of migration 0054). */
  record?: boolean;
}

export interface RemainingWork {
  due: number;
  /** Queued but not yet startable: backing off, connection cooling, or held by the provider breaker. */
  waiting: number;
  leased: number;
  dueByProvider: Record<string, number>;
}

export interface InvocationReport {
  invocationId: string | null;
  stopped: DrainStop;
  enqueued: number;
  jobs: number;
  succeeded: number;
  failed: number;
  retryScheduled: number;
  reconnectRequired: number;
  notConfigured: number;
  stale: number;
  remaining: RemainingWork;
  durationMs: number;
  result?: WorkerJobResult;
}

export interface ProviderDrainResult {
  stopped: Exclude<DrainStop, "idle" | "overlap">;
  jobs: number;
  succeeded: number;
  failed: number;
  retryScheduled: number;
  reconnectRequired: number;
  notConfigured: number;
  stale: number;
  result?: WorkerJobResult;
}

export function budgetFromEnv(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.ANALYTICS_WORKER_BUDGET_MS ?? DEFAULT_BUDGET_MS);
  return Number.isInteger(parsed) && parsed >= MIN_BUDGET_MS && parsed <= MAX_BUDGET_MS ? parsed : DEFAULT_BUDGET_MS;
}

export function jobLimitFromEnv(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.ANALYTICS_WORKER_JOB_LIMIT ?? DEFAULT_JOB_LIMIT);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_JOB_LIMIT ? parsed : DEFAULT_JOB_LIMIT;
}

export function maxConcurrentFromEnv(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.ANALYTICS_WORKER_MAX_CONCURRENT ?? DEFAULT_MAX_CONCURRENT);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : DEFAULT_MAX_CONCURRENT;
}

export function recordingFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  return env.ANALYTICS_RECORD_INVOCATIONS?.trim().toLowerCase() !== "off";
}

/** Minutes between maintenance passes (index inventory, URL inspection, PageSpeed). Keeps the pre-2.2 quota use of one pass a day. */
export function maintenanceIntervalMinutes(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.ANALYTICS_MAINTENANCE_INTERVAL_MINUTES ?? 1380);
  return Number.isInteger(parsed) && parsed >= 15 && parsed <= 10_080 ? parsed : 1380;
}

/**
 * Takes jobs one at a time until nothing is due, the limit is reached, or the next job might not
 * finish before the deadline. The longest job seen in this run is held in reserve, so a slow
 * provider does not push the last job past the platform limit.
 */
export async function drainProviderJobs(
  step: () => Promise<{ worked: boolean; result?: WorkerJobResult }>,
  options: { limit: number; deadlineAt: number; now?: () => number },
): Promise<ProviderDrainResult> {
  const now = options.now ?? Date.now;
  const counts: ProviderDrainResult = { stopped: "empty", jobs: 0, succeeded: 0, failed: 0, retryScheduled: 0, reconnectRequired: 0, notConfigured: 0, stale: 0 };
  let longestJobMs = 0;
  for (;;) {
    if (counts.jobs >= options.limit) {
      counts.stopped = "limit";
      break;
    }
    if (now() + longestJobMs >= options.deadlineAt) {
      counts.stopped = "deadline";
      break;
    }
    const began = now();
    const outcome = await step();
    if (!outcome.worked) break;
    longestJobMs = Math.max(longestJobMs, now() - began);
    counts.jobs += 1;
    counts.result = outcome.result;
    if (outcome.result === "succeeded") counts.succeeded += 1;
    else if (outcome.result === "failed") counts.failed += 1;
    else if (outcome.result === "retry") counts.retryScheduled += 1;
    else if (outcome.result === "reconnect") counts.reconnectRequired += 1;
    else if (outcome.result === "not_configured") counts.notConfigured += 1;
    else if (outcome.result === "stale") counts.stale += 1;
  }
  return counts;
}

/** What is left in the queue, split into what the next invocation can start and what is waiting. Read-only. */
export async function remainingWork(db: Queryable, now: Date, connectionId?: string): Promise<RemainingWork> {
  const { rows } = await db.query<{ provider: string; due: string; waiting: string; leased: string }>(
    `with tripped as (
       select provider from analytics_connections
       where status = 'connected' and disconnected_at is null and consecutive_failures >= 1
         and cooldown_until > $1::timestamptz - interval '2 hours'
       group by provider having count(*) >= $2
     )
     select c.provider,
       count(*) filter (where j.state = 'queued' and j.next_attempt_at <= $1
         and c.status = 'connected' and c.disconnected_at is null
         and (c.cooldown_until is null or c.cooldown_until <= $1)
         and not (c.consecutive_failures = 0 and c.provider in (select provider from tripped)))::text as due,
       count(*) filter (where j.state = 'queued')::text as waiting,
       count(*) filter (where j.state = 'leased')::text as leased
     from analytics_jobs j join analytics_connections c on c.id = j.connection_id
     where j.state in ('queued', 'leased') and ($3::uuid is null or j.connection_id = $3)
     group by c.provider`,
    [now.toISOString(), PROVIDER_BREAKER_THRESHOLD, connectionId ?? null],
  );
  const result: RemainingWork = { due: 0, waiting: 0, leased: 0, dueByProvider: {} };
  for (const row of rows) {
    const due = Number(row.due);
    result.due += due;
    result.waiting += Number(row.waiting) - due;
    result.leased += Number(row.leased);
    result.dueByProvider[row.provider] = due;
  }
  return result;
}

export async function registerInvocation(db: Queryable, input: { owner: string; trigger: string; now: Date; budgetMs: number; jobLimit: number; maxConcurrent: number; staleAfterMs: number }): Promise<{ id: string; overlapped: boolean }> {
  // Serialises the count and the insert, so two invocations starting together cannot both pass the cap.
  await db.query("select pg_advisory_xact_lock(hashtext('analytics_worker_invocations'))");
  const at = input.now.toISOString();
  await db.query(
    `update analytics_worker_invocations
     set state = 'abandoned', finished_at = $1, stop_reason = 'error', safe_error_code = 'worker_interrupted'
     where state = 'running' and started_at < $1::timestamptz - ($2 * interval '1 millisecond')`,
    [at, input.staleAfterMs],
  );
  const running = await db.query<{ n: string }>("select count(*)::text as n from analytics_worker_invocations where state = 'running'");
  const overlapped = Number(running.rows[0]!.n) >= input.maxConcurrent;
  const { rows } = await db.query<{ id: string }>(
    `insert into analytics_worker_invocations (owner, trigger, state, started_at, finished_at, stop_reason, budget_ms, job_limit, duration_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [input.owner, input.trigger, overlapped ? "finished" : "running", at, overlapped ? at : null, overlapped ? "overlap" : null, input.budgetMs, input.jobLimit, overlapped ? 0 : null],
  );
  return { id: rows[0]!.id, overlapped };
}

export async function closeInvocation(db: Queryable, id: string, report: InvocationReport, now: Date, maintenanceRan: boolean, errorCode: string | null): Promise<void> {
  await db.query(
    `update analytics_worker_invocations
     set state = 'finished', finished_at = $2, stop_reason = $3, planned = $4, jobs = $5, succeeded = $6, failed = $7,
         retried = $8, reconnect = $9, not_configured = $10, stale = $11, remaining_due = $12, remaining_waiting = $13,
         duration_ms = $14, maintenance_ran = $15, safe_error_code = $16
     where id = $1`,
    [id, now.toISOString(), errorCode ? "error" : report.stopped, report.enqueued, report.jobs, report.succeeded, report.failed,
      report.retryScheduled, report.reconnectRequired, report.notConfigured, report.stale, report.remaining.due, report.remaining.waiting,
      report.durationMs, maintenanceRan, errorCode],
  );
}

/** Whether a maintenance pass is due: none recorded, or the last one is older than the interval. */
export async function maintenanceDue(db: Queryable, now: Date, intervalMinutes: number): Promise<boolean> {
  const { rows } = await db.query<{ last: Date | null }>("select max(started_at) as last from analytics_worker_invocations where maintenance_ran");
  const last = rows[0]?.last;
  return !last || now.getTime() - new Date(last).getTime() >= intervalMinutes * 60_000;
}

/**
 * One invocation: register (and refuse if too many are running), plan what is due, work the queue
 * fairly until a stop condition, then record what happened and what remains. `after` runs once the
 * provider work is done and time remains (maintenance); it returns whether it ran.
 */
export async function runWorkerInvocation(
  run: <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>,
  deps: SyncDeps,
  options: InvocationOptions = {},
  after?: (info: { startedMs: number; budgetMs: number }) => Promise<boolean>,
): Promise<InvocationReport> {
  const clock = options.clock ?? Date.now;
  const owner = options.owner ?? "http";
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const jobLimit = options.jobLimit ?? DEFAULT_JOB_LIMIT;
  const record = options.record ?? true;
  const startedMs = clock();
  const empty = (): RemainingWork => ({ due: 0, waiting: 0, leased: 0, dueByProvider: {} });
  let invocationId: string | null = null;
  if (record) {
    const registered = await run((db) => registerInvocation(db, {
      owner, trigger: options.trigger ?? "schedule", now: new Date(startedMs), budgetMs, jobLimit,
      maxConcurrent: options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT, staleAfterMs: budgetMs + 120_000,
    }));
    invocationId = registered.id;
    if (registered.overlapped) {
      return { invocationId, stopped: "overlap", enqueued: 0, jobs: 0, succeeded: 0, failed: 0, retryScheduled: 0, reconnectRequired: 0, notConfigured: 0, stale: 0, remaining: empty(), durationMs: 0 };
    }
  }
  let report: InvocationReport | null = null;
  let maintenanceRan = false;
  try {
    const deadlineAt = startedMs + budgetMs - DEADLINE_MARGIN_MS;
    const enqueued = await run((db) => enqueueDue(db, new Date(clock())));
    const drained = await drainProviderJobs(
      () => runWorkerOnce(run, owner, { ...deps, now: new Date(clock()), deadlineAt, clock }),
      { limit: jobLimit, deadlineAt, now: clock },
    );
    if (after && clock() - startedMs < budgetMs - 20_000) maintenanceRan = await after({ startedMs, budgetMs });
    const remaining = await run((db) => remainingWork(db, new Date(clock())));
    const nothingAtAll = drained.jobs === 0 && enqueued === 0 && remaining.due === 0 && remaining.waiting === 0 && remaining.leased === 0;
    report = {
      invocationId, ...drained, enqueued, remaining,
      stopped: nothingAtAll ? "idle" : drained.stopped,
      durationMs: clock() - startedMs,
    };
    if (record && invocationId) await run((db) => closeInvocation(db, invocationId!, report!, new Date(clock()), maintenanceRan, null));
    return report;
  } catch (error) {
    // Best effort: if the database itself failed the row stays `running` and the next invocation marks it abandoned.
    if (record && invocationId) {
      const failed: InvocationReport = report ?? { invocationId, stopped: "empty", enqueued: 0, jobs: 0, succeeded: 0, failed: 0, retryScheduled: 0, reconnectRequired: 0, notConfigured: 0, stale: 0, remaining: empty(), durationMs: clock() - startedMs };
      await run((db) => closeInvocation(db, invocationId!, failed, new Date(clock()), maintenanceRan, "worker_error")).catch(() => undefined);
    }
    throw error;
  }
}
