import { canEditClient, listAdsAudits, listAdsChanges, listClients } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card, CardHeader } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { FilterBar, FilterSelect } from "@/components/ui/Filters";
import { AdsChangeTable, AuditTable } from "@/components/modules/AdsList";
import { Notice } from "@/components/ui/Notice";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";
export const metadata = { title: "Google Ads" };

export default async function GoogleAdsPage({ searchParams }: { searchParams: Promise<{ client?: string; status?: string }> }) {
  const access = await requireAccess();
  const { client, status } = await searchParams;
  const data = await staffTx(access, async (db) => ({
    audits: await listAdsAudits(db, { clientId: client || undefined, status: status || undefined }),
    changes: await listAdsChanges(db, { clientId: client || undefined, limit: 50 }),
    clients: await listClients(db),
  }));
  const canCreate = data.clients.some((c) => canEditClient(access, c.id));
  return (
    <>
      <PageHeader title="Google Ads audit and change log" description="Audits with scoped findings and recommendations, and a log of changes staff made with before and after values." action={canCreate ? <><LinkButton href="/google-ads/audits/new" variant="secondary">New audit</LinkButton><LinkButton href="/google-ads/changes/new">Record a change</LinkButton></> : undefined} />
      <Notice tone="neutral">This module records work done in Google Ads. It never changes a live account.</Notice>
      <div className="mt-4">
        <FilterBar>
          <FilterSelect name="client" label="Client" value={client} options={data.clients.map((c) => ({ value: c.id, label: clientLabel(c) }))} />
          <FilterSelect name="status" label="Audit status" value={status} options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }]} />
        </FilterBar>
      </div>
      <Card><CardHeader title="Audits" /><AuditTable audits={data.audits} /></Card>
      <Card className="mt-6"><CardHeader title="Change log" description="Most recent first" /><AdsChangeTable changes={data.changes} /></Card>
    </>
  );
}
