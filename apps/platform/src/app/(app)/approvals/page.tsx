import { listApprovals, listClients, type ApprovalStatus } from "@clinic-genie/db";
import { APPROVAL_STATUSES } from "@clinic-genie/contracts";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { FilterBar, FilterSelect } from "@/components/ui/Filters";
import { ApprovalTable } from "@/components/modules/ApprovalList";
import { label } from "@/components/ui/Badge";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ status?: string; client?: string }> }) {
  const access = await requireAccess();
  const { status, client } = await searchParams;
  const data = await staffTx(access, async (db) => ({
    approvals: await listApprovals(db, { clientId: client || undefined, statuses: status && (APPROVAL_STATUSES as readonly string[]).includes(status) ? [status as ApprovalStatus] : undefined }),
    clients: await listClients(db),
  }));
  return (
    <>
      <PageHeader title="Approvals" description="Requests, authorised decisions and their history. Decisions are never edited; a revised decision is a new linked record." action={access.user.platform_role !== "read_only" && access.user.platform_role !== "reviewer" ? <LinkButton href="/approvals/new">New request</LinkButton> : undefined} />
      <FilterBar>
        <FilterSelect name="client" label="Client" value={client} options={data.clients.map((c) => ({ value: c.id, label: clientLabel(c) }))} />
        <FilterSelect name="status" label="Status" value={status} options={APPROVAL_STATUSES.map((s) => ({ value: s, label: label(s) }))} />
      </FilterBar>
      <Card><ApprovalTable approvals={data.approvals} /></Card>
    </>
  );
}
