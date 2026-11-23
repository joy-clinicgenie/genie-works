/**
 * Capacity simulation for the analytics worker (Phase 2.2). Seven days of 30-minute scheduled
 * invocations for the production-sized connection set (1 GA4, 10 Search Console, 10 Wix) against
 * a fictional provider, on a virtual clock. Local database only; each scenario is rolled back.
 *
 *   npm run analytics:simulate -w @clinic-genie/db -- --out ../../docs/audits/ANALYTICS_PHASE_2_2_SIMULATION.json
 */
import { writeFileSync } from "node:fs";
import { closePools, SERVICE, withContext } from "../src/client";
import { loadRootEnv } from "../src/env";
import { assertLocalWorkerDatabase } from "../src/testing/targets";
import { DEFAULT_SIMULATION, partialFailurePlan, simulate, type SimulationOptions, type SimulationResult } from "../test/simulation";

loadRootEnv();
process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-simulation-key-0123456789";
assertLocalWorkerDatabase(process.env.DATABASE_URL ?? "");

class Rollback extends Error {}

const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined;
const scenarios: Array<{ name: string; options: Partial<SimulationOptions> }> = [
  { name: "latency 1 s, no faults", options: { latencyMs: 1000 } },
  { name: "latency 2 s, no faults", options: { latencyMs: 2000 } },
  { name: "latency 4 s, no faults", options: { latencyMs: 4000 } },
  { name: "latency 4 s, no faults, cadence 60 min", options: { latencyMs: 4000, tickMinutes: 60 } },
  { name: "latency 4 s, no faults, budget 240 s, limit 100", options: { latencyMs: 4000, budgetMs: 240_000, jobLimit: 100 } },
  { name: "latency 2 s, partial failures", options: { latencyMs: 2000, faults: partialFailurePlan(DEFAULT_SIMULATION.startAt) } },
  { name: "latency 4 s, partial failures", options: { latencyMs: 4000, faults: partialFailurePlan(DEFAULT_SIMULATION.startAt) } },
  { name: "latency 2 s, version 1 plan (221 jobs a day)", options: { latencyMs: 2000, planner: "v1" } },
];

const results: Array<{ name: string; result: SimulationResult }> = [];
try {
  for (const scenario of scenarios) {
    const began = Date.now();
    try {
      await withContext(SERVICE, async (db) => {
        const admin = (await db.query<{ id: string }>("select id from staff_users where platform_role = 'admin' order by created_at limit 1")).rows[0];
        if (!admin) throw new Error("Seed admin missing. Run npm run db:seed.");
        const result = await simulate(db, admin.id, scenario.options);
        results.push({ name: scenario.name, result });
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    const { result } = results[results.length - 1]!;
    console.error(`${scenario.name}: ${result.jobsProcessed} jobs, ${result.invocations} invocations, backlog ${result.remainingAtEnd.due + result.remainingAtEnd.waiting} (${((Date.now() - began) / 1000).toFixed(0)} s real)`);
  }
} finally {
  await closePools();
}
const json = JSON.stringify(results, null, 2);
if (out) writeFileSync(out, `${json}\n`);
else console.log(json);
