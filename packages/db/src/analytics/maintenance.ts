import type { Queryable } from "../client";
import { inspectNext, measureNext, refreshIndexInventory, type CheckDeps } from "../services/site-health";
import type { SyncDeps, WorkerJobResult } from "./sync";
import {
  DEFAULT_BUDGET_MS,
  DEFAULT_JOB_LIMIT,
  maintenanceDue,
  maintenanceIntervalMinutes,
  runWorkerInvocation,
  type DrainStop,
  type InvocationOptions,
  type RemainingWork,
} from "./worker-run";

export interface MaintenanceResult {
  stopped?: DrainStop;
  invocationId?: string | null;
  jobs: number;
  enqueued: number;
  succeeded: number;
  failed: number;
  retryScheduled: number;
  reconnectRequired: number;
  notConfigured: number;
  stale: number;
  inspected: number;
  measured: number;
  remaining?: RemainingWork;
  durationMs?: number;
  result?: WorkerJobResult;
}

/**
 * One invocation: plan and drain due provider jobs (recorded, bounded, fair), then, at most once
 * a day, rebuild the index inventory and ask Google about the next public pages and store a few
 * mobile lab scores. Provider work always goes first and maintenance only uses time that is left.
 * The once-a-day limit keeps URL Inspection and PageSpeed use at what a single daily run used
 * before Phase 2.2, however often the schedule fires.
 */
export async function drainMaintenance(
  run: <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>,
  deps: SyncDeps & CheckDeps,
  options: InvocationOptions & { inspectLimit?: number; speedLimit?: number; maintenanceIntervalMinutes?: number } = {},
): Promise<MaintenanceResult> {
  const clock = options.clock ?? Date.now;
  const inspectLimit = options.inspectLimit ?? 20;
  const speedLimit = options.speedLimit ?? 3;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const record = options.record ?? true;
  let inspected = 0;
  let measured = 0;
  const report = await runWorkerInvocation(run, deps, { ...options, jobLimit: options.jobLimit ?? DEFAULT_JOB_LIMIT, budgetMs }, async ({ startedMs }) => {
    const interval = options.maintenanceIntervalMinutes ?? maintenanceIntervalMinutes();
    if (record && !(await run((db) => maintenanceDue(db, new Date(clock()), interval)))) return false;
    const withinBudget = () => clock() - startedMs < budgetMs - 20_000;
    await run((db) => refreshIndexInventory(db));
    while (inspected < inspectLimit && withinBudget()) {
      const step = await run((db) => inspectNext(db, { ...deps, now: new Date(clock()) }));
      if (step !== "done") break;
      inspected += 1;
    }
    while (measured < speedLimit && withinBudget()) {
      const step = await run((db) => measureNext(db, { ...deps, now: new Date(clock()) }));
      if (step !== "done") break;
      measured += 1;
    }
    return true;
  });
  return {
    stopped: report.stopped,
    invocationId: report.invocationId,
    jobs: report.jobs,
    enqueued: report.enqueued,
    succeeded: report.succeeded,
    failed: report.failed,
    retryScheduled: report.retryScheduled,
    reconnectRequired: report.reconnectRequired,
    notConfigured: report.notConfigured,
    stale: report.stale,
    inspected,
    measured,
    remaining: report.remaining,
    durationMs: report.durationMs,
    result: report.result,
  };
}
