import type { Queryable } from "../client";
import { inspectNext, measureNext, refreshIndexInventory, type CheckDeps } from "../services/site-health";
import { enqueueDue, runWorkerOnce, type SyncDeps, type WorkerJobResult } from "./sync";

export interface MaintenanceResult {
  jobs: number;
  enqueued: number;
  succeeded: number;
  failed: number;
  retryScheduled: number;
  reconnectRequired: number;
  stale: number;
  inspected: number;
  measured: number;
  result?: WorkerJobResult;
}

export interface ProviderDrainResult {
  jobs: number;
  succeeded: number;
  failed: number;
  retryScheduled: number;
  reconnectRequired: number;
  stale: number;
  result?: WorkerJobResult;
}

export async function drainProviderJobs(
  step: () => Promise<{ worked: boolean; result?: WorkerJobResult }>,
  options: { limit: number; deadlineAt: number; now?: () => number },
): Promise<ProviderDrainResult> {
  const now = options.now ?? Date.now;
  const counts: ProviderDrainResult = {
    jobs: 0,
    succeeded: 0,
    failed: 0,
    retryScheduled: 0,
    reconnectRequired: 0,
    stale: 0,
  };
  while (counts.jobs < options.limit && now() < options.deadlineAt) {
    const outcome = await step();
    if (!outcome.worked) break;
    counts.jobs += 1;
    counts.result = outcome.result;
    if (outcome.result === "succeeded") counts.succeeded += 1;
    else if (outcome.result === "failed") counts.failed += 1;
    else if (outcome.result === "retry") counts.retryScheduled += 1;
    else if (outcome.result === "reconnect") counts.reconnectRequired += 1;
    else if (outcome.result === "stale") counts.stale += 1;
  }
  return counts;
}

/** One invocation drains due provider jobs, then asks Google about the next public pages and stores a few mobile lab scores. */
export async function drainMaintenance(
  run: <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>,
  deps: SyncDeps & CheckDeps,
  options: { owner?: string; jobLimit?: number; inspectLimit?: number; speedLimit?: number; budgetMs?: number } = {},
): Promise<MaintenanceResult> {
  const owner = options.owner ?? "http";
  const jobLimit = options.jobLimit ?? 40;
  const inspectLimit = options.inspectLimit ?? 20;
  const speedLimit = options.speedLimit ?? 3;
  const budgetMs = options.budgetMs ?? 90_000;
  const started = Date.now();
  const jobDeadlineAt = started + budgetMs - 25_000;
  const enqueued = await run((db) => enqueueDue(db, new Date()));
  const provider = await drainProviderJobs(
    () => runWorkerOnce(run, owner, { ...deps, now: new Date(), deadlineAt: jobDeadlineAt }),
    { limit: jobLimit, deadlineAt: jobDeadlineAt },
  );
  if (Date.now() - started < budgetMs - 20_000) {
    await run((db) => refreshIndexInventory(db));
  }
  let inspected = 0;
  while (inspected < inspectLimit && Date.now() - started < budgetMs - 20_000) {
    const step = await run((db) => inspectNext(db, { ...deps, now: new Date() }));
    if (step !== "done") break;
    inspected += 1;
  }
  let measured = 0;
  while (measured < speedLimit && Date.now() - started < budgetMs - 20_000) {
    const step = await run((db) => measureNext(db, { ...deps, now: new Date() }));
    if (step !== "done") break;
    measured += 1;
  }
  return { ...provider, enqueued, inspected, measured };
}
