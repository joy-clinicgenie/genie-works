import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { assertMigrationDatabase, databasePlace } from "./database-environment";
import { removeImportedDirectoryClients } from "./rehearsal";
import { todaySgt } from "./services/dates";
import { databaseTarget } from "./testing/targets";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/** Creates or updates the application role. Needs the owner connection. */
export async function ensureAppRole(pool: pg.Pool, password: string): Promise<void> {
  const { rows } = await pool.query("select 1 from pg_roles where rolname = 'cg_app'");
  const escaped = password.replace(/'/g, "''");
  if (rows.length === 0) {
    await pool.query(`create role cg_app login nobypassrls password '${escaped}'`);
  } else {
    await pool.query(`alter role cg_app with login nobypassrls password '${escaped}'`);
  }
}

/**
 * Applies each `packages/db/migrations/*.sql` file once, in filename order.
 * `schema_migrations` records the full filename, not the numeric prefix.
 * `0034_client_public_profiles.sql` and `0034_leads_forms.sql` both stay applied.
 * Do not rename or rewrite either file: a changed checksum is refused, and a
 * new name would be treated as a migration that has not run.
 */
export async function runMigrations(pool: pg.Pool, log: (line: string) => void = () => {}): Promise<MigrationResult> {
  await pool.query(`create table if not exists schema_migrations (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const { rows } = await pool.query<{ name: string; checksum: string }>("select name, checksum from schema_migrations");
  const done = new Map(rows.map((r) => [r.name, r.checksum]));
  const result: MigrationResult = { applied: [], skipped: [] };
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = done.get(file);
    if (existing) {
      if (existing !== checksum) {
        throw new Error(`Migration ${file} was modified after it was applied. Add a new migration instead.`);
      }
      result.skipped.push(file);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [file, checksum]);
      await client.query("commit");
      result.applied.push(file);
      log(`applied ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  if (shouldStripImportedDirectory(result.applied)) {
    const removed = await removeImportedDirectoryClients(pool);
    log(`fresh setup removed ${removed} imported directory clients`);
  }
  return result;
}

/** Historical directory rows are removed only while this run is creating the schema. */
export function shouldStripImportedDirectory(applied: string[]): boolean {
  return applied.includes("0001_foundation.sql");
}

export function describeDatabaseTarget(url: string): string {
  try {
    const target = databaseTarget(url);
    const place = databasePlace(url);
    const port = target.port || "default";
    const database = target.database || "(none)";
    return `database target: ${place} port ${port} database ${database}`;
  } catch {
    return "database target: unreadable";
  }
}

export function databaseNameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function assertNotProduction(): void {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to run in production.");
  }
}

/** Refuses seeds, resets and restore tests against a remote, sibling or production database. */
export function assertSafeTarget(url: string): void {
  assertNotProduction();
  const target = databaseTarget(url);
  if (target.port === "54329") {
    throw new Error("Refusing: port 54329 is the sibling clinic website database.");
  }
  if (!target.local) {
    throw new Error("Refusing: destructive commands require a local database.");
  }
  const pattern = process.env.SEED_ALLOWED_DB_PATTERN || "clinic_genie";
  if (!target.database.includes(pattern)) {
    throw new Error(`Refusing to touch database "${target.database}": name does not contain "${pattern}".`);
  }
}

/**
 * Refuses an accidental migration against a shared database (D54). A remote host needs
 * MIGRATE_ALLOW_REMOTE=1 and a listing in NONPRODUCTION_DATABASE_HOSTS. The production database
 * needs a dated confirmation and a named restore point. Migrations never run inside a deployment.
 */
export function assertMigrationTarget(url: string, now: Date = new Date()): "local" | "non_production" | "production" {
  assertNotProduction();
  const target = databaseTarget(url);
  if (target.port === "54329") {
    throw new Error("Refusing: port 54329 is the sibling clinic website database.");
  }
  return assertMigrationDatabase(url, { database: target.database, today: todaySgt(now) });
}

export interface MigrationStatus {
  /** False when the database has never been migrated. */
  initialised: boolean;
  applied: string[];
  pending: string[];
  /** Applied files whose content no longer matches. `db:migrate` refuses these. */
  modified: string[];
  /** Recorded as applied but missing from this checkout. */
  unknown: string[];
}

/** What `db:migrate` would do. Runs in a read-only transaction and writes nothing. */
export async function migrationStatus(pool: pg.Pool): Promise<MigrationStatus> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  let recorded: Array<{ name: string; checksum: string }> = [];
  let initialised = false;
  try {
    await client.query("begin transaction read only");
    const exists = await client.query<{ present: boolean }>("select to_regclass('public.schema_migrations') is not null as present");
    initialised = Boolean(exists.rows[0]?.present);
    if (initialised) {
      recorded = (await client.query<{ name: string; checksum: string }>("select name, checksum from schema_migrations")).rows;
    }
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
  const done = new Map(recorded.map((row) => [row.name, row.checksum]));
  const status: MigrationStatus = { initialised, applied: [], pending: [], modified: [], unknown: [] };
  for (const file of files) {
    const existing = done.get(file);
    if (!existing) {
      status.pending.push(file);
      continue;
    }
    const checksum = createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, file), "utf8")).digest("hex");
    (existing === checksum ? status.applied : status.modified).push(file);
  }
  status.unknown = recorded.map((row) => row.name).filter((name) => !files.includes(name)).sort();
  return status;
}
