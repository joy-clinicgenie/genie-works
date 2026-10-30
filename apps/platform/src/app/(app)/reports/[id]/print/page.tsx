import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { composeReport, gatherReportFacts, getSavedReport } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { ReportDocument } from "@/components/modules/ReportDocument";
import { PrintReport } from "@/components/modules/PrintReport";
import { clientLabel } from "@/lib/client-label";
import { reportDownloadName } from "@/lib/report-csv";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Report summary" };
  const access = await requireAccess();
  const report = await staffTx(access, async (db) => getSavedReport(db, id));
  if (!report) return { title: "Report summary" };
  return { title: { absolute: reportDownloadName(report.client_name, new Date(), undefined, report.short_code) } };
}

export default async function ReportPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
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
    return { report, facts, composition };
  });
  if (!loaded) notFound();
  const { report, facts, composition } = loaded;
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
        caption: `Version ${version.version_number}, retained for client review.`,
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
        reportType: report.checklist.length ? report.report_type : null,
        preparedBy: report.creator_name,
      };
  return (
    <article className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-muted">Use the browser print dialog and choose Save as PDF. This platform does not attach a PDF file. A serial number is added when you print or save.</p>
        <PrintReport reportId={report.id} versionId={version?.id} />
      </div>
      <p id="report-serial" className="mb-3 hidden text-sm font-medium" />
      <ReportDocument clientName={clientLabel({ name: report.client_name, reference_number: report.reference_number })} {...preview} />
    </article>
  );
}
