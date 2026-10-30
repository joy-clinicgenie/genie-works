import Link from "next/link";
import type { AdsAuditRow, AdsChangeRow } from "@clinic-genie/db";
import { formatDate, formatPeriod } from "@clinic-genie/db";
import { Badge, label } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";

export function AuditTable({ audits, showClient = true }: { audits: AdsAuditRow[]; showClient?: boolean }) {
  return (
    <Table caption="Google Ads audits">
      <thead><tr><Th>Audit</Th>{showClient && <Th>Client</Th>}<Th>Review period</Th><Th>Auditor</Th><Th align="right">Findings</Th><Th>Status</Th></tr></thead>
      <tbody>
        {audits.map((a) => (
          <tr key={a.id} className="hover:bg-surface-muted/60">
            <Td><Link href={`/google-ads/audits/${a.id}`} className="font-medium text-action hover:underline">{a.title}</Link><div className="text-xs text-muted">{a.scope}</div></Td>
            {showClient && <Td><Link href={`/clients/${a.client_id}`} className="hover:underline">{a.client_name}</Link></Td>}
            <Td className="whitespace-nowrap">{formatPeriod(a.period_start, a.period_end, " to ")}</Td>
            <Td>{a.auditor_name}</Td>
            <Td align="right">{a.finding_count} <span className="text-muted">({a.open_finding_count} open)</span></Td>
            <Td><Badge tone={a.status === "open" ? "info" : "neutral"}>{label(a.status)}</Badge></Td>
          </tr>
        ))}
        {audits.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-muted">No audits recorded.</td></tr>}
      </tbody>
    </Table>
  );
}

export function AdsChangeTable({ changes, showClient = true }: { changes: AdsChangeRow[]; showClient?: boolean }) {
  return (
    <Table caption="Google Ads change log">
      <thead><tr><Th>Change</Th>{showClient && <Th>Client</Th>}<Th>Where</Th><Th>Implemented</Th><Th>Responsible</Th><Th>Approval</Th><Th>Verification</Th></tr></thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.id} className="hover:bg-surface-muted/60">
            <Td><Link href={`/google-ads/changes/${c.id}`} className="font-medium text-action hover:underline">{c.description}</Link><div className="text-xs text-muted">{c.reason}</div></Td>
            {showClient && <Td><Link href={`/clients/${c.client_id}`} className="hover:underline">{c.client_name}</Link></Td>}
            <Td>{c.scope}</Td>
            <Td className="whitespace-nowrap">{formatDate(c.implemented_on)}</Td>
            <Td>{c.responsible_name}</Td>
            <Td>{c.approval_id ? <Link href={`/approvals/${c.approval_id}`} className="text-action hover:underline">{c.approval_title}</Link> : <span className="text-muted">None</span>}</Td>
            <Td>{c.verification_on ? <Badge tone="good">Verified {formatDate(c.verification_on)}</Badge> : <Badge tone="warn">Not verified</Badge>}</Td>
          </tr>
        ))}
        {changes.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">No changes recorded.</td></tr>}
      </tbody>
    </Table>
  );
}
