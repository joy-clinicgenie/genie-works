import { formatDateTime, listBackupRuns } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, label } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";
import { Notice } from "@/components/ui/Notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backups and recovery" };

export default async function AdminBackupsPage() {
  const access = await requireAccess();
  const runs = await staffTx(access, (db) => listBackupRuns(db, 50));
  return (
    <>
      <Notice tone="neutral" title="How this works">Backups are logical exports written by <code>npm run db:backup</code>. Restore tests load that export into a separate local database, verify record counts, relationships, blog activity and migrations, then record the outcome here. Auth.js sessions, verification tokens and development magic links are left empty so an old sign-in does not come back. Managed hosting adds its own physical backups, which are not claimed on this page.</Notice>
      <Card className="mt-4">
        <CardHeader title="Recorded runs" />
        <Table caption="Backup and restore runs">
          <thead><tr><Th>Kind</Th><Th>Started</Th><Th>Finished</Th><Th>Outcome</Th><Th>Target</Th><Th>Records</Th><Th>Notes</Th></tr></thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">No runs recorded yet.</td></tr>}
            {runs.map((r) => (
              <tr key={r.id}>
                <Td>{label(r.kind)}</Td>
                <Td className="whitespace-nowrap">{formatDateTime(r.started_at)}</Td>
                <Td className="whitespace-nowrap">{r.finished_at ? formatDateTime(r.finished_at) : ""}</Td>
                <Td><Badge tone={r.outcome === "passed" ? "good" : r.outcome === "failed" ? "bad" : "warn"}>{label(r.outcome)}</Badge></Td>
                <Td className="text-xs break-all">{r.target}</Td>
                <Td className="text-xs text-muted">{Object.entries(r.record_counts).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(", ")}</Td>
                <Td className="text-xs text-muted">{r.notes}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
