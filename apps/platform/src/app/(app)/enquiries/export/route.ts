import { NextResponse } from "next/server";
import { canExport, listFormWebsites, openedEnquiryIdentities, recordAudit } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import {
  canSearchEnquiryPerson,
  enquiryConnection,
  enquiryCsv,
  enquiryHandling,
  enquiryIdentity,
  enquiryWindow,
  handlingFilter,
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
  const board = await listEnquiryBoard(scope, filters, window, access);
  if (!board.connected) {
    const connection = await enquiryConnection();
    const message = connection.refused ? "The enquiry database target was refused. A Wix form is a separate connection." : "No website enquiry database is connected, and no Wix form is available to read.";
    return new NextResponse(message, { status: 503 });
  }
  const websites = await staffTx(access, (db) => listFormWebsites(db, null));
  const websiteNames = new Map(websites.flatMap((site) => site.enquiry_key ? [[site.enquiry_key, site.name] as const] : []));
  const production = board.items.filter((item) => !item.isSynthetic);
  const opened = new Set(
    production.length === 0
      ? []
      : await staffTx(access, (db) => openedEnquiryIdentities(db, production.map((item) => ({ id: item.id, source: item.source ?? "database" })))),
  );
  const handling = handlingFilter(url.searchParams.get("handling") ?? undefined);
  const rows = handling
    ? production.filter((item) => enquiryHandling(item.status, opened.has(enquiryIdentity(item))) === handling)
    : production;
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
      handling: handling ?? null,
      personSearch: Boolean(filters.person),
      contactDetails: contact,
      clinics: [...clinics].map(([slug, count]) => ({ slug, count })),
    },
  }));
  return new NextResponse(enquiryCsv(rows, websiteNames, { contact, opened }), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"enquiries.csv\"",
    },
  });
}
