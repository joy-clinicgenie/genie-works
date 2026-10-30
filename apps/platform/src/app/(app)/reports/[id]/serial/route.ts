import { NextResponse } from "next/server";
import { canAccessClient, getSavedReport, issueReportDownload, recordAudit } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { formatReportSerial, reportDownloadName } from "@/lib/report-csv";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Issues the next serial when a summary is printed or saved as a PDF. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const access = await requireAccess();
  const body = await request.json().catch(() => ({})) as { versionId?: string | null };
  const versionId = typeof body.versionId === "string" && UUID.test(body.versionId) ? body.versionId : null;
  const issued = await staffTx(access, async (db) => {
    const report = await getSavedReport(db, id);
    if (!report || !canAccessClient(access, report.client_id)) return null;
    const version = report.versions.find((item) => item.id === versionId) ?? null;
    const serialNumber = await issueReportDownload(db, {
      reportId: report.id,
      clientId: report.client_id,
      versionNumber: version?.version_number ?? null,
      format: "pdf",
      actorUserId: access.user.id,
    });
    const serial = formatReportSerial(serialNumber);
    await recordAudit(db, { actorType: "staff", actorUserId: access.user.id, action: "saved_report.download", targetType: "saved_report", targetId: report.id, clientId: report.client_id, outcome: "success", metadata: { format: "pdf", versionNumber: version?.version_number ?? null, serial } });
    return { serial, fileName: reportDownloadName(report.client_name, new Date(), serial, report.short_code) };
  });
  if (!issued) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(issued);
}
