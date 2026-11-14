import { NextResponse } from "next/server";
import { canExport } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { loadBreakdownSource } from "@/lib/load-analytics-board";
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
  const param = (name: string) => url.searchParams.get(name) ?? undefined;
  const { denied, view, facts, previous } = await loadBreakdownSource(access, { client: param("client"), range: param("range"), from: param("from"), to: param("to"), website: param("website") });
  if (denied) return new NextResponse("Not allowed", { status: 403 });
  if (!view) return new NextResponse("Not found", { status: 404 });
  const title = breakdownTitle(kind);
  const report = buildBreakdown(view, kind, title, facts, previous);
  const fileName = `${reportDownloadName(view.clientName, new Date(), undefined, view.clientReference)} ${title}.csv`;
  return new NextResponse(breakdownCsv(report, view.clientReference, clientLabel({ name: view.clientName, referenceNumber: view.clientReference })), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": reportDownloadDisposition(fileName),
    },
  });
}
