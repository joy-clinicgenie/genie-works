import { afterEach, describe, expect, it } from "vitest";
import { closePools, getAdminPool, getPool } from "../src/client";
import {
  PRODUCTION_DATABASE_WARNING,
  assertMigrationDatabase,
  assertProcessDatabase,
  assertTestDatabase,
  assertWorkerDatabase,
  databaseEndpoint,
  databasePlace,
  endpointFingerprint,
  isProductionDatabaseUrl,
  resetProductionDatabaseWarning,
  runtimeEnvironment,
} from "../src/database-environment";
import { assertMigrationTarget, describeDatabaseTarget } from "../src/migrate";
import { assertLocalWorkerDatabase } from "../src/testing/targets";

/** No real host appears here. The production host is declared through PRODUCTION_DATABASE_HOSTS. */
const LOCAL = "postgresql://cg_app:secret-password@127.0.0.1:54339/clinic_genie";
const PROD = "postgresql://cg_app:secret-password@ep-prod-example-123456.ap-southeast-1.aws.example.test/neondb";
const PROD_POOLED = "postgresql://cg_app:secret-password@ep-prod-example-123456-pooler.ap-southeast-1.aws.example.test/neondb";
const PREVIEW = "postgresql://cg_app:secret-password@ep-preview-example-654321.ap-southeast-1.aws.example.test/neondb";
const OTHER = "postgresql://cg_app:secret-password@db.unlisted.example.test:5432/clinic_genie";
const PROD_HOSTS = { PRODUCTION_DATABASE_HOSTS: "ep-prod-example-123456.ap-southeast-1.aws.example.test" };
const PREVIEW_LISTED = { NONPRODUCTION_DATABASE_HOSTS: "ep-preview-example-654321.ap-southeast-1.aws.example.test" };

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

