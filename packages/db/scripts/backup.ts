import { join, resolve } from "node:path";
import { assertRecoverySource, writeBackup } from "../src/backup";
import { closePools, getAdminPool } from "../src/client";
import { loadRootEnv, requireEnv } from "../src/env";
import { describeDatabaseTarget } from "../src/migrate";

loadRootEnv();
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
assertRecoverySource(adminUrl);
console.log(describeDatabaseTarget(adminUrl));
const outDir = resolve(process.argv[2] ?? join(process.cwd().includes("packages/db") ? "../../backups" : "backups"));
try {
  const result = await writeBackup(getAdminPool(), outDir);
  console.log(`Backup written: ${result.file}`);
  console.log(JSON.stringify(result.counts));
  console.log(`Report files: ${result.reportArtifacts}`);
} finally {
  await closePools();
}
