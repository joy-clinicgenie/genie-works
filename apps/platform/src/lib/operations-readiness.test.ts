import { describe, expect, it } from "vitest";
import { assertEnquiryFixtureUrl, canManageUsers, type AccessProfile, type PlatformSyncHealth } from "@clinic-genie/db";
import { assembleOperationsReport, deploymentClass, enquiryFixturePermitted, secretState } from "./operations-readiness";
import { operationsAudience } from "./operations-status";

const local = "postgresql://cg_app:secret-value@127.0.0.1:54339/clinic_genie_rehearsal";
const remote = "postgresql://cg_app:secret-value@db.example.com:5432/neondb";
const now = new Date("2026-10-31T00:00:00.000Z");

function profile(role: AccessProfile["user"]["platform_role"]): AccessProfile {
  return { user: { id: "1", email: "person@example.invalid", display_name: "Person", platform_role: role, active: true }, memberships: [] };
}

function sync(partial: Partial<PlatformSyncHealth> = {}): PlatformSyncHealth {
  return {
    connections: 0,
    queued: 0,
    leased: 0,
    stalledLeases: 0,
    failed: 0,
    reconnectRequired: 0,
    lastSuccessAt: null,
    safeError: null,
    ...partial,
  };
}

describe("operations readiness", () => {
  it("separates a local production process from connected staging and production", () => {
    expect(deploymentClass({ NODE_ENV: "production", DATABASE_URL: local })).toBe("local-rehearsal");
    expect(deploymentClass({ NODE_ENV: "development", DATABASE_URL: local })).toBe("local-rehearsal");
    expect(deploymentClass({ NODE_ENV: "production", VERCEL_ENV: "preview", DATABASE_URL: remote })).toBe("connected-staging");
    expect(deploymentClass({ NODE_ENV: "production", VERCEL_ENV: "production", DATABASE_URL: remote })).toBe("production");
    expect(deploymentClass({ NODE_ENV: "production", DATABASE_URL: remote })).toBe("production");
    expect(deploymentClass({ NODE_ENV: "development", DATABASE_URL: remote })).toBe("unassigned-remote");
    expect(enquiryFixturePermitted({ NODE_ENV: "production", DATABASE_URL: local })).toBe(false);
    expect(enquiryFixturePermitted({ NODE_ENV: "development", VERCEL_ENV: "preview", DATABASE_URL: local })).toBe(true);
    expect(enquiryFixturePermitted({ VERCEL_ENV: "production", DATABASE_URL: local })).toBe(false);
  });

  it("keeps the production enquiry fixture refusal", () => {
    const env = process.env as Record<string, string | undefined>;
    const previousNode = env.NODE_ENV;
    const previousVercel = env.VERCEL_ENV;
    env.NODE_ENV = "production";
    delete env.VERCEL_ENV;
    try {
      expect(enquiryFixturePermitted(env)).toBe(false);
      expect(() => assertEnquiryFixtureUrl("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie_enquiry_test")).toThrow(/production/);
    } finally {
      if (previousNode === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previousNode;
      if (previousVercel === undefined) delete env.VERCEL_ENV;
      else env.VERCEL_ENV = previousVercel;
    }
  });

  it("reports secret presence without copying secret values", () => {
    expect(secretState("")).toBe("missing");
    expect(secretState("preview-build-only")).toBe("placeholder");
    expect(secretState("replace-with-a-long-random-string")).toBe("placeholder");
    expect(secretState("a-real-runtime-secret-value")).toBe("set");
    const report = assembleOperationsReport({
      env: {
        NODE_ENV: "production",
        DATABASE_URL: local,
        AUTH_SECRET: "preview-build-only",
        AUTH_URL: "http://127.0.0.1:3400",
        ANALYTICS_WORKER_SECRET: "worker-secret-value",
      },
      enquiry: { configured: true, reachable: false, refused: true },
      failedNotifications: null,
      sync: sync(),
      backupOutcome: null,
      restoreOutcome: null,
      now,
    });
    const text = JSON.stringify(report);
    expect(report.authSecret).toBe("placeholder");
    expect(report.database).toBe("local");
    expect(report.enquirySource).toBe("refused");
    expect(report.workerBearer).toBe("set");
    expect(text).not.toContain("preview-build-only");
    expect(text).not.toContain("secret-value");
    expect(text).not.toContain("worker-secret-value");
    expect(text).not.toContain("postgresql://");
    expect(report.signals.join(" ")).toContain("build placeholder");
    expect(report.signals.join(" ")).toContain("refused");
  });

  it("names failed, stalled and stale analytics without treating them as a live provider check", () => {
    const failed = assembleOperationsReport({
      env: { NODE_ENV: "development", DATABASE_URL: local, AUTH_SECRET: "a-real-runtime-secret-value", AUTH_URL: "http://127.0.0.1:3400" },
      enquiry: { configured: false, reachable: false, refused: false },
      failedNotifications: null,
      sync: sync({ connections: 1, failed: 2, safeError: "lease_expired" }),
      backupOutcome: "passed",
      restoreOutcome: "passed",
      now,
    });
    expect(failed.sync.freshness).toBe("failed");
    expect(failed.signals.join(" ")).toContain("lease_expired");

    const stalled = assembleOperationsReport({
      env: { NODE_ENV: "development", DATABASE_URL: local, AUTH_SECRET: "a-real-runtime-secret-value" },
      enquiry: { configured: false, reachable: false, refused: false },
      failedNotifications: null,
      sync: sync({ connections: 1, stalledLeases: 1 }),
      backupOutcome: "passed",
      restoreOutcome: "passed",
      now,
    });
    expect(stalled.sync.freshness).toBe("failed");

    const stale = assembleOperationsReport({
      env: { NODE_ENV: "development", DATABASE_URL: local, AUTH_SECRET: "a-real-runtime-secret-value" },
      enquiry: { configured: true, reachable: true, refused: false },
      failedNotifications: 1,
      sync: sync({ connections: 1, lastSuccessAt: new Date("2026-10-28T00:00:00.000Z") }),
      backupOutcome: "passed",
      restoreOutcome: "passed",
      now,
    });
    expect(stale.sync.freshness).toBe("stale");
    expect(stale.failedNotifications).toBe(1);
    expect(stale.signals.join(" ")).toContain("not mailbox delivery");
    expect(stale.signals.join(" ")).toContain("not an approved live source");
  });

  it("limits the operations route to an administrator", () => {
    expect(operationsAudience(null)).toBe("unauthenticated");
    expect(operationsAudience("manager")).toBe("forbidden");
    expect(operationsAudience("admin")).toBe("allowed");
    expect(canManageUsers(profile("admin"))).toBe(true);
    expect(canManageUsers(profile("manager"))).toBe(false);
    expect(canManageUsers(profile("specialist"))).toBe(false);
  });
});
