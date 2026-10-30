import { NextResponse } from "next/server";
import { canAccessClient, canExport, composeReport, formatDateTime, gatherReportFacts, getSavedReport, issueReportDownload, recordAudit } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { formatReportSerial, reportCsv, reportDownloadDisposition, reportDownloadName } from "@/lib/report-csv";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Not found", { status: 404 });
  const access = await requireAccess();
  if (!canExport(access)) return new NextResponse("Not allowed", { status: 403 });
  const versionId = new URL(request.url).searchParams.get("version");
  const file = await staffTx(access, async (db) => {
    const report = await getSavedReport(db, id);
    if (!report || !canAccessClient(access, report.client_id)) return null;
    const version = report.versions.find((item) => item.id === versionId) ?? null;
    const facts = version
      ? {
          figures: version.figures,
          dataSources: version.data_sources ? version.data_sources.split(", ").filter(Boolean) : [],
          lastRefresh: version.last_refresh ? formatDateTime(version.last_refresh) : "Not recorded",
          missingConnections: version.missing_connection_keys,
          limitationNote: [version.limitation_note, version.measurement_limitations].filter(Boolean).join(" "),
          name: version.name,
          periodStart: version.period_start,
          periodEnd: version.period_end,
          comparisonStart: version.comparison_start,
          comparisonEnd: version.comparison_end,
          sections: version.sections,
          summary: version.summary,
          observations: version.observations,
          actionsTaken: version.actions_taken,
          nextSteps: version.next_steps,
          blocks: version.blocks,
        }
      : await (async () => {
          const live = await gatherReportFacts(db, report);
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
          return {
            figures: live.figures,
            dataSources: live.dataSources,
            lastRefresh: live.lastRefresh ? formatDateTime(live.lastRefresh) : "Not recorded",
            missingConnections: live.missingConnections,
            limitationNote: [live.limitationNote, report.measurement_limitations].filter(Boolean).join(" "),
            name: report.name,
            periodStart: report.period_start,
            periodEnd: report.period_end,
            comparisonStart: report.comparison_start,
            comparisonEnd: report.comparison_end,
            sections: report.sections,
            summary: report.summary,
            observations: report.observations,
            actionsTaken: report.actions_taken,
            nextSteps: report.next_steps,
            blocks: composition?.blocks,
          };
        })();
    const serialNumber = await issueReportDownload(db, { reportId: report.id, clientId: report.client_id, versionNumber: version?.version_number ?? null, format: "csv", actorUserId: access.user.id });
    const serial = formatReportSerial(serialNumber);
    await recordAudit(db, { actorType: "staff", actorUserId: access.user.id, action: "saved_report.download", targetType: "saved_report", targetId: report.id, clientId: report.client_id, outcome: "success", metadata: { format: "csv", versionNumber: version?.version_number ?? null, serial } });
    const fileName = `${reportDownloadName(report.client_name, new Date(), serial, report.short_code)}.csv`;
    return { csv: reportCsv({ ...facts, clientName: report.client_name, clinicCode: report.short_code, serial }), fileName };
  });
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(file.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": reportDownloadDisposition(file.fileName),
    },
  });
}
