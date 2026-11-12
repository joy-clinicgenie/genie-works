/**
 * Guards for local test fixtures. A failed check must throw before any
 * destructive statement runs. No connection string is included in the error text.
 */

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const SIBLING_CLINIC_PORT = "54329";

export function databaseNameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

export function databaseTarget(url: string): { local: boolean; port: string; database: string } {
  const target = parsed(url);
  return {
    local: LOCAL_HOSTS.has(target.hostname),
    port: target.port,
    database: decodeURIComponent(target.pathname.replace(/^\//, "")),
  };
}

/** A shared or unreadable database. Development sign-in shortcuts stay off. */
export function isSharedDatabaseUrl(url: string): boolean {
  if (!url.trim()) return true;
  try {
    const target = databaseTarget(url);
    if (target.database === "neondb" || target.port === SIBLING_CLINIC_PORT) return true;
    return !target.local;
  } catch {
    return true;
  }
}

function parsed(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error("Refusing: the database URL is not valid.");
  }
}

function assertNotProductionEnvironment(): void {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing: this command does not run in production.");
  }
}

/** Local worker and fixture commands. Remote hosts stay refused unless explicitly allowed, and production never is. */
export function assertLocalWorkerDatabase(url: string): void {
  assertNotProductionEnvironment();
  const target = parsed(url);
  if (target.port === SIBLING_CLINIC_PORT) {
    throw new Error("Refusing: port 54329 is the sibling clinic website database.");
  }
  const remoteAllowed = process.env.ANALYTICS_ALLOW_REMOTE_WORKER === "1";
  if (!LOCAL_HOSTS.has(target.hostname) && !remoteAllowed) {
    throw new Error("Refusing: the worker database host is not local. Set ANALYTICS_ALLOW_REMOTE_WORKER=1 only for an approved non-production host.");
  }
}

export const ENQUIRY_FIXTURE_DATABASE = "clinic_genie_enquiry_test";

/** Existing databases. Automated drops and the clean rehearsal must not use these names. */
export const SHARED_DATABASE_NAMES = ["clinic_genie", "clinic_genie_rehearsal", "clinic_genie_enquiry_test", "neondb", "postgres"] as const;

/** One disposable enquiry database per test package, so `npm test` does not share or reset the stored fixture. */
export const SUITE_ENQUIRY_DATABASES = {
  db: "clinic_genie_enquiry_test_suite_db",
  platform: "clinic_genie_enquiry_test_suite_app",
} as const;

export const ISOLATED_REHEARSAL_DATABASE = "clinic_genie_rehearsal_isolated";
export const ISOLATED_REHEARSAL_ENQUIRY_DATABASE = "clinic_genie_enquiry_test_isolated";

export function assertDropTarget(name: string, allowed: readonly string[]): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Refusing: the database name is not a plain identifier.");
  if ((SHARED_DATABASE_NAMES as readonly string[]).includes(name)) throw new Error(`Refusing to drop shared database ${name}.`);
  if (!allowed.includes(name)) throw new Error(`Refusing to drop ${name}: it is not an isolated target.`);
}

