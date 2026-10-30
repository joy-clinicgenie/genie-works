import Link from "next/link";
import type { ClaimRow } from "@clinic-genie/db";
import { formatDateTime } from "@clinic-genie/db";
import { Badge, CLAIM_TONE, label } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";

export function ClaimTable({ claims, showClient = true }: { claims: ClaimRow[]; showClient?: boolean }) {
  return (
    <Table caption="HCSA claims">
      <thead><tr><Th>Claim</Th>{showClient && <Th>Client</Th>}<Th>Status</Th><Th>Wording</Th><Th align="right">Sources</Th><Th align="right">Open reviews</Th><Th>Updated</Th></tr></thead>
      <tbody>
        {claims.map((c) => (
          <tr key={c.id} className="hover:bg-surface-muted/60">
            <Td><Link href={`/medical-review/${c.id}`} className="font-medium text-action hover:underline">{c.claim_summary}</Link>{c.location && <div className="text-xs text-muted">{c.location}</div>}</Td>
            {showClient && <Td><Link href={`/clients/${c.client_id}`} className="hover:underline">{c.client_name}</Link></Td>}
            <Td><Badge tone={CLAIM_TONE[c.status]}>{label(c.status)}</Badge></Td>
            <Td>v{c.current_version}</Td>
            <Td align="right">{c.source_count === 0 ? <span className="text-warn font-semibold">0</span> : c.source_count}</Td>
            <Td align="right">{c.open_review_count}</Td>
            <Td className="whitespace-nowrap text-muted">{formatDateTime(c.updated_at)}</Td>
          </tr>
        ))}
        {claims.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">No claims recorded.</td></tr>}
      </tbody>
    </Table>
  );
}
