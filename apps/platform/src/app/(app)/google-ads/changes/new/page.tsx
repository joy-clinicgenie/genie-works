import { redirect } from "next/navigation";
import { canEditClient, getAdsAudit, listActiveStaff, listAdsAudits, listApprovals, listClients } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { AdsChangeForm } from "@/components/modules/AdsForms";
import { Field, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record a Google Ads change" };

export default async function NewAdsChangePage({ searchParams }: { searchParams: Promise<{ client?: string; audit?: string; finding?: string }> }) {
  const access = await requireAccess();
  const { client, audit, finding } = await searchParams;
  const data = await staffTx(access, async (db) => {
    const clients = (await listClients(db)).filter((c) => canEditClient(access, c.id));
    if (!client) return { clients, audits: [], findings: [], approvals: [], staff: [] };
    const audits = await listAdsAudits(db, { clientId: client });
    type AuditDetail = NonNullable<Awaited<ReturnType<typeof getAdsAudit>>>;
    const findings: AuditDetail["findings"] = [];
    for (const item of audits) {
      const detail = await getAdsAudit(db, item.id);
      if (detail) findings.push(...detail.findings);
    }
    return { clients, audits, findings, approvals: await listApprovals(db, { clientId: client, statuses: ["approved"] }), staff: (await listActiveStaff(db)).filter((s) => s.platform_role !== "read_only") };
  });
  if (data.clients.length === 0) redirect("/google-ads");
  const chosen = data.clients.find((c) => c.id === client);
  return (
    <>
      <PageHeader title="Record a Google Ads change" description="Keep the before and after values, the reason, who did it and any approval it rests on." />
      <Card className="p-6 max-w-3xl">
        {!chosen ? (
          <form method="get" className="space-y-4">
            <Field label="Client" htmlFor="client" required>
              <Select id="client" name="client" defaultValue="" required>
                <option value="" disabled>Choose a client</option>
                {data.clients.map((c) => <option key={c.id} value={c.id}>{clientLabel(c)}</option>)}
              </Select>
            </Field>
            <Button type="submit" variant="secondary">Continue</Button>
          </form>
        ) : (
          <>
            <p className="text-sm mb-4">Client: <strong>{clientLabel(chosen)}</strong> <a href="/google-ads/changes/new" className="text-action underline ml-2">change</a></p>
            <AdsChangeForm clientId={chosen.id} audits={data.audits} findings={data.findings} approvals={data.approvals} staff={data.staff} defaultAuditId={audit} defaultFindingId={finding} actorId={access.user.id} />
          </>
        )}
      </Card>
    </>
  );
}
