/** Local embedded Postgres defaults from .env.example. Not a hosted credential. */
const HOST = "127.0.0.1";
const PORT = "54339";

export const PLATFORM_DB = "clinic_genie_b08";
export const ENQUIRY_DB = "clinic_genie_enquiry_test_b08";
export const PROD_ORIGIN = "http://127.0.0.1:3408";
export const DEV_ORIGIN = "http://127.0.0.1:3409";

const RESERVED = new Set(["clinic_genie", "clinic_genie_rehearsal", "clinic_genie_enquiry_test", "neondb", "postgres"]);

export function assertBatchDatabase(name: string): void {
  if (!/^[a-z0-9_]+$/.test(name) || RESERVED.has(name) || !name.includes("b08")) {
    throw new Error(`Refusing database name ${name}.`);
  }
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
