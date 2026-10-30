"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  archiveSeoPage, canEditClient, canManageRegistry, canPublishClient, createSeoPage, getSeoPage, issueSeoSiteToken, recordSeoChange,
  saveGoogleSiteVerification, saveSeoBusinessProfile, saveSeoPageSetting, saveSeoRedirect,
  updateSeoPage, verifySeoChange, type SeoBusinessProfileRow, type SeoPageInput,
} from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { bool, optional, str, toActionError, type ActionState } from "@/lib/actions";

function revalidate(id?: string) {
  revalidatePath("/seo", "layout");
  revalidatePath("/clients", "layout");
  revalidatePath("/timeline");
  if (id) revalidatePath(`/seo/pages/${id}`);
}

function pageInput(form: FormData): SeoPageInput {
  return {
    websiteId: optional(form, "websiteId"),
    pagePath: str(form, "pagePath"),
    pageTitle: optional(form, "pageTitle"),
    primaryKeyword: optional(form, "primaryKeyword"),
    secondaryKeywords: str(form, "secondaryKeywords").split(",").map((s) => s.trim()).filter(Boolean),
    searchIntent: optional(form, "searchIntent"),
    contentStatus: str(form, "contentStatus") || "planned",
    ownerUserId: optional(form, "ownerUserId"),
    lastReviewedOn: optional(form, "lastReviewedOn"),
    nextReviewOn: optional(form, "nextReviewOn"),
    mappingFlag: str(form, "mappingFlag") || "none",
    flagNote: optional(form, "flagNote"),
    notes: optional(form, "notes"),
  };
}

