import { NextResponse } from "next/server";
import { analyticsProviderAllowed, canAccessClient, canExport, reportCsv, publishedReport } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireAccess();
  if (!canExport(access)) return new NextResponse("Not allowed", { status: 403 });
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client") ?? "";
  const websiteId = url.searchParams.get("website") ?? "";
  const template = url.searchParams.get("template") ?? "";
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  if (!canAccessClient(access, clientId) || !/^[a-z0-9._-]{3,80}$/i.test(template) || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return new NextResponse("Unavailable", { status: 404 });
  }
  // GA4 reports are only exported for the analytics clients (D61); Search Console stays open for SEO.
  const report = await staffTx(access, async (db) =>
    (await analyticsProviderAllowed(db, clientId, template.split(".")[0] ?? ""))
      ? publishedReport(db, { clientId, websiteId, templateKey: template, start, end })
      : null);
  if (!report) return new NextResponse("Unavailable", { status: 404 });
  const body = reportCsv(report, template);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="analytics-${template}-${start}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
