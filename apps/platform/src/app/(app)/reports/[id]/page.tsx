import Link from "next/link";
import { notFound } from "next/navigation";
import { isReportTemplate } from "@clinic-genie/contracts";
import { canEditClient, canExport, composeReport, formatDateTime, formatPeriod, gatherReportFacts, getSavedReport, listReportWebsites } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card, CardHeader } from "@/components/ui/Card";
import { buttonClass, LinkButton } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { ReportDocument } from "@/components/modules/ReportDocument";
import { DuplicateReport, SavedReportEditor } from "@/components/modules/SavedReportEditor";
import { ReportBuilder } from "@/components/modules/ReportBuilder";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SavedReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { version: versionId } = await searchParams;
  const access = await requireAccess();
  const loaded = await staffTx(access, async (db) => {
    const report = await getSavedReport(db, id);
    if (!report) return null;
    const facts = await gatherReportFacts(db, report);
    const composition = report.checklist.length
      ? await composeReport(db, {
          clientId: report.client_id,
          websiteId: report.website_id,
          periodStart: report.period_start,
          periodEnd: report.period_end,
          comparisonStart: report.comparison_start,
          comparisonEnd: report.comparison_end,
          items: report.checklist,
        })
      : null;
    const websites = await listReportWebsites(db, [report.client_id]);
    return { report, facts, composition, websites };
  });
  if (!loaded) notFound();
  const { report, facts, composition, websites } = loaded;
  const built = report.checklist.length > 0;
  const version = report.versions.find((item) => item.id === versionId) ?? null;
  const preview = version
    ? {
        name: version.name,
        periodStart: version.period_start,
        periodEnd: version.period_end,
        comparisonStart: version.comparison_start,
        comparisonEnd: version.comparison_end,
        sections: version.sections,
        figures: version.figures,
        summary: version.summary,
        observations: version.observations,
        actionsTaken: version.actions_taken,
        nextSteps: version.next_steps,
        dataSources: version.data_sources ? version.data_sources.split(", ").filter(Boolean) : [],
        dataSourcesNote: version.data_sources_note,
        lastRefresh: version.last_refresh,
        missingConnections: version.missing_connection_keys,
        missingNote: version.missing_connections,
        limitationNote: version.limitation_note,
        measurementLimitations: version.measurement_limitations,
        blocks: version.blocks,
        websiteLabel: version.website_label,
        reportType: version.report_type,
        preparedBy: version.creator_name,
        caption: `Version ${version.version_number}, retained for client review on ${formatDateTime(version.created_at)}. Figures are the values saved with this version.`,
      }
    : {
        name: report.name,
        periodStart: report.period_start,
        periodEnd: report.period_end,
        comparisonStart: report.comparison_start,
        comparisonEnd: report.comparison_end,
        sections: report.sections,
        figures: facts.figures,
        summary: report.summary,
        observations: report.observations,
        actionsTaken: report.actions_taken,
        nextSteps: report.next_steps,
        dataSources: facts.dataSources,
        dataSourcesNote: report.data_sources_note,
        lastRefresh: facts.lastRefresh,
        missingConnections: facts.missingConnections,
        missingNote: report.missing_connections,
        limitationNote: composition?.limitationNote ?? facts.limitationNote,
        measurementLimitations: report.measurement_limitations,
        blocks: composition?.blocks,
        websiteLabel: report.website_label,
        reportType: built ? report.report_type : null,
        preparedBy: report.creator_name,
        caption: built ? "Review the recorded figures. Empty cells are not stored, and they are not zero." : "Review the last saved wording with the latest recorded figures before downloading.",
      };
  const canEdit = canEditClient(access, report.client_id);
  const canDownload = canExport(access);
  const versionQuery = version ? `?version=${version.id}` : "";
  const downloadHref = `/reports/${report.id}/download${versionQuery}`;
  return (
    <>
      <PageHeader
        title={report.name}
        eyebrow={<Link href="/reports" className="text-action hover:underline">Report library</Link>}
        description={`${clientLabel({ name: report.client_name, reference_number: report.reference_number })} · ${formatPeriod(report.period_start, report.period_end, " to ")} · ${report.creator_name}, ${formatDateTime(report.created_at)}`}
        action={
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {canDownload && <a className={buttonClass()} href={downloadHref}>Download CSV</a>}
            <LinkButton href={`/reports/${report.id}/print${versionQuery}`} variant="secondary">{built ? "Generate PDF" : "Open summary"}</LinkButton>
            {canEdit && <DuplicateReport reportId={report.id} />}
          </div>
        }
      />
      <Card>
        <CardHeader title="Report preview" description={built ? "A CSV downloads the checklist. Generate PDF opens the summary so the browser can save a PDF." : "A CSV downloads the tables and commentary. Open the summary and use the browser print dialog to save a PDF."} />
        <div className="px-5 pb-5">
          {!canDownload && <div className="mb-4"><Notice tone="neutral">Download is not allowed for this account.</Notice></div>}
          <ReportDocument clientName={clientLabel({ name: report.client_name, reference_number: report.reference_number })} {...preview} />
        </div>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Saved versions" description="Each save retains the version used for a client review. Later edits do not change an earlier version." />
        <ul className="divide-y divide-line/80 px-5 pb-3">
          {report.versions.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span>
                <span className="font-medium">Version {item.version_number}</span>
                <span className="block text-xs text-muted">{item.creator_name} · {formatDateTime(item.created_at)} · For client review</span>
              </span>
              <Link href={`/reports/${report.id}?version=${item.id}`} className="font-medium text-action hover:underline">Open this version</Link>
            </li>
          ))}
          {report.versions.length === 0 && <li className="py-3 text-muted">No version has been retained.</li>}
        </ul>
      </Card>
      <div className="mt-4">
        {built ? (
          <ReportBuilder
            key={report.updated_at.toISOString()}
            readOnly={!canEdit}
            preparedBy={report.creator_name}
            clients={[{ id: report.client_id, label: clientLabel({ name: report.client_name, reference_number: report.reference_number }) }]}
            websites={websites.map((item) => ({ id: item.id, clientId: item.client_id, label: item.url ? `${item.name} (${item.url})` : item.name }))}
            draft={{
              id: report.id,
              clientId: report.client_id,
              websiteId: report.website_id ?? "",
              reportType: report.report_type,
              templateKey: isReportTemplate(report.template_key) ? report.template_key : "monthly",
              name: report.name,
              periodStart: report.period_start,
              periodEnd: report.period_end,
              comparisonStart: report.comparison_start ?? "",
              comparisonEnd: report.comparison_end ?? "",
              items: report.checklist,
            }}
          />
        ) : (
          <SavedReportEditor
            key={report.updated_at.toISOString()}
            readOnly={!canEdit}
            clients={[]}
            draft={{
              id: report.id,
              clientId: report.client_id,
              name: report.name,
              periodStart: report.period_start,
              periodEnd: report.period_end,
              comparisonStart: report.comparison_start ?? "",
              comparisonEnd: report.comparison_end ?? "",
              sections: report.sections,
              summary: report.summary ?? "",
              observations: report.observations ?? "",
              actionsTaken: report.actions_taken ?? "",
              nextSteps: report.next_steps ?? "",
              dataSourcesNote: report.data_sources_note ?? "",
              missingConnections: report.missing_connections ?? "",
              measurementLimitations: report.measurement_limitations ?? "",
            }}
          />
        )}
      </div>
    </>
  );
}
