/**
 * Which database a process may use (D54).
 *
 * Development, preview and production each have their own database. These checks stop a test
 * run, a development worker or a migration from reaching the production database by accident.
 * A failed check throws before a connection opens. No error text includes a connection string,
 * a host name or a credential.
 */
import { createHash } from "node:crypto";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * SHA-256 of the production database endpoint label: the first label of the host name,
 * without a "-pooler" suffix. The host name itself is not written here.
 * `PRODUCTION_DATABASE_HOSTS` adds further hosts without a code change.
 */
const PROTECTED_ENDPOINT_FINGERPRINTS: ReadonlySet<string> = new Set([
  "a2b61b60752a14d386c07c8c2686a10e1ce792197c3e59e592af7b19a0d02bbc",
]);

type Env = Record<string, string | undefined>;

export type RuntimeEnvironment = "production" | "preview" | "test" | "development";

/** A test run is never production, whatever else is set. Only a Vercel production deployment is. */
export function runtimeEnvironment(env: Env = process.env): RuntimeEnvironment {
  if (env.VITEST) return "test";
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "preview";
  if (env.NODE_ENV === "test") return "test";
  return "development";
}

function hostnameOf(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host) throw new Error("empty");
    return host;
  } catch {
    throw new Error("Refusing: the database URL is not valid.");
  }
}

/** Pooled and direct connections to one endpoint share a label. */
function endpointLabel(hostname: string): string {
  return (hostname.split(".")[0] ?? "").replace(/-pooler$/, "");
}

/** Host name with the pooler suffix removed, so both forms of one endpoint compare equal. */
function normalisedHost(hostname: string): string {
  const [first, ...rest] = hostname.trim().toLowerCase().split(".");
  return [(first ?? "").replace(/-pooler$/, ""), ...rest].join(".");
}

export function endpointFingerprint(hostname: string): string {
  return createHash("sha256").update(endpointLabel(hostname.trim().toLowerCase())).digest("hex");
}

function listed(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => normalisedHost(item)).filter(Boolean);
}

export interface DatabaseEndpoint {
  local: boolean;
  /** True for the production database endpoint. */
  production: boolean;
  /** True when the exact host is listed in NONPRODUCTION_DATABASE_HOSTS and is not production. */
  approvedNonProduction: boolean;
}

export function databaseEndpoint(url: string, env: Env = process.env): DatabaseEndpoint {
  const hostname = hostnameOf(url);
  const local = LOCAL_HOSTS.has(hostname);
  const host = normalisedHost(hostname);
  const production = !local && (
    PROTECTED_ENDPOINT_FINGERPRINTS.has(endpointFingerprint(hostname))
    || listed(env.PRODUCTION_DATABASE_HOSTS).includes(host)
  );
  const approvedNonProduction = !local && !production && listed(env.NONPRODUCTION_DATABASE_HOSTS).includes(host);
  return { local, production, approvedNonProduction };
}

export function isProductionDatabaseUrl(url: string, env: Env = process.env): boolean {
  try {
    return databaseEndpoint(url, env).production;
  } catch {
    return false;
  }
}

/** Tests use a local database, or a host named in NONPRODUCTION_DATABASE_HOSTS. Never production. */
export function assertTestDatabase(url: string, env: Env = process.env): void {
  const target = databaseEndpoint(url, env);
  if (target.production) {
    throw new Error("Refusing: tests never run against the production database. Point DATABASE_URL and DATABASE_ADMIN_URL at the local database.");
  }
  if (!target.local && !target.approvedNonProduction) {
    throw new Error("Refusing: the test database host is not local. Use the local database, or list an approved non-production host in NONPRODUCTION_DATABASE_HOSTS.");
  }
}

/**
 * The analytics worker writes provider data. Only the production deployment runs it against the
 * production database. A development process needs a local database, or an explicitly allowed
 * and listed non-production host.
 */
