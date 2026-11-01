import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertRecoveryDatabaseName, assertRecoverySource, BACKUP_EXCLUDED_TABLES, BACKUP_TABLES, recoveryDestinationName } from "../src/backup";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function tablesCreatedByMigrations(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    for (const match of sql.matchAll(/create table(?: if not exists)?\s+([a-z_][a-z0-9_]*)/g)) {
      names.add(match[1]!);
    }
  }
  return [...names].sort();
}

describe("backup coverage", () => {
  it("copies blog activity and leaves sign-in secrets unrestored", () => {
    expect(BACKUP_TABLES).toContain("blog_activity");
    expect(BACKUP_TABLES).toContain("enquiry_follow_ups");
    expect(BACKUP_TABLES).toContain("users");
    expect(BACKUP_TABLES).toContain("accounts");
    for (const table of BACKUP_EXCLUDED_TABLES) {
      expect(BACKUP_TABLES).not.toContain(table);
    }
    expect([...BACKUP_EXCLUDED_TABLES].sort()).toEqual(["dev_magic_links", "sessions", "verification_token"]);
  });

  it("classifies every table created by a migration", () => {
    const known = [...BACKUP_TABLES, ...BACKUP_EXCLUDED_TABLES].sort();
    expect(tablesCreatedByMigrations()).toEqual(known);
  });

  it("refuses a shared source and builds a separate destination name", () => {
    const previous = process.env.RECOVERY_ALLOWED_DB_PATTERN;
    delete process.env.RECOVERY_ALLOWED_DB_PATTERN;
    expect(() => assertRecoverySource("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie")).toThrow(/shared/);
    expect(() => assertRecoverySource("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie_enquiry_test")).toThrow(/enquiry/);
    expect(() => assertRecoverySource("postgresql://postgres:postgres@db.example.com:5432/clinic_genie_rehearsal")).toThrow(/local database/);
    expect(() => assertRecoverySource("postgresql://postgres:postgres@127.0.0.1:54329/clinic_genie_rehearsal")).toThrow(/54329/);
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    expect(() => assertRecoverySource("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie_rehearsal")).toThrow(/production/);
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    expect(assertRecoverySource("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie_rehearsal").database).toBe("clinic_genie_rehearsal");
    expect(recoveryDestinationName("clinic_genie_rehearsal")).toBe("clinic_genie_rehearsal_restore_test");
    expect(() => recoveryDestinationName("clinic_genie_rehearsal_restore_test")).toThrow(/restore destination/);
    expect(() => assertRecoveryDatabaseName("neondb")).toThrow(/shared/);
    if (previous === undefined) delete process.env.RECOVERY_ALLOWED_DB_PATTERN;
    else process.env.RECOVERY_ALLOWED_DB_PATTERN = previous;
  });
});
