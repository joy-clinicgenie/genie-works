/** Local embedded Postgres defaults from .env.example. Not a hosted credential. */
const HOST = "127.0.0.1";
const PORT = "54339";

/**
 * Isolated suites. Each owns its own databases and ports, so two suites never share state.
 * `b08` is the original batch-08 journey suite. `perf` is the signed-in performance baseline suite.
 * Add a suite by adding a marker and a free port pair; the guards below do the rest.
 */
export const SUITES = {
  b08: { marker: "b08", platformDb: "clinic_genie_b08", enquiryDb: "clinic_genie_enquiry_test_b08", prodPort: 3408, devPort: 3409 },
  perf: { marker: "perf_baseline", platformDb: "clinic_genie_perf_baseline", enquiryDb: "clinic_genie_enquiry_test_perf_baseline", prodPort: 3418, devPort: 3419 },
} as const;

export type SuiteName = keyof typeof SUITES;

export function isSuiteName(value: string | undefined): value is SuiteName {
  return value === "b08" || value === "perf";
}

export function suiteName(value: string | undefined, fallback: SuiteName = "b08"): SuiteName {
  return isSuiteName(value) ? value : fallback;
}

export interface SuiteTargets {
  suite: SuiteName;
  marker: string;
  platformDb: string;
  enquiryDb: string;
  prodPort: number;
  devPort: number;
  prodOrigin: string;
  devOrigin: string;
}

export function suiteTargets(suite: SuiteName): SuiteTargets {
  const spec = SUITES[suite];
  return {
    suite,
    marker: spec.marker,
    platformDb: spec.platformDb,
    enquiryDb: spec.enquiryDb,
    prodPort: spec.prodPort,
    devPort: spec.devPort,
    prodOrigin: `http://${HOST}:${spec.prodPort}`,
    devOrigin: `http://${HOST}:${spec.devPort}`,
  };
}

/** Every database an isolated suite is allowed to create, drop and seed. */
export function suiteDatabases(): string[] {
  return Object.values(SUITES).flatMap((spec) => [spec.platformDb, spec.enquiryDb]);
}

const RESERVED = new Set([
  "clinic_genie",
  "clinic_genie_rehearsal",
  "clinic_genie_enquiry_test",
  "clinic_genie_enquiry_staging",
  "neondb",
  "postgres",
]);

/**
 * Refuses anything that is not one of the isolated suite databases. A suite marker alone is not
 * enough: the name has to be on the list above, so a typo cannot reach a shared database.
 */
export function assertBatchDatabase(name: string): void {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Refusing database name ${name}.`);
  if (RESERVED.has(name)) throw new Error(`Refusing shared database ${name}.`);
  if (!suiteDatabases().includes(name)) throw new Error(`Refusing database ${name}: it is not an isolated suite database.`);
}

export function adminUrl(database: string): string {
  assertBatchDatabase(database);
  return `postgresql://postgres:postgres@${HOST}:${PORT}/${database}`;
}

export function appUrl(database: string): string {
  assertBatchDatabase(database);
  return `postgresql://cg_app:cg_app_dev@${HOST}:${PORT}/${database}`;
}

export function maintenanceUrl(): string {
  return `postgresql://postgres:postgres@${HOST}:${PORT}/postgres`;
}

// Batch-08 names kept so the existing journey specs and handover commands are unchanged.
export const PLATFORM_DB = SUITES.b08.platformDb;
export const ENQUIRY_DB = SUITES.b08.enquiryDb;
export const PROD_ORIGIN = `http://${HOST}:${SUITES.b08.prodPort}`;
export const DEV_ORIGIN = `http://${HOST}:${SUITES.b08.devPort}`;
