/**
 * Read-only audit of how analytics connections are tied to properties and websites (Phase 2.3).
 *
 *   npm run analytics:audit -w @clinic-genie/db
 *
 * Reports counts and short hashes only: no property id, site URL, token or client name. Runs in a read-only
 * transaction. `storedValues` counts dimension values already stored that the current privacy rules would withhold or
 * that still carry a query string (written before 13 Nov 2026); it prints no value. A database that is not on this machine also needs ANALYTICS_AUDIT_REMOTE_CONFIRM set to its host name.
 */
import { closePools, SERVICE, withContext } from "../src/client";
import { loadRootEnv } from "../src/env";
import { associationAudit } from "../src/analytics/validation";
import { scanStoredValues } from "../src/analytics/privacy-scan";

loadRootEnv();
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
if (!local && process.env.ANALYTICS_AUDIT_REMOTE_CONFIRM !== url.hostname) {
  console.error(`Refusing: this database is not on this machine. Set ANALYTICS_AUDIT_REMOTE_CONFIRM to its host name (${url.hostname}) to read it.`);
  process.exit(2);
}
console.error(`database target: ${local ? `local port ${url.port}` : `remote host ${url.hostname}`}`);
try {
  const result = await withContext(SERVICE, async (db) => {
    await db.query("set transaction read only");
    return { associations: await associationAudit(db), storedValues: await scanStoredValues(db) };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await closePools();
}
