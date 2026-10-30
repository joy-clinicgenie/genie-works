import Link from "next/link";
import { notFound } from "next/navigation";
import { canEditClient, formatDate, formatPeriod, getAdsAudit, listAccountReferences } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card, CardHeader, KeyValue } from "@/components/ui/Card";
import { Badge, SEVERITY_TONE, label } from "@/components/ui/Badge";
import { AuditForm, FindingForm } from "@/components/modules/AdsForms";
import { AdsChangeTable } from "@/components/modules/AdsList";
import { closeAuditAction, findingStatusAction } from "@/app/actions/ads";
import { Button, LinkButton } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const access = await requireAccess();
  const { id } = await params;
  const { edit } = await searchParams;
  const data = await staffTx(access, async (db) => {
    const audit = await getAdsAudit(db, id);
    if (!audit) return null;
    return { audit, references: (await listAccountReferences(db, audit.client_id)).filter((r) => r.kind === "google_ads") };
  });
  if (!data) notFound();
  const { audit } = data;
  const canEdit = canEditClient(access, audit.client_id);
  const open = audit.status === "open";
  return (
    <>
      <PageHeader eyebrow={<Link href={`/clients/${audit.client_id}/google-ads`} className="hover:underline">{audit.client_name}</Link>} title={audit.title} description={<span className="flex gap-2 items-center"><Badge tone={open ? "info" : "neutral"}>{label(audit.status)}</Badge><span className="text-muted">Review period {formatPeriod(audit.period_start, audit.period_end, " to ")}</span></span>}
        action={canEdit && open ? <><LinkButton href={`/google-ads/changes/new?client=${audit.client_id}&audit=${audit.id}`} variant="secondary">Record a change</LinkButton><form action={closeAuditAction}><input type="hidden" name="auditId" value={id} /><Button type="submit" variant="ghost">Close audit</Button></form></> : undefined} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="p-5">
            <KeyValue items={[{ label: "Scope", value: audit.scope }, { label: "Auditor", value: audit.auditor_name }, { label: "Account reference", value: audit.account_label }, { label: "Closed", value: audit.closed_at ? formatDate(audit.closed_at.toISOString().slice(0, 10)) : null }]} />
            {audit.summary && <p className="text-sm mt-4 whitespace-pre-wrap">{audit.summary}</p>}
            {canEdit && open && <Link href={edit ? `/google-ads/audits/${id}` : `/google-ads/audits/${id}?edit=1`} className="text-sm text-action hover:underline mt-4 inline-block">{edit ? "Close editor" : "Edit audit"}</Link>}
          </Card>
          {canEdit && open && edit && <Card className="p-5"><AuditForm clientId={audit.client_id} references={data.references} values={audit} /></Card>}
          <Card>
            <CardHeader title="Findings" description={`${audit.open_finding_count} open of ${audit.finding_count}`} />
            <ul className="divide-y divide-line">
              {audit.findings.length === 0 && <li className="px-5 py-3 text-sm text-muted">No findings yet.</li>}
              {audit.findings.map((f) => (
                <li key={f.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap gap-2 items-center"><Badge tone={SEVERITY_TONE[f.severity]}>{label(f.severity)}</Badge><Badge>{label(f.area)}</Badge><Badge tone={f.status === "open" ? "warn" : f.status === "implemented" ? "good" : "neutral"}>{label(f.status)}</Badge></div>
                  <div className="mt-1">{f.finding}</div>
                  {f.recommendation && <div className="text-muted mt-1">Recommendation: {f.recommendation}</div>}
                  {canEdit && open && f.status === "open" && (
                    <div className="mt-2 flex gap-2">
                      <Link href={`/google-ads/changes/new?client=${audit.client_id}&audit=${audit.id}&finding=${f.id}`} className="text-action text-xs hover:underline">Record the change made</Link>
                      <form action={findingStatusAction}><input type="hidden" name="auditId" value={id} /><input type="hidden" name="findingId" value={f.id} /><input type="hidden" name="status" value="dismissed" /><button type="submit" className="text-xs text-muted hover:underline cursor-pointer">Dismiss</button></form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Card><CardHeader title="Changes linked to this audit" /><AdsChangeTable changes={audit.changes} showClient={false} /></Card>
        </div>
        <div>{canEdit && open && <Card><CardHeader title="Add a finding" /><div className="px-5 pb-5"><FindingForm auditId={id} /></div></Card>}</div>
      </div>
    </>
  );
}
