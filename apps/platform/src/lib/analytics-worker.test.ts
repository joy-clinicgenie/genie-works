import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { workerAuthorized } from "@/lib/analytics-worker";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("analytics worker scheduler preparation", () => {
  it("accepts the worker secret or the cron secret and rejects a missing or wrong bearer", () => {
    const env = { workerSecret: "worker-secret-value", cronSecret: "cron-secret-value" };
    expect(workerAuthorized("Bearer worker-secret-value", env)).toBe(true);
    expect(workerAuthorized("Bearer cron-secret-value", env)).toBe(true);
    expect(workerAuthorized("Bearer other-secret-value", env)).toBe(false);
    expect(workerAuthorized(null, env)).toBe(false);
    expect(workerAuthorized("Bearer worker-secret-value", {})).toBe(false);
    expect(workerAuthorized("Bearer cron-secret-value", { workerSecret: "worker-secret-value" })).toBe(false);
  });

  it("prepares a GET cron for the same path the worker handles", () => {
    const config = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as { crons?: Array<{ path: string; schedule: string }> };
    const route = readFileSync(resolve(root, "apps/platform/src/app/api/internal/analytics/worker/route.ts"), "utf8");
    expect(config.crons).toEqual([{ path: "/api/internal/analytics/worker", schedule: "0 2 * * *" }]);
    expect(route).toContain("export function GET");
    expect(route).toContain("export function POST");
    expect(route).toContain("workerAuthorized");
    expect(route).toContain("drainMaintenance");
  });

  it("uses durable claims, separate execution and safe lease recovery", () => {
    const source = readFileSync(resolve(root, "packages/db/src/analytics/sync.ts"), "utf8");
    expect(source).toContain("claimNextJob");
    expect(source).toContain("executeClaimedJob");
    expect(source).toContain("reapExpiredLeases");
    expect(source).toContain("lease_expired");
  });
});