export function assertWorkerDatabase(url: string, env: Env = process.env): void {
  const runtime = runtimeEnvironment(env);
  if (runtime === "production") return;
  const target = databaseEndpoint(url, env);
  if (target.production) {
    throw new Error("Refusing: only the production deployment runs the analytics worker against the production database.");
  }
  if (target.local) return;
  if (runtime === "preview") return;
  if (runtime === "test") {
    assertTestDatabase(url, env);
    return;
  }
  if (env.ANALYTICS_ALLOW_REMOTE_WORKER !== "1" || !target.approvedNonProduction) {
    throw new Error("Refusing: the worker database host is not local. Set ANALYTICS_ALLOW_REMOTE_WORKER=1 and list the approved non-production host in NONPRODUCTION_DATABASE_HOSTS.");
  }
}

/**
 * Where `db:migrate` may run.
 * - Local: always.
 * - Remote, not production: MIGRATE_ALLOW_REMOTE=1 and the host listed in NONPRODUCTION_DATABASE_HOSTS.
 * - Production: MIGRATE_PRODUCTION_CONFIRM must equal "<today, Asia/Singapore>:<database name>" and
 *   MIGRATE_BACKUP_REFERENCE must name the restore point taken first. A dated value cannot be
 *   left in a `.env` file and keep working.
 */
export function assertMigrationDatabase(url: string, input: { database: string; today: string }, env: Env = process.env): "local" | "non_production" | "production" {
  const target = databaseEndpoint(url, env);
  if (target.local) return "local";
  if (target.production) {
    const expected = `${input.today}:${input.database}`;
    if ((env.MIGRATE_PRODUCTION_CONFIRM ?? "").trim() !== expected) {
      throw new Error("Refusing: this is the production database. Follow the production migration procedure in docs/DEPLOYMENT.md, then set MIGRATE_PRODUCTION_CONFIRM to today's Asia/Singapore date, a colon and the database name.");
    }
    if ((env.MIGRATE_BACKUP_REFERENCE ?? "").trim().length < 8) {
      throw new Error("Refusing: a production migration needs MIGRATE_BACKUP_REFERENCE, the name of the restore point or backup branch taken before this run.");
    }
    return "production";
  }
  if (env.MIGRATE_ALLOW_REMOTE !== "1" || !target.approvedNonProduction) {
    throw new Error("Refusing: migration target is not local. Set MIGRATE_ALLOW_REMOTE=1 and list the approved non-production host in NONPRODUCTION_DATABASE_HOSTS.");
  }
  return "non_production";
}

export const PRODUCTION_DATABASE_WARNING =
  "WARNING: this process is not the production deployment, but it is connected to the production database. Writes here change live data. Point DATABASE_URL at the local or preview database (docs/ENVIRONMENT.md).";

let warned = false;

/** For tests only. */
export function resetProductionDatabaseWarning(): void {
  warned = false;
}

/**
 * Called when a connection pool is created.
 * - Test run: the test rules apply, for the application and the owner connection alike.
 * - Development or preview on the production database: one warning. With
 *   DEV_PRODUCTION_DATABASE_ACCESS=refuse the application connection is refused instead.
 *   The owner connection is left to the migration, seed and backup guards.
 */
export function assertProcessDatabase(url: string, role: "app" | "admin", env: Env = process.env, warn: (line: string) => void = (line) => console.warn(line)): void {
  const runtime = runtimeEnvironment(env);
  if (runtime === "production") return;
  if (runtime === "test") {
    assertTestDatabase(url, env);
    return;
  }
  if (!isProductionDatabaseUrl(url, env)) return;
  if (role === "app" && env.DEV_PRODUCTION_DATABASE_ACCESS?.trim().toLowerCase() === "refuse") {
    throw new Error("Refusing: a development or preview process may not use the production database (DEV_PRODUCTION_DATABASE_ACCESS=refuse).");
  }
  if (!warned) {
    warned = true;
    warn(PRODUCTION_DATABASE_WARNING);
  }
}

/** "local", "production" or "remote", for a log line. Never the host name. */
export function databasePlace(url: string, env: Env = process.env): "local" | "production" | "approved non-production" | "remote" | "unreadable" {
  try {
    const target = databaseEndpoint(url, env);
    if (target.local) return "local";
    if (target.production) return "production";
    return target.approvedNonProduction ? "approved non-production" : "remote";
  } catch {
    return "unreadable";
  }
}
