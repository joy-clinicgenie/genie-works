import { NextResponse } from "next/server";
import { canExport } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { loadAnalytics } from "@/components/modules/AnalyticsShell";
import { clientLabel } from "@/lib/client-label";
import { breakdownCsv, buildBreakdown } from "@/lib/breakdown-report";
import { breakdownKind, breakdownTitle } from "@/lib/report-link";
import { reportDownloadDisposition, reportDownloadName } from "@/lib/report-csv";

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const kind = breakdownKind((await params).kind);
  if (!kind) return new NextResponse("Not found", { status: 404 });
  const access = await requireAccess();
  if (!canExport(access)) return new NextResponse("Not allowed", { status: 403 });
  const url = new URL(request.url);
  const { denied, view } = await loadAnalytics(url.searchParams.get("client") ?? undefined, url.searchParams.get("range") ?? undefined, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("website") ?? undefined);
  if (denied) return new NextResponse("Not allowed", { status: 403 });
  if (!view) return new NextResponse("Not found", { status: 404 });
  const title = breakdownTitle(kind);
  const report = buildBreakdown(view, kind, title);
  const fileName = `${reportDownloadName(view.clientName, new Date(), undefined, view.clientReference)} ${title}.csv`;
  return new NextResponse(breakdownCsv(report, view.clientReference, clientLabel({ name: view.clientName, referenceNumber: view.clientReference })), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": reportDownloadDisposition(fileName),
    },
  });
}
