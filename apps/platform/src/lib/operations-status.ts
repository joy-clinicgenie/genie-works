import { canManageUsers, platformStatus, platformSyncHealth, todaySgt, type AccessProfile, type PlatformSyncHealth } from "@clinic-genie/db";
import { staffTx } from "@/lib/db";
import { enquiryConnection, notificationAttention } from "@/lib/form-submissions";
import { assembleOperationsReport, type OperationsReport } from "@/lib/operations-readiness";

export function operationsAudience(role: string | null | undefined): "unauthenticated" | "forbidden" | "allowed" {
  if (!role) return "unauthenticated";
  return role === "admin" ? "allowed" : "forbidden";
}

export async function loadOperationsReport(access: AccessProfile): Promise<OperationsReport> {
  if (!canManageUsers(access) || operationsAudience(access.user.platform_role) !== "allowed") {
    throw new Error("Operations status is limited to an administrator.");
  }
  const enquiry = await enquiryConnection();
  const notifications = enquiry.reachable && !enquiry.refused ? await notificationAttention(null) : { connected: false as const };
  let sync: PlatformSyncHealth | null = null;
  let backupOutcome: string | null = null;
  let restoreOutcome: string | null = null;
  try {
    const status = await staffTx(access, async (db) => {
      const [queue, platform] = await Promise.all([platformSyncHealth(db), platformStatus(db, todaySgt())]);
      return { queue, platform };
    });
    sync = status.queue;
    backupOutcome = status.platform.lastBackup?.outcome ?? null;
    restoreOutcome = status.platform.lastRestoreTest?.outcome ?? null;
  } catch {
    sync = null;
  }
  return assembleOperationsReport({
    env: process.env,
    enquiry,
    failedNotifications: notifications.connected ? notifications.failed : null,
    sync,
    backupOutcome,
    restoreOutcome,
  });
}
