/**
 * Analytics queue recovery (Phase 2.2).
 *
 *   npm run analytics:recover -w @clinic-genie/db             Dry run. Reads only, in a read-only transaction.
 *   npm run analytics:recover -w @clinic-genie/db -- --apply  Cancels the listed obsolete queued jobs and recovers expired leases.
 *
 * --apply needs ANALYTICS_RECOVERY_APPROVAL set to the approval token the dry run printed. The token
 * names the exact set of jobs, so it stops working the moment the queue changes.
 *
 * Any database that is not on this machine also needs ANALYTICS_RECOVERY_REMOTE_CONFIRM set to its host
 * name (for the dry run as well), and --apply needs ANALYTICS_RECOVERY_BACKUP_REFERENCE naming the
 * restore point taken first. Nothing is deleted, no published report is touched, failed jobs are left as they are.
 */
import { closePools, SERVICE, withContext } from "../src/client";
import { loadRootEnv } from "../src/env";
import { applyQueueRecovery, queueRecoveryReport, QueueRecoveryApprovalError } from "../src/analytics/queue-recovery";

loadRootEnv();

const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
const apply = process.argv.includes("--apply");

if (!local && process.env.ANALYTICS_RECOVERY_REMOTE_CONFIRM !== url.hostname) {
  console.error(`Refusing: this database is not on this machine. Set ANALYTICS_RECOVERY_REMOTE_CONFIRM to its host name (${url.hostname}) to read it.`);
  process.exit(2);
}
if (apply && !local && !process.env.ANALYTICS_RECOVERY_BACKUP_REFERENCE) {
  console.error("Refusing: --apply on a remote database needs ANALYTICS_RECOVERY_BACKUP_REFERENCE naming the restore point taken first.");
  process.exit(2);
}
console.error(`database target: ${local ? `local port ${url.port} database ${url.pathname.slice(1)}` : `remote host ${url.hostname} database ${url.pathname.slice(1)}`}`);

try {
  if (!apply) {
    const report = await withContext(SERVICE, async (db) => {
      await db.query("set transaction read only");
      return queueRecoveryReport(db, new Date());
    });
    console.log(JSON.stringify(report, null, 2));
    console.error(`Dry run only. To apply, review the report and set ANALYTICS_RECOVERY_APPROVAL=${report.approvalToken}`);
  } else {
    const outcome = await withContext(SERVICE, (db) => applyQueueRecovery(db, new Date(), process.env.ANALYTICS_RECOVERY_APPROVAL ?? ""));
    console.log(JSON.stringify(outcome, null, 2));
  }
} catch (error) {
  if (error instanceof QueueRecoveryApprovalError) {
    console.error(error.message);
    process.exitCode = 3;
  } else {
    throw error;
  }
} finally {
  await closePools();
}
