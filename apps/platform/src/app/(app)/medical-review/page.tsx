import { canEditClient, listClaims, listClients } from "@clinic-genie/db";
import { CLAIM_STATUSES } from "@clinic-genie/contracts";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { FilterBar, FilterSelect } from "@/components/ui/Filters";
import { ClaimTable } from "@/components/modules/ClaimList";
import { label } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";
export const metadata = { title: "HCSA" };

export default async function MedicalReviewPage({ searchParams }: { searchParams: Promise<{ client?: string; status?: string; mine?: string }> }) {
  const access = await requireAccess();
  const { client, status, mine } = await searchParams;
  const data = await staffTx(access, async (db) => ({
    claims: await listClaims(db, { clientId: client || undefined, status: status || undefined, reviewerUserId: mine === "1" ? access.user.id : undefined }),
    clients: await listClients(db),
  }));
  const canCreate = data.clients.some((c) => canEditClient(access, c.id));
  return (
    <>
      <PageHeader title="HCSA" description="Claims, their wording versions, reviewer assignments, sources and decisions." action={canCreate ? <LinkButton href="/medical-review/new">New claim</LinkButton> : undefined} />
      <Notice tone="warn" title="Workflow status only">An approved status here records that an assigned reviewer accepted the wording with at least one source. It is not regulatory certification or legal clearance.</Notice>
      <div className="mt-4">
        <FilterBar>
          <FilterSelect name="client" label="Client" value={client} options={data.clients.map((c) => ({ value: c.id, label: clientLabel(c) }))} />
          <FilterSelect name="status" label="Status" value={status} options={CLAIM_STATUSES.map((s) => ({ value: s, label: label(s) }))} />
          <FilterSelect name="mine" label="Reviews" value={mine} allLabel="All claims" options={[{ value: "1", label: "Assigned to me" }]} />
        </FilterBar>
      </div>
      <Card><ClaimTable claims={data.claims} /></Card>
    </>
  );
}