describe("database environment (D54)", () => {
  it("classifies the runtime, and a test run is never production", () => {
    expect(runtimeEnvironment({})).toBe("development");
    expect(runtimeEnvironment({ NODE_ENV: "production" })).toBe("development");
    expect(runtimeEnvironment({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(runtimeEnvironment({ VERCEL_ENV: "production" })).toBe("production");
    expect(runtimeEnvironment({ VERCEL_ENV: "production", VITEST: "true" })).toBe("test");
  });

  it("recognises the production endpoint in its direct and pooled forms", () => {
    expect(endpointFingerprint("ep-prod-example-123456-pooler.x.example.test")).toBe(endpointFingerprint("EP-prod-example-123456.y.example.test"));
    expect(databaseEndpoint(PROD, PROD_HOSTS)).toEqual({ local: false, production: true, approvedNonProduction: false });
    expect(databaseEndpoint(PROD_POOLED, PROD_HOSTS).production).toBe(true);
    expect(databaseEndpoint(PREVIEW, PROD_HOSTS).production).toBe(false);
    expect(databaseEndpoint(LOCAL, PROD_HOSTS)).toEqual({ local: true, production: false, approvedNonProduction: false });
    expect(isProductionDatabaseUrl("not a url", PROD_HOSTS)).toBe(false);
  });

  it("does not let a non-production listing lift production protection", () => {
    const both = { ...PROD_HOSTS, NONPRODUCTION_DATABASE_HOSTS: PROD_HOSTS.PRODUCTION_DATABASE_HOSTS };
    expect(databaseEndpoint(PROD, both)).toEqual({ local: false, production: true, approvedNonProduction: false });
    expect(() => assertTestDatabase(PROD, both)).toThrow(/production database/);
    expect(() => assertWorkerDatabase(PROD_POOLED, { ...both, ANALYTICS_ALLOW_REMOTE_WORKER: "1" })).toThrow(/production/);
  });

  it("keeps tests on a local database or a listed non-production host", () => {
    expect(() => assertTestDatabase(LOCAL, {})).not.toThrow();
    expect(() => assertTestDatabase(PROD, PROD_HOSTS)).toThrow(/tests never run against the production database/);
    expect(() => assertTestDatabase(OTHER, {})).toThrow(/not local/);
    expect(() => assertTestDatabase(PREVIEW, {})).toThrow(/not local/);
    expect(() => assertTestDatabase(PREVIEW, PREVIEW_LISTED)).not.toThrow();
    expect(() => assertTestDatabase("", {})).toThrow(/not valid/);
  });

  it("runs the worker on production only from the production deployment", () => {
    expect(() => assertWorkerDatabase(PROD, { ...PROD_HOSTS, VERCEL_ENV: "production" })).not.toThrow();
    expect(() => assertWorkerDatabase(PROD, { ...PROD_HOSTS, VERCEL_ENV: "preview" })).toThrow(/only the production deployment/);
    expect(() => assertWorkerDatabase(PROD, { ...PROD_HOSTS })).toThrow(/only the production deployment/);
    expect(() => assertWorkerDatabase(PROD, { ...PROD_HOSTS, ANALYTICS_ALLOW_REMOTE_WORKER: "1" })).toThrow(/only the production deployment/);
    expect(() => assertWorkerDatabase(PROD, { ...PROD_HOSTS, NODE_ENV: "production", ANALYTICS_ALLOW_REMOTE_WORKER: "1" })).toThrow(/only the production deployment/);
  });

  it("lets a development worker use a local database, or a remote one only when allowed and listed", () => {
    expect(() => assertWorkerDatabase(LOCAL, {})).not.toThrow();
    expect(() => assertWorkerDatabase(PREVIEW, {})).toThrow(/not local/);
    expect(() => assertWorkerDatabase(PREVIEW, { ANALYTICS_ALLOW_REMOTE_WORKER: "1" })).toThrow(/not local/);
    expect(() => assertWorkerDatabase(PREVIEW, PREVIEW_LISTED)).toThrow(/not local/);
    expect(() => assertWorkerDatabase(PREVIEW, { ...PREVIEW_LISTED, ANALYTICS_ALLOW_REMOTE_WORKER: "1" })).not.toThrow();
    expect(() => assertWorkerDatabase(PREVIEW, { VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => assertWorkerDatabase(OTHER, { VITEST: "true", ANALYTICS_ALLOW_REMOTE_WORKER: "1" })).toThrow(/not local/);
  });

  it("requires a dated confirmation and a restore point before a production migration", () => {
    const input = { database: "neondb", today: "2026-11-12" };
    expect(assertMigrationDatabase(LOCAL, input, {})).toBe("local");
    expect(() => assertMigrationDatabase(PROD, input, { ...PROD_HOSTS, MIGRATE_ALLOW_REMOTE: "1" })).toThrow(/production database/);
    expect(() => assertMigrationDatabase(PROD, input, { ...PROD_HOSTS, MIGRATE_PRODUCTION_CONFIRM: "2026-11-11:neondb", MIGRATE_BACKUP_REFERENCE: "pre-0044-branch" })).toThrow(/production database/);
    expect(() => assertMigrationDatabase(PROD, input, { ...PROD_HOSTS, MIGRATE_PRODUCTION_CONFIRM: "2026-11-12:other", MIGRATE_BACKUP_REFERENCE: "pre-0044-branch" })).toThrow(/production database/);
    expect(() => assertMigrationDatabase(PROD, input, { ...PROD_HOSTS, MIGRATE_PRODUCTION_CONFIRM: "2026-11-12:neondb" })).toThrow(/MIGRATE_BACKUP_REFERENCE/);
    expect(assertMigrationDatabase(PROD_POOLED, input, { ...PROD_HOSTS, MIGRATE_PRODUCTION_CONFIRM: "2026-11-12:neondb", MIGRATE_BACKUP_REFERENCE: "pre-0044-branch" })).toBe("production");
  });

  it("requires both the opt-in and a listing for a remote non-production migration", () => {
    const input = { database: "neondb", today: "2026-11-12" };
    expect(() => assertMigrationDatabase(PREVIEW, input, {})).toThrow(/not local/);
    expect(() => assertMigrationDatabase(PREVIEW, input, { MIGRATE_ALLOW_REMOTE: "1" })).toThrow(/not local/);
    expect(() => assertMigrationDatabase(PREVIEW, input, PREVIEW_LISTED)).toThrow(/not local/);
    expect(assertMigrationDatabase(PREVIEW, input, { ...PREVIEW_LISTED, MIGRATE_ALLOW_REMOTE: "1" })).toBe("non_production");
  });

  it("never puts a host name, password or connection string in a refusal", () => {
    const messages = [
      messageOf(() => assertTestDatabase(PROD, PROD_HOSTS)),
      messageOf(() => assertTestDatabase(OTHER, {})),
      messageOf(() => assertWorkerDatabase(PROD, PROD_HOSTS)),
      messageOf(() => assertWorkerDatabase(OTHER, {})),
      messageOf(() => assertMigrationDatabase(PROD, { database: "neondb", today: "2026-11-12" }, PROD_HOSTS)),
      messageOf(() => assertMigrationDatabase(OTHER, { database: "clinic_genie", today: "2026-11-12" }, {})),
      messageOf(() => assertProcessDatabase(PROD, "app", { ...PROD_HOSTS, DEV_PRODUCTION_DATABASE_ACCESS: "refuse" })),
      PRODUCTION_DATABASE_WARNING,
    ];
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(/example\.test|secret-password|postgresql:\/\/|ep-prod|unlisted/);
    }
  });

  it("warns once when a development or preview process opens production, and can refuse", () => {
    resetProductionDatabaseWarning();
    const lines: string[] = [];
    const warn = (line: string) => lines.push(line);
    assertProcessDatabase(PROD, "app", PROD_HOSTS, warn);
    assertProcessDatabase(PROD, "admin", PROD_HOSTS, warn);
    assertProcessDatabase(PROD_POOLED, "app", { ...PROD_HOSTS, VERCEL_ENV: "preview" }, warn);
    expect(lines).toEqual([PRODUCTION_DATABASE_WARNING]);
    resetProductionDatabaseWarning();
    assertProcessDatabase(PROD, "app", { ...PROD_HOSTS, VERCEL_ENV: "production" }, warn);
    assertProcessDatabase(LOCAL, "app", PROD_HOSTS, warn);
    assertProcessDatabase(PREVIEW, "app", PROD_HOSTS, warn);
    expect(lines).toHaveLength(1);
    expect(() => assertProcessDatabase(PROD, "app", { ...PROD_HOSTS, DEV_PRODUCTION_DATABASE_ACCESS: "refuse" }, warn)).toThrow(/may not use the production database/);
    // The owner connection is governed by the migration, seed and backup guards.
    expect(() => assertProcessDatabase(PROD, "admin", { ...PROD_HOSTS, DEV_PRODUCTION_DATABASE_ACCESS: "refuse" }, warn)).not.toThrow();
    resetProductionDatabaseWarning();
  });

  it("describes a target without naming its host", () => {
    expect(databasePlace(LOCAL, {})).toBe("local");
    expect(databasePlace(PROD, PROD_HOSTS)).toBe("production");
    expect(databasePlace(PREVIEW, PREVIEW_LISTED)).toBe("approved non-production");
    expect(databasePlace(OTHER, {})).toBe("remote");
    expect(databasePlace("nonsense", {})).toBe("unreadable");
    expect(describeDatabaseTarget(OTHER)).toBe("database target: remote port 5432 database clinic_genie");
  });
});

describe("database environment guards at the connection points (D54)", () => {
  const saved: Record<string, string | undefined> = {};
  const set = (name: string, value: string | undefined) => {
    if (!(name in saved)) saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  afterEach(async () => {
    await closePools();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
      delete saved[name];
    }
  });

  it("refuses to create a pool on a remote database during a test run", async () => {
    await closePools();
    set("NONPRODUCTION_DATABASE_HOSTS", undefined);
    set("DATABASE_URL", OTHER);
    set("DATABASE_ADMIN_URL", OTHER);
    expect(() => getPool()).toThrow(/not local/);
    expect(() => getAdminPool()).toThrow(/not local/);
  });

  it("refuses to create a pool on the production database during a test run", async () => {
    await closePools();
    set("PRODUCTION_DATABASE_HOSTS", PROD_HOSTS.PRODUCTION_DATABASE_HOSTS);
    set("NONPRODUCTION_DATABASE_HOSTS", PROD_HOSTS.PRODUCTION_DATABASE_HOSTS);
    set("DATABASE_URL", PROD_POOLED);
    set("DATABASE_ADMIN_URL", PROD);
    expect(() => getPool()).toThrow(/production database/);
    expect(() => getAdminPool()).toThrow(/production database/);
  });

  it("applies the same rules to the worker command and to db:migrate", () => {
    set("PRODUCTION_DATABASE_HOSTS", PROD_HOSTS.PRODUCTION_DATABASE_HOSTS);
    set("ANALYTICS_ALLOW_REMOTE_WORKER", "1");
    set("MIGRATE_ALLOW_REMOTE", "1");
    set("MIGRATE_PRODUCTION_CONFIRM", undefined);
    set("MIGRATE_BACKUP_REFERENCE", undefined);
    set("NONPRODUCTION_DATABASE_HOSTS", undefined);
    expect(() => assertLocalWorkerDatabase(PROD)).toThrow(/production/);
    expect(() => assertLocalWorkerDatabase(OTHER)).toThrow(/not local/);
    expect(() => assertLocalWorkerDatabase(LOCAL)).not.toThrow();
    expect(() => assertMigrationTarget(PROD)).toThrow(/production database/);
    expect(() => assertMigrationTarget(OTHER)).toThrow(/not local/);
    expect(assertMigrationTarget(LOCAL)).toBe("local");
    const now = new Date("2026-11-12T03:00:00Z");
    set("MIGRATE_PRODUCTION_CONFIRM", "2026-11-12:neondb");
    set("MIGRATE_BACKUP_REFERENCE", "pre-0044-branch");
    expect(assertMigrationTarget(PROD, now)).toBe("production");
    expect(() => assertMigrationTarget(PROD, new Date("2026-11-13T03:00:00Z"))).toThrow(/production database/);
  });
});