function withDatabase(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** The database `npm test` may create and drop. The stored fixture name is refused. */
export function suiteEnquiryFixtureUrl(adminUrl: string, slot: keyof typeof SUITE_ENQUIRY_DATABASES): string {
  assertNotProductionEnvironment();
  const admin = databaseTarget(adminUrl);
  if (!admin.local) throw new Error("Refusing enquiry fixture: the admin host is not local.");
  if (admin.port === SIBLING_CLINIC_PORT) throw new Error("Refusing enquiry fixture: port 54329 is the sibling clinic website database.");
  const database: string = SUITE_ENQUIRY_DATABASES[slot];
  assertDropTarget(database, [database]);
  if (database === ENQUIRY_FIXTURE_DATABASE) throw new Error("Refusing enquiry fixture: the suite target is the shared fixture.");
  const url = withDatabase(adminUrl, database);
  const checked = assertEnquiryFixtureUrl(url);
  if (checked.database !== database) throw new Error("Refusing enquiry fixture: the suite target changed.");
  return url;
}

/**
 * Targets for `npm run db:rehearse`. Names are checked before the caller opens a
 * maintenance connection or drops anything. Shared databases are not targets.
 */
export function rehearsalTargets(adminUrl: string): { platformUrl: string; enquiryUrl: string; platform: string; enquiry: string } {
  assertNotProductionEnvironment();
  const admin = databaseTarget(adminUrl);
  if (!admin.local) throw new Error("Refusing rehearsal: the admin host is not local.");
  if (admin.port === SIBLING_CLINIC_PORT) throw new Error("Refusing rehearsal: port 54329 is the sibling clinic website database.");
  const platform = ISOLATED_REHEARSAL_DATABASE;
  const enquiry = ISOLATED_REHEARSAL_ENQUIRY_DATABASE;
  assertDropTarget(platform, [platform]);
  assertDropTarget(enquiry, [enquiry]);
  if (!platform.includes("clinic_genie") || !platform.includes("rehearsal") || !platform.includes("isolated")) {
    throw new Error("Refusing rehearsal: the platform database is not an isolated rehearsal target.");
  }
  if (!enquiry.includes("enquiry") || !enquiry.includes("test") || !enquiry.includes("isolated")) {
    throw new Error("Refusing rehearsal: the enquiry database is not an isolated fixture target.");
  }
  const platformUrl = withDatabase(adminUrl, platform);
  const enquiryUrl = withDatabase(adminUrl, enquiry);
  const pattern = process.env.SEED_ALLOWED_DB_PATTERN || "clinic_genie";
  if (!platform.includes(pattern)) throw new Error(`Refusing rehearsal: database name does not contain "${pattern}".`);
  const checked = assertEnquiryFixtureUrl(enquiryUrl);
  if (checked.database !== enquiry || databaseTarget(platformUrl).database !== platform) {
    throw new Error("Refusing rehearsal: a target changed after it was checked.");
  }
  if (admin.database === platform || admin.database === enquiry) {
    throw new Error("Refusing rehearsal: the admin connection is a database this command replaces.");
  }
  return { platformUrl, enquiryUrl, platform, enquiry };
}

/** Enquiry fixture resets and seeds. Stricter than the platform seed guard. */
export function assertEnquiryFixtureUrl(url: string): { host: string; port: string; database: string } {
  assertNotProductionEnvironment();
  const target = parsed(url);
  const database = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!LOCAL_HOSTS.has(target.hostname)) {
    throw new Error("Refusing enquiry fixture: the host is not local.");
  }
  if (target.port === SIBLING_CLINIC_PORT) {
    throw new Error("Refusing enquiry fixture: port 54329 is the sibling clinic website database.");
  }
  if (!/^[a-z0-9_]+$/.test(database)) {
    throw new Error("Refusing enquiry fixture: the database name is not a plain identifier.");
  }
  if (database === "clinic_genie") {
    throw new Error("Refusing enquiry fixture: that database is the platform database.");
  }
  if (!database.includes("enquiry") || !database.includes("test")) {
    throw new Error("Refusing enquiry fixture: the database name must contain enquiry and test.");
  }
  for (const name of ["DATABASE_URL", "DATABASE_ADMIN_URL"]) {
    const other = process.env[name];
    if (other && sameDatabase(other, url)) {
      throw new Error(`Refusing enquiry fixture: the target is the same database as ${name}.`);
    }
  }
  return { host: target.hostname, port: target.port, database };
}

/** The live Clinic Genie website enquiry database. Fixture commands never use it. */
export const ENQUIRY_STAFF_ROLE = "cg_enquiry_staff";

/**
 * Application read of ENQUIRY_DATABASE_URL.
 * The live database is remote, named clinic_genie_enquiry_staging, and uses the staff role.
 * A local database whose name contains enquiry and test remains the fixture and is refused in production.
 */
export function assertEnquirySourceUrl(url: string): { host: string; port: string; database: string; live: boolean } {
  const target = parsed(url);
  const database = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (target.port === SIBLING_CLINIC_PORT) {
    throw new Error("Refusing enquiry source: port 54329 is the sibling clinic website database.");
  }
  if (!/^[a-z0-9_]+$/.test(database)) {
    throw new Error("Refusing enquiry source: the database name is not a plain identifier.");
  }
  if (database === ENQUIRY_STAGING_DATABASE) {
    if (LOCAL_HOSTS.has(target.hostname)) {
      throw new Error("Refusing enquiry source: the live enquiry database is not local.");
    }
    const user = decodeURIComponent(target.username);
    if (user !== ENQUIRY_STAFF_ROLE) {
      throw new Error("Refusing enquiry source: Genie Works uses the staff role on the live enquiry database.");
    }
    for (const name of ["DATABASE_URL", "DATABASE_ADMIN_URL"]) {
      const other = process.env[name];
      if (other && sameDatabase(other, url)) {
        throw new Error(`Refusing enquiry source: the target is the same database as ${name}.`);
      }
    }
    return { host: "remote", port: target.port || "default", database, live: true };
  }
  const fixture = assertEnquiryFixtureUrl(url);
  return { host: fixture.host, port: fixture.port, database: fixture.database, live: false };
}

