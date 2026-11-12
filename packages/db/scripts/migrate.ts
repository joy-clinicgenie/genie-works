import { closePools, getAdminPool } from "../src/client";
import { loadRootEnv, requireEnv } from "../src/env";
import { assertMigrationTarget, describeDatabaseTarget, ensureAppRole, migrationStatus, runMigrations } from "../src/migrate";

loadRootEnv();
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
// Throws before any connection when the target is not allowed (D54).
const place = assertMigrationTarget(adminUrl);
console.log(describeDatabaseTarget(adminUrl));
const pool = getAdminPool();
try {
  const before = await migrationStatus(pool);
  if (before.modified.length > 0) {
    throw new Error(`Refusing: ${before.modified.length} applied migration(s) were modified: ${before.modified.join(", ")}. Add a new migration instead.`);
  }
  console.log(before.pending.length > 0 ? `Pending: ${before.pending.join(", ")}` : "Pending: none");
  if (place === "production") {
    // The reference is an operator's label for the restore point, not a credential.
    console.log(`Production migration. Restore point recorded by the operator: ${(process.env.MIGRATE_BACKUP_REFERENCE ?? "").trim()}`);
    // The application role keeps its current password. Changing it here would cut off the deployed application.
  } else {
    const appPassword = process.env.APP_DB_PASSWORD || "cg_app_dev";
    // A hosted database must not get the documented development password for its application role.
    if (place === "non_production" && (appPassword === "cg_app_dev" || appPassword.length < 24)) {
      throw new Error("Refusing: set APP_DB_PASSWORD to a new random value of at least 24 characters for a hosted database. The development password is public.");
    }
    await ensureAppRole(pool, appPassword);
  }
  const result = await runMigrations(pool, (l) => console.log(l));
  console.log(`Migrations: ${result.applied.length} applied, ${result.skipped.length} already applied.`);
} finally {
  await closePools();
}
