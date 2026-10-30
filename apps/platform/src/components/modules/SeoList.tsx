import Link from "next/link";
import type { SeoPageRow } from "@clinic-genie/db";
import { formatDate } from "@clinic-genie/db";
import { Badge, CONTENT_TONE, FLAG_TONE, label } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";

export function SeoPageTable({ pages, today, showClient = true, emptyMessage = "No pages mapped yet." }: { pages: SeoPageRow[]; today: string; showClient?: boolean; emptyMessage?: string }) {
  return (
    <Table caption="SEO page mapping">
      <thead>
        <tr>
          <Th>Page</Th>
          {showClient && <Th>Client</Th>}
          <Th>Primary keyword</Th>
          <Th>Intent</Th>
          <Th>Content</Th>
          <Th>Mapping flag</Th>
          <Th>Next review</Th>
          <Th align="right">Changes</Th>
        </tr>
      </thead>
      <tbody>
        {pages.map((p) => (
          <tr key={p.id} className="hover:bg-surface-muted/60">
            <Td>
              <Link href={`/seo/pages/${p.id}`} className="font-medium text-action hover:underline break-all">{p.page_path}</Link>
              {p.page_title && <div className="text-xs text-muted">{p.page_title}</div>}
            </Td>
            {showClient && <Td><Link href={`/clients/${p.client_id}`} className="hover:underline">{p.client_name}</Link></Td>}
            <Td>{p.primary_keyword ?? <span className="text-muted">Not set</span>}{p.secondary_keywords.length > 0 && <div className="text-xs text-muted">+{p.secondary_keywords.length} secondary</div>}</Td>
            <Td>{p.search_intent ? label(p.search_intent) : <span className="text-muted">Not set</span>}</Td>
            <Td><Badge tone={CONTENT_TONE[p.content_status]}>{label(p.content_status)}</Badge></Td>
            <Td>{p.mapping_flag === "none" ? <span className="text-muted">None</span> : <Badge tone={FLAG_TONE[p.mapping_flag]}>{label(p.mapping_flag)}</Badge>}</Td>
            <Td className="whitespace-nowrap">{p.next_review_on ? <>{formatDate(p.next_review_on)} {p.next_review_on < today && <Badge tone="warn" className="ml-1">Review due</Badge>}</> : <span className="text-muted">Not set</span>}</Td>
            <Td align="right">{p.change_count}</Td>
          </tr>
        ))}
        {pages.length === 0 && <tr><td colSpan={showClient ? 8 : 7} className="px-3 py-6 text-center text-sm text-muted">{emptyMessage}</td></tr>}
      </tbody>
    </Table>
  );
}
