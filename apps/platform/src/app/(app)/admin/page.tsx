import { formatDateTime, platformStatus, todaySgt } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Card, CardHeader, Stat } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

export default async function AdminStatusPage() {
  const access = await requireAccess();
  const s = await staffTx(access, (db) => platformStatus(db, todaySgt()));
  const backupOk = s.lastBackup?.outcome === "passed";
  const restoreOk = s.lastRestoreTest?.outcome === "passed";
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 mb-6">
        <Stat label="Active clients" value={s.activeClients} />
        <Stat label="Active staff" value={s.activeStaff} />
        <Stat label="Approvals awaiting decision" value={s.pendingApprovals} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Backup status" description="Shown only from recorded runs. A configured schedule alone never produces a green status." />
          <div className="px-5 pb-5 text-sm space-y-2">
            {s.lastBackup ? (
              <>
                <div><Badge tone={backupOk ? "good" : "bad"}>{backupOk ? "Last backup passed" : "Last backup failed"}</Badge></div>
                <div>Run at {formatDateTime(s.lastBackup.started_at)}{s.lastBackup.finished_at && `, finished ${formatDateTime(s.lastBackup.finished_at)}`}</div>
                <div className="text-muted break-all">Artefact: {s.lastBackup.artefact_ref ?? "none"}</div>
              </>
            ) : <Notice tone="warn" title="No backup recorded">Run <code>npm run db:backup</code>. Status stays unverified until a run is recorded.</Notice>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recovery status" description="A restore into an isolated database with relationship and policy checks." />
          <div className="px-5 pb-5 text-sm space-y-2">
            {s.lastRestoreTest ? (
              <>
                <div><Badge tone={restoreOk ? "good" : "bad"}>{restoreOk ? "Last restore test passed" : "Last restore test failed"}</Badge></div>
                <div>Run at {formatDateTime(s.lastRestoreTest.started_at)} into {s.lastRestoreTest.target}</div>
                <div className="text-muted">{s.lastRestoreTest.notes}</div>
              </>
            ) : <Notice tone="warn" title="Recovery not yet demonstrated">Run <code>npm run db:restore-test</code>. Until then recovery is untested, not failed.</Notice>}
          </div>
        </Card>
      </div>
    </>
  );
}
