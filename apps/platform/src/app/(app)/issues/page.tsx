import { canEditClient, listClients, listIssues, type IssueStatus } from "@clinic-genie/db";
import { ISSUE_SEVERITIES, ISSUE_STATUSES } from "@clinic-genie/contracts";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { FilterBar, FilterSelect } from "@/components/ui/Filters";
import { IssueTable } from "@/components/modules/IssueList";
import { label } from "@/components/ui/Badge";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";
export const metadata = { title: "Issues" };

export default async function IssuesPage({ searchParams }: { searchParams: Promise<{ client?: string; status?: string; severity?: string }> }) {
  const access = await requireAccess();
  const { client, status, severity } = await searchParams;
  const data = await staffTx(access, async (db) => ({
    issues: await listIssues(db, { clientId: client || undefined, statuses: status ? [status as IssueStatus] : undefined, severity: severity || undefined }),
    clients: await listClients(db),
  }));
  const canCreate = data.clients.some((c) => canEditClient(access, c.id)) || access.user.platform_role === "reviewer";
  return (
    <>
      <PageHeader title="Issue register" description="Problems, their investigation, resolution and independent verification, with evidence kept under the right client." action={canCreate ? <LinkButton href="/issues/new">Open an issue</LinkButton> : undefined} />
      <FilterBar>
        <FilterSelect name="client" label="Client" value={client} options={data.clients.map((c) => ({ value: c.id, label: clientLabel(c) }))} />
        <FilterSelect name="status" label="Status" value={status} options={ISSUE_STATUSES.map((s) => ({ value: s, label: label(s) }))} />
        <FilterSelect name="severity" label="Severity" value={severity} options={ISSUE_SEVERITIES.map((s) => ({ value: s, label: label(s) }))} />
      </FilterBar>
      <Card><IssueTable issues={data.issues} /></Card>
    </>
  );
}
