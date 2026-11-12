import { existsSync, readdirSync, readFileSync } from "node:fs";
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

  it("declares the GET schedule in the one vercel.json at the repository root (D51, D55)", () => {
    // The Vercel project Root Directory is the repository root, so only ./vercel.json is read.
    // Vercel ignores any other name, such as a "vercel 2.json" copy.
    const config = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as {
      crons?: unknown;
      schedules?: Record<string, Record<string, unknown>>;
    };
    const route = readFileSync(resolve(root, "apps/platform/src/app/api/internal/analytics/worker/route.ts"), "utf8");
    // Vercel Schedules replaced Cron Jobs. Keeping both would call the worker twice.
    expect(config.crons).toBeUndefined();
    // A path schedule defaults to POST; the name must stay stable to keep its history.
    expect(config.schedules).toEqual({
      "analytics-worker": { schedule: "0 2 * * *", path: "/api/internal/analytics/worker", requestMethod: "GET" },
    });
    expect(existsSync(resolve(root, "apps/platform/vercel.json"))).toBe(false);
    expect(readdirSync(root).filter((name) => /^vercel.*\.json$/i.test(name))).toEqual(["vercel.json"]);
    expect(route).toContain("export function GET");
    expect(route).toContain("export function POST");
    expect(route).toContain("workerAuthorized");
    expect(route).toContain("drainMaintenance");
  });

  it("keeps debugging instrumentation and secret metadata out of the worker route", () => {
    const route = readFileSync(resolve(root, "apps/platform/src/app/api/internal/analytics/worker/route.ts"), "utf8");
    expect(route).not.toContain("127.0.0.1:7835");
    expect(route).not.toContain("X-Debug-Session-Id");
    expect(route).not.toMatch(/agent log/i);
    expect(route).not.toMatch(/bearerLength|secretLength|workerSecretSet|cronSecretSet/);
    // Nothing is read from the environment and nothing is sent anywhere before the authorisation gate.
    const handler = route.slice(route.indexOf("async function handle"));
    const gate = handler.indexOf("workerAuthorized");
    expect(gate).toBeGreaterThan(0);
    expect(handler.slice(0, gate)).not.toMatch(/fetch|process\.env/i);
  });

  it("uses durable claims, separate execution and safe lease recovery", () => {
    const source = readFileSync(resolve(root, "packages/db/src/analytics/sync.ts"), "utf8");
    expect(source).toContain("claimNextJob");
    expect(source).toContain("executeClaimedJob");
    expect(source).toContain("reapExpiredLeases");
    expect(source).toContain("lease_expired");
  });
});