export async function savePageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const clientId = str(form, "clientId");
  const pageId = optional(form, "pageId");
  if (!canEditClient(access, clientId)) return { ok: false, error: "You cannot edit SEO records for this client." };
  let id = pageId;
  try {
    await staffTx(access, async (db) => {
      if (pageId) {
        const p = await getSeoPage(db, pageId);
        if (!p || p.client_id !== clientId) throw Object.assign(new Error("Page not found."), { name: "SeoRuleError" });
        await updateSeoPage(db, pageId, pageInput(form), access.user.id);
      } else {
        id = await createSeoPage(db, clientId, pageInput(form), access.user.id);
      }
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidate(id ?? undefined);
  if (!pageId) redirect(`/seo/pages/${id}`);
  return { ok: true, message: "Page mapping saved." };
}

export async function archivePageAction(form: FormData): Promise<void> {
  const access = await requireAccess();
  const id = str(form, "pageId");
  await staffTx(access, async (db) => {
    const p = await getSeoPage(db, id);
    if (!p || !canEditClient(access, p.client_id)) return;
    await archiveSeoPage(db, id, access.user.id);
  });
  revalidate(id);
  redirect("/seo");
}

export async function recordChangeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const pageId = str(form, "pageId");
  try {
    await staffTx(access, async (db) => {
      const p = await getSeoPage(db, pageId);
      if (!p || !canEditClient(access, p.client_id)) throw Object.assign(new Error("You cannot record changes for this page."), { name: "SeoRuleError" });
      await recordSeoChange(db, pageId, { changeType: str(form, "changeType") || "other", beforeValue: optional(form, "beforeValue"), afterValue: optional(form, "afterValue"), reason: str(form, "reason"), changedOn: str(form, "changedOn"), approvalId: optional(form, "approvalId") }, access.user.id);
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidate(pageId);
  return { ok: true, message: "Change recorded." };
}

export async function verifyChangeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const changeId = str(form, "changeId");
  const pageId = str(form, "pageId");
  try {
    await staffTx(access, async (db) => {
      const p = await getSeoPage(db, pageId);
      if (!p || !canEditClient(access, p.client_id) || !p.changes.some((c) => c.id === changeId)) throw Object.assign(new Error("You cannot verify this change."), { name: "SeoRuleError" });
      await verifySeoChange(db, changeId, { verificationOn: str(form, "verificationOn"), outcomeNote: str(form, "outcomeNote") }, access.user.id);
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidate(pageId);
  return { ok: true, message: "Verification recorded." };
}

export async function saveSeoPageSettingAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const clientId = str(form, "clientId");
  const websiteId = str(form, "websiteId");
  if (!canPublishClient(access, clientId)) return { ok: false, error: "You cannot publish SEO settings for this client." };
  try {
    await staffTx(access, (db) => saveSeoPageSetting(db, clientId, websiteId, {
      pagePath: str(form, "pagePath"),
      title: str(form, "title"),
      description: str(form, "description"),
      canonicalPath: optional(form, "canonicalPath"),
      indexable: bool(form, "indexable"),
    }, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/seo", "layout");
  return { ok: true, message: "Published page SEO settings saved." };
}

export async function saveGoogleVerificationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const clientId = str(form, "clientId");
  const websiteId = str(form, "websiteId");
  if (!canPublishClient(access, clientId)) return { ok: false, error: "You cannot publish a verification tag for this client." };
  try {
    await staffTx(access, (db) => saveGoogleSiteVerification(db, clientId, websiteId, optional(form, "verificationToken"), access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/seo", "layout");
  return { ok: true, message: "Search Console verification code saved. Verify site ownership in Search Console." };
}

export async function saveSeoRedirectAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const clientId = str(form, "clientId");
  const websiteId = str(form, "websiteId");
  if (!canPublishClient(access, clientId)) return { ok: false, error: "You cannot publish redirects for this client." };
  try {
    await staffTx(access, (db) => saveSeoRedirect(db, clientId, websiteId, {
      id: optional(form, "redirectId") ?? undefined,
      sourcePath: str(form, "sourcePath"),
      destinationPath: str(form, "destinationPath"),
      active: bool(form, "active"),
    }, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/seo/redirects");
  revalidatePath("/seo/tasks");
  revalidatePath("/seo/checklist");
  return { ok: true, message: "301 redirect saved." };
}

export async function saveSeoBusinessProfileAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const clientId = str(form, "clientId");
  if (!canEditClient(access, clientId)) return { ok: false, error: "You cannot edit Google Business Profile references for this client." };
  const status = str(form, "setupStatus");
  if (!["not_started", "in_progress", "staff_marked_verified"].includes(status)) return { ok: false, error: "Choose a valid setup status." };
  try {
    await staffTx(access, (db) => saveSeoBusinessProfile(db, clientId, {
      id: optional(form, "profileId") ?? undefined,
      branchName: str(form, "branchName"),
      profileUrl: optional(form, "profileUrl"),
      externalIdentifier: optional(form, "externalIdentifier"),
      setupStatus: status as SeoBusinessProfileRow["setup_status"],
      notes: optional(form, "notes"),
    }, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/seo/business-profiles");
  revalidatePath("/seo/business-profile");
  revalidatePath("/seo/tasks");
  revalidatePath("/seo/checklist");
  return { ok: true, message: "Google Business Profile reference saved." };
}

export async function rotateSeoSiteTokenAction(_prev: { ok: true; message?: string; token?: string } | { ok: false; error: string } | null, form: FormData) {
  const access = await requireAccess();
  const clientId = str(form, "clientId");
  const websiteId = str(form, "websiteId");
  if (!canManageRegistry(access)) return { ok: false as const, error: "Only admins and managers can create or rotate website API credentials." };
  if (!canEditClient(access, clientId)) return { ok: false as const, error: "You cannot connect this client's website." };
  try {
    const token = await staffTx(access, (db) => issueSeoSiteToken(db, clientId, websiteId, access.user.id));
    revalidatePath("/seo/settings");
    revalidatePath("/seo/tasks");
    revalidatePath("/seo/checklist");
    return { ok: true as const, token, message: "Copy this token now. It will not be shown again." };
  } catch (err) {
    const state = toActionError(err);
    return { ok: false as const, error: state && !state.ok ? state.error : "Could not create a website token." };
  }
}
