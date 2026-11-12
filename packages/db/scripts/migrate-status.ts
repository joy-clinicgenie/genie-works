/** Lists applied and pending migrations. Read-only: one read-only transaction, nothing is written. Safe on any database. */
import { closePools, getAdminPool } from "../src/client";
import { loadRootEnv, requireEnv } from "../src/env";
import { describeDatabaseTarget, migrationStatus } from "../src/migrate";

loadRootEnv();
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
console.log(describeDatabaseTarget(adminUrl));
try {
  const status = await migrationStatus(getAdminPool());
  if (!status.initialised) console.log("This database has never been migrated.");
  console.log(`Applied: ${status.applied.length}`);
  console.log(status.pending.length > 0 ? `Pending (${status.pending.length}): ${status.pending.join(", ")}` : "Pending: none");
  if (status.modified.length > 0) console.log(`MODIFIED after being applied (${status.modified.length}): ${status.modified.join(", ")}`);
  if (status.unknown.length > 0) console.log(`Applied but not in this checkout (${status.unknown.length}): ${status.unknown.join(", ")}`);
  if (status.modified.length > 0) process.exitCode = 1;
} finally {
  await closePools();
}
