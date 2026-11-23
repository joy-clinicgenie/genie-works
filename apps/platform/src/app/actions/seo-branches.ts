"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BranchReviewRuleError, REVIEW_FIELDS, canEditClient, recordBranchReview, type ReviewField } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { str } from "@/lib/actions";
import { isWebsiteId } from "@/lib/seo-scope";
import { loadSeoContextWithDb } from "@/lib/seo-workspace";

/**
 * SEO-06.2: records a staff review of a branch's public listing (D64). The branch must belong to the selected
 * website's organisation; the review is written as the acting user under row-level security.
 */
export async function recordBranchReviewAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const branchId = str(formData, "branchId");
  const href = (notice: string, extra: Record<string, string> = {}) =>
    `/seo/business-profile/${encodeURIComponent(branchId)}?${new URLSearchParams({ website: websiteId, notice, ...extra })}`;
  const access = await requireAccess();
  if (!isWebsiteId(websiteId) || !isWebsiteId(branchId)) redirect(href("denied"));
  const site = await staffTx(access, async (db) => (await loadSeoContextWithDb(db, { website: websiteId })).selected);
  if (!site || site.id !== websiteId || !canEditClient(access, site.clientId)) redirect(href("denied"));
  const fields = REVIEW_FIELDS.filter((field) => formData.get(`reviewed_${field}`) === "on");
  const discrepancies = REVIEW_FIELDS
    .filter((field) => formData.get(`mismatch_${field}`) === "on")
    .map((field) => ({ field: field as ReviewField, observed: str(formData, `observed_${field}`), note: str(formData, `note_${field}`) || null }));
  try {
    await staffTx(access, (db) => recordBranchReview(db, {
      clientId: site.clientId,
      branchId,
      reviewedOn: str(formData, "reviewedOn"),
      fieldsReviewed: fields,
      discrepancies,
      actorUserId: access.user.id,
    }));
  } catch (error) {
    if (error instanceof BranchReviewRuleError) redirect(href("review_invalid", { reason: error.message }));
    throw error;
  }
  revalidatePath("/seo/business-profile", "layout");
  redirect(href("review_saved"));
}
