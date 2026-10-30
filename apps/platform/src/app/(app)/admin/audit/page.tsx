import { formatDateTime, listAuditEvents, listClients } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";
import { FilterBar, FilterSelect } from "@/components/ui/Filters";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit history" };

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const access = await requireAccess();
  const { client } = await searchParams;
  const data = await staffTx(access, async (db) => ({ events: await listAuditEvents(db, { clientId: client || undefined, limit: 300 }), clients: await listClients(db, { includeArchived: true }) }));
  return (
    <>
      <p className="mb-4 text-sm text-ink-soft">Permission changes, recipient changes, form views, exports and other privileged actions. The log does not copy names, email addresses or messages.</p>
      <FilterBar>
        <FilterSelect name="client" label="Client" value={client} options={data.clients.map((c) => ({ value: c.id, label: clientLabel(c) }))} />
      </FilterBar>
      <Card>
        <Table caption="Security audit events">
          <thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Target</Th><Th>Client</Th><Th>Outcome</Th><Th>Details</Th></tr></thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(e.occurred_at)}</Td>
                <Td>{e.actor_name ?? e.actor_type}</Td>
                <Td><code className="text-xs">{e.action}</code></Td>
                <Td className="text-xs text-muted">{e.target_type}{e.target_id ? ` ${e.target_id.slice(0, 8)}` : ""}</Td>
                <Td>{e.client_name ?? ""}</Td>
                <Td><Badge tone={e.outcome === "success" ? "good" : e.outcome === "denied" ? "bad" : "warn"}>{e.outcome}</Badge></Td>
                <Td className="text-xs text-muted break-all">{Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : ""}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
