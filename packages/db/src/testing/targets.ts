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
