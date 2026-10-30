import Link from "next/link";
import { notFound } from "next/navigation";
import { canExport, formatPeriod } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { loadAnalytics, NoWebsites, UnavailableClient } from "@/components/modules/AnalyticsShell";
import { buttonClass } from "@/components/ui/Button";
import { PageHeader, Card, CardHeader } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Table, Td, Th } from "@/components/ui/Table";
import { clientLabel } from "@/lib/client-label";
import { buildBreakdown } from "@/lib/breakdown-report";
import { analyticsSearch } from "@/lib/period-options";
import { breakdownKind, breakdownSection, breakdownTitle } from "@/lib/report-link";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const kind = breakdownKind((await params).kind);
  return { title: kind ? breakdownTitle(kind) : "Report" };
}

export default async function BreakdownReportPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ client?: string; website?: string; range?: string; from?: string; to?: string }> }) {
  const { kind: raw } = await params;
  const kind = breakdownKind(raw);
  if (!kind) notFound();
  const query = await searchParams;
  const access = await requireAccess();
  const { denied, view, rangeId, from, to } = await loadAnalytics(query.client, query.range, query.from, query.to, query.website);
  if (denied) return <UnavailableClient />;
  if (!view) return <NoWebsites />;
  const title = breakdownTitle(kind);
  const report = buildBreakdown(view, kind, title);
  const search = analyticsSearch(view.clientId, rangeId, from, to, view.websiteId ?? undefined);
  const back = `/analytics/${breakdownSection(kind)}?${search}`;
  const download = `/reports/breakdown/${kind}/download?${search}`;
  return (
    <>
      <PageHeader
        title={title}
        eyebrow={<Link href={back} className="text-action hover:underline">{breakdownSection(kind) === "behavior" ? "Behavior" : "Traffic"}</Link>}
        description={`${clientLabel({ name: view.clientName, referenceNumber: view.clientReference })} · ${view.current ? formatPeriod(view.current.start, view.current.end, " to ") : "Period not recorded"}${view.previous ? ` · compared with ${formatPeriod(view.previous.start, view.previous.end, " to ")}` : ""}`}
        action={canExport(access) ? <a className={buttonClass()} href={download}>Download CSV</a> : undefined}
      />
      {!canExport(access) && <div className="mb-4"><Notice tone="neutral">Download is not allowed for this account.</Notice></div>}
      <div className="space-y-4">
        {report.tables.map((table) => (
          <Card key={table.title}>
            <CardHeader title={table.title} description={table.note} />
            <div className="px-5 pb-5">
              {table.rows.length === 0 ? <p className="text-sm text-muted">{table.empty ?? "Not recorded."}</p> : (
                <Table caption={table.title}>
                  <thead>
                    <tr>
                      {table.columns.map((column, index) => <Th key={column} align={index === 0 ? "left" : "right"}>{column}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, rowIndex) => (
                      <tr key={`${table.title}-${rowIndex}`}>
                        {row.map((value, index) => <Td key={`${rowIndex}-${index}`} align={index === 0 ? "left" : "right"}>{value}</Td>)}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
