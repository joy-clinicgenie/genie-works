"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isReportTemplate, isReportType, REPORT_TYPE_LABELS } from "@clinic-genie/contracts";
import { canAccessClient, canEditClient, composeReport, createSavedReport, duplicateSavedReport, getSavedReport, saveSavedReport, type ReportBlock } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { clientLabel } from "@/lib/client-label";
import { list, optional, str, toActionError, type ActionState } from "@/lib/actions";

export interface ReportPreviewPayload {
  name: string;
  clientName: string;
  websiteLabel: string | null;
  reportType: string;
  preparedBy: string;
  periodStart: string;
  periodEnd: string;
  comparisonStart: string | null;
  comparisonEnd: string | null;
  blocks: ReportBlock[];
  limitationNote: string;
}

export type BuilderState = { ok: true; message?: string; preview?: ReportPreviewPayload } | { ok: false; error: string; field?: string } | null;

function inputFrom(form: FormData) {
  return {
    clientId: str(form, "clientId"),
    name: str(form, "name"),
    periodStart: str(form, "periodStart"),
    periodEnd: str(form, "periodEnd"),
    comparisonStart: optional(form, "comparisonStart"),
    comparisonEnd: optional(form, "comparisonEnd"),
    sections: list(form, "sections"),
    summary: optional(form, "summary"),
    observations: optional(form, "observations"),
    actionsTaken: optional(form, "actionsTaken"),
    nextSteps: optional(form, "nextSteps"),
    dataSourcesNote: optional(form, "dataSourcesNote"),
    missingConnections: optional(form, "missingConnections"),
    measurementLimitations: optional(form, "measurementLimitations"),
  };
}

function revalidate() {
  revalidatePath("/reports");
  revalidatePath("/timeline");
}

export async function createSavedReportAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const input = inputFrom(form);
  if (!input.clientId) return { ok: false, error: "Choose a client.", field: "clientId" };
  if (!canEditClient(access, input.clientId)) return { ok: false, error: "You cannot create a report for this client." };
  let id = "";
  try {
    id = await staffTx(access, (db) => createSavedReport(db, input, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidate();
  redirect(`/reports/${id}`);
}

export async function saveSavedReportAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "reportId");
  const input = inputFrom(form);
  if (!canEditClient(access, input.clientId)) return { ok: false, error: "You cannot save a report for this client." };
  let version: number | null = 0;
  try {
    version = await staffTx(access, (db) => saveSavedReport(db, id, input, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidate();
  revalidatePath(`/reports/${id}`);
  if (version === null) return { ok: true, message: "Draft saved." };
  return { ok: true, message: `Saved as version ${version}. That version is kept for client review.` };
}

function builderInput(form: FormData) {
  const reportType = str(form, "reportType");
  const templateKey = optional(form, "templateKey");
  return {
    clientId: str(form, "clientId"),
    name: str(form, "name"),
    periodStart: str(form, "periodStart"),
    periodEnd: str(form, "periodEnd"),
    comparisonStart: optional(form, "comparisonStart"),
    comparisonEnd: optional(form, "comparisonEnd"),
    sections: [] as string[],
    summary: null,
    observations: null,
    actionsTaken: null,
    nextSteps: null,
    dataSourcesNote: null,
    missingConnections: null,
    measurementLimitations: null,
    websiteId: optional(form, "websiteId"),
    reportType: isReportType(reportType) ? reportType : "custom",
    templateKey: isReportTemplate(templateKey) ? templateKey : null,
    checklist: list(form, "items"),
  };
}

export async function submitReportBuilder(_prev: BuilderState, form: FormData): Promise<BuilderState> {
  const access = await requireAccess();
  const intent = str(form, "intent");
  const input = builderInput(form);
  const reportId = optional(form, "reportId");
  if (!input.clientId) return { ok: false, error: "Choose a client.", field: "clientId" };
  if (!canAccessClient(access, input.clientId)) return { ok: false, error: "You cannot use this client." };
  if (intent !== "preview" && !canEditClient(access, input.clientId)) return { ok: false, error: "You cannot save a report for this client." };
  if (intent === "preview") {
    try {
      const preview = await staffTx(access, async (db) => {
        const client = (await db.query<{ name: string; reference_number: string | null }>("select name, reference_number from clients where id = $1", [input.clientId])).rows[0];
        if (!client) return null;
        const website = input.websiteId
          ? (await db.query<{ name: string; url: string | null }>("select name, url from websites where id = $1 and client_id = $2", [input.websiteId, input.clientId])).rows[0]
          : null;
        if (input.websiteId && !website) throw Object.assign(new Error("Choose a website that belongs to this client."), { name: "SavedReportRuleError", field: "websiteId" });
        const websites = await db.query("select 1 from websites where client_id = $1 and status = 'active' limit 1", [input.clientId]);
        if (websites.rows.length > 0 && !input.websiteId) throw Object.assign(new Error("Choose a website."), { name: "SavedReportRuleError", field: "websiteId" });
        const composition = await composeReport(db, {
          clientId: input.clientId,
          websiteId: input.websiteId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          comparisonStart: input.comparisonStart,
          comparisonEnd: input.comparisonEnd,
          items: input.checklist ?? [],
        });
        return {
          preview: {
            name: input.name || "Report",
            clientName: clientLabel(client),
            websiteLabel: website ? (website.url ? `${website.name} (${website.url})` : website.name) : null,
            reportType: REPORT_TYPE_LABELS[input.reportType ?? "custom"],
            preparedBy: access.user.display_name,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            comparisonStart: input.comparisonStart,
            comparisonEnd: input.comparisonEnd,
            blocks: composition.blocks,
            limitationNote: composition.limitationNote,
          },
        };
      });
      if (!preview) return { ok: false, error: "Choose a client.", field: "clientId" };
      if (preview.preview.blocks.length === 0) return { ok: false, error: "Choose at least one report section.", field: "items" };
      return { ok: true, preview: preview.preview };
    } catch (err) {
      return toActionError(err);
    }
  }
  const review = intent === "review";
  let id = "";
  try {
    id = await staffTx(access, async (db) => {
      const websites = await db.query("select 1 from websites where client_id = $1 and status = 'active' limit 1", [input.clientId]);
      if (websites.rows.length > 0 && !input.websiteId) throw Object.assign(new Error("Choose a website."), { name: "SavedReportRuleError", field: "websiteId" });
      if (reportId) {
        await saveSavedReport(db, reportId, input, access.user.id, { review });
        return reportId;
      }
      return createSavedReport(db, input, access.user.id, { draft: !review });
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidate();
  revalidatePath(`/reports/${id}`);
  redirect(intent === "pdf" ? `/reports/${id}/print` : `/reports/${id}`);
}

export async function duplicateSavedReportAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "reportId");
  let copyId = "";
  try {
    copyId = await staffTx(access, async (db) => {
      const current = await getSavedReport(db, id);
      if (!current) return "";
      if (!canEditClient(access, current.client_id)) return "";
      return duplicateSavedReport(db, id, access.user.id);
    });
  } catch (err) {
    return toActionError(err);
  }
  if (!copyId) return { ok: false, error: "You cannot duplicate that report." };
  revalidate();
  redirect(`/reports/${copyId}`);
}
