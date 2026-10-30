import { resolve } from "node:path";
import { assertRecoverySource, latestBackupFile, restoreTest } from "../src/backup";
import { closePools, getAdminPool } from "../src/client";
import { loadRootEnv, requireEnv } from "../src/env";
import { describeDatabaseTarget } from "../src/migrate";

loadRootEnv();
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
assertRecoverySource(adminUrl);
console.log(describeDatabaseTarget(adminUrl));
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const keep = args.includes("--keep");
const fileArg = args.find((arg) => !arg.startsWith("--"));
const file = fileArg ? resolve(fileArg) : latestBackupFile(resolve(process.cwd().includes("packages/db") ? "../../backups" : "backups"));
if (!file) {
  console.error("No backup file found. Run npm run db:backup first.");
  process.exit(1);
}
try {
  const v = await restoreTest(getAdminPool(), adminUrl, file, { keep, appPassword: process.env.APP_DB_PASSWORD || "cg_app_dev" });
  console.log(`Restore test of ${file}`);
  console.log(`Counts: ${JSON.stringify(v.counts)}`);
  console.log(`Orphans: ${JSON.stringify(v.orphans)}`);
  console.log(`Blog: ${JSON.stringify(v.blog)}`);
  console.log(`Migrations match: ${v.migrationsMatch}`);
  console.log(`Sign-in tables left empty: ${JSON.stringify(v.invalidated)}`);
  console.log(`RLS enabled: ${v.rlsEnabled}`);
  console.log(`Isolation check: ${JSON.stringify(v.isolationCheck)}`);
  if (v.mismatches.length) {
    console.error(`FAILED: ${v.mismatches.join("; ")}`);
    process.exit(1);
  }
  console.log("Restore test PASSED");
} finally {
  await closePools();
}
