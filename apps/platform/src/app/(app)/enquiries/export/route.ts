import { NextResponse } from "next/server";
import { canExport, listFormWebsites, recordAudit } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import {
  canSearchEnquiryPerson,
  enquiryCsv,
  enquiryWindow,
  listEnquiryBoard,
  notificationFilter,
  submissionClinicScope,
  submissionFormKey,
  submissionStatus,
  submissionWebsiteKey,
} from "@/lib/form-submissions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireAccess();
  if (!canExport(access)) return new NextResponse("Not allowed", { status: 403 });
  const url = new URL(request.url);
  const scope = submissionClinicScope(access);
  const clinic = url.searchParams.get("clinic") ?? undefined;
  if (clinic && scope !== null && !scope.includes(clinic)) return new NextResponse("Not allowed", { status: 403 });
  const window = enquiryWindow(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
  const personAllowed = canSearchEnquiryPerson(access);
  const contact = url.searchParams.get("details") === "1";
  const filters = {
    clinicId: clinic && /^[a-z0-9-]{1,64}$/.test(clinic) ? clinic : undefined,
    websiteKey: submissionWebsiteKey(url.searchParams.get("website") ?? undefined),
    formKey: submissionFormKey(url.searchParams.get("form") ?? undefined),
    status: submissionStatus(url.searchParams.get("status") ?? undefined),
    notification: notificationFilter(url.searchParams.get("notification") ?? undefined),
    reference: url.searchParams.get("q")?.trim().slice(0, 80) || undefined,
    person: personAllowed ? url.searchParams.get("person")?.trim().slice(0, 80) || undefined : undefined,
    page: "all" as const,
    productionOnly: true,
    contact,
  };
  const board = await listEnquiryBoard(scope, filters, window);
  if (!board.connected) return new NextResponse("The clinic website database is not connected.", { status: 503 });
  const websites = await staffTx(access, (db) => listFormWebsites(db, null));
  const websiteNames = new Map(websites.flatMap((site) => site.enquiry_key ? [[site.enquiry_key, site.name] as const] : []));
  const rows = board.items.filter((item) => !item.isSynthetic);
  const clinics = new Map<string, number>();
  for (const row of rows) clinics.set(row.clinicId, (clinics.get(row.clinicId) ?? 0) + 1);
  await staffTx(access, (db) => recordAudit(db, {
    actorType: "staff",
    actorUserId: access.user.id,
    action: "form_submission.export",
    targetType: "form_submission",
    targetId: null,
    outcome: "success",
    metadata: {
      rowCount: rows.length,
      from: window.from,
      to: window.to,
      clinic: filters.clinicId ?? null,
      website: filters.websiteKey ?? null,
      form: filters.formKey ?? null,
      status: filters.status ?? null,
      notification: filters.notification ?? null,
      personSearch: Boolean(filters.person),
      contactDetails: contact,
      clinics: [...clinics].map(([slug, count]) => ({ slug, count })),
    },
  }));
  return new NextResponse(enquiryCsv(rows, websiteNames, { contact }), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"enquiries.csv\"",
    },
  });
}
