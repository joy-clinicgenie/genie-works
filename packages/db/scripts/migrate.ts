import { closePools, getAdminPool } from "../src/client";
import { loadRootEnv, requireEnv } from "../src/env";
import { assertMigrationTarget, describeDatabaseTarget, ensureAppRole, runMigrations } from "../src/migrate";

loadRootEnv();
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
assertMigrationTarget(adminUrl);
console.log(describeDatabaseTarget(adminUrl));
const pool = getAdminPool();
try {
  await ensureAppRole(pool, process.env.APP_DB_PASSWORD || "cg_app_dev");
  const result = await runMigrations(pool, (l) => console.log(l));
  console.log(`Migrations: ${result.applied.length} applied, ${result.skipped.length} already applied.`);
} finally {
  await closePools();
}
