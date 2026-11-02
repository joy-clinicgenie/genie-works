import type { Queryable } from "../client";
import { inspectNext, measureNext, refreshIndexInventory, type CheckDeps } from "../services/site-health";
import { runWorkerOnce, type SyncDeps } from "./sync";

export interface MaintenanceResult {
  jobs: number;
  inspected: number;
  measured: number;
  result?: string;
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
  let jobs = 0;
  let result: string | undefined;
  while (jobs < jobLimit && Date.now() - started < budgetMs - 25_000) {
    const outcome = await run((db) => runWorkerOnce(db, owner, { ...deps, now: new Date() }));
    if (!outcome.worked) break;
    jobs += 1;
    result = outcome.result;
  }
  await run((db) => refreshIndexInventory(db));
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
  return { jobs, inspected, measured, result };
}