function sameDatabase(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.hostname === b.hostname && a.port === b.port && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

/** Fixture mode must not call a provider host. Live sandbox mode does not set this flag. */
export function assertFixtureFetch(url: string): void {
  if (process.env.ANALYTICS_FIXTURE_MODE !== "1") return;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("Fixture mode refused a provider URL that could not be read.");
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error("Fixture mode refused a non-local provider host. Unset ANALYTICS_FIXTURE_MODE only for an approved non-production sandbox.");
  }
}

/** Owner connection for creating clinic_genie_enquiry_staging. It is not an application credential. */
export const ENQUIRY_STAGING_DATABASE = "clinic_genie_enquiry_staging";

const REFUSED_STAGING_DATABASES = new Set(["neondb", "clinic_genie", "clinic_genie_rehearsal", "clinic_genie_enquiry_test", "postgres"]);

/** Allows only the remote staging enquiry database. Fixture, platform and sibling databases are refused before a connection. */
export function assertStagingEnquiryAdminUrl(url: string): { host: string; port: string; database: string } {
  const target = databaseTarget(url);
  if (target.local) throw new Error("Refusing staging enquiry setup: the host is local.");
  if (target.port === SIBLING_CLINIC_PORT) throw new Error("Refusing staging enquiry setup: port 54329 is the sibling clinic website database.");
  if (REFUSED_STAGING_DATABASES.has(target.database)) throw new Error(`Refusing staging enquiry setup: ${target.database} is not the staging enquiry database.`);
  if (target.database !== ENQUIRY_STAGING_DATABASE) throw new Error("Refusing staging enquiry setup: the database must be clinic_genie_enquiry_staging.");
  for (const name of ["DATABASE_URL", "DATABASE_ADMIN_URL", "ENQUIRY_DATABASE_URL"]) {
    const other = process.env[name];
    if (other && sameDatabase(other, url)) throw new Error(`Refusing staging enquiry setup: the target is the same database as ${name}.`);
  }
  return { host: target.local ? target.database : "remote", port: target.port || "default", database: target.database };
}

export function enquiryFixtureUrlFromAdmin(adminUrl: string): string {
  const target = new URL(adminUrl);
  target.pathname = `/${ENQUIRY_FIXTURE_DATABASE}`;
  return target.toString();
}

export function maintenanceUrl(adminUrl: string): string {
  const target = new URL(adminUrl);
  target.pathname = "/postgres";
  return target.toString();
}

/** The real Wix Forms API. Nothing but an explicitly approved local mock may replace it. */
export const WIX_API_BASE_URL = "https://www.wixapis.com";

/**
 * Resolves the Wix Forms API origin. The default is always the real provider.
 *
 * `FORMS_WIX_BASE_URL` redirects Wix reads at a local mock so enquiry pages can be measured without
 * contacting a production Wix account. Three things must all hold, or the override is refused:
 *
 * 1. The mock host is local.
 * 2. `VERCEL_ENV` is unset, so nothing deployed can use it whatever its value.
 * 3. `DATABASE_URL` is a local database, which is the same "local rehearsal" test
 *    `localRehearsalDatabase` already applies to development sign-in links.
 *
 * NODE_ENV is deliberately not the gate: `next start` sets it to production for a local production
 * build, which is exactly the build a baseline needs to measure. The database check is the stronger
 * signal, because a process pointed at the shared database is refused even when it looks local.
 */
export function resolveWixApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const override = env.FORMS_WIX_BASE_URL?.trim();
  if (!override) return WIX_API_BASE_URL;
  if (env.VERCEL_ENV) {
    throw new Error("Refusing FORMS_WIX_BASE_URL: a Wix mock is not available in a hosted environment.");
  }
  if (isSharedDatabaseUrl(env.DATABASE_URL ?? "")) {
    throw new Error("Refusing FORMS_WIX_BASE_URL: a Wix mock is only available alongside a local database.");
  }
  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    throw new Error("Refusing FORMS_WIX_BASE_URL: the value is not a valid URL.");
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("Refusing FORMS_WIX_BASE_URL: the mock host is not local.");
  }
  return override.replace(/\/$/, "");
}
