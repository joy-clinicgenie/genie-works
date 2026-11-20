"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  IssueRuleError,
  SeoWorkRuleError,
  TaskRuleError,
  acceptRecommendation,
  canEditClient,
  dismissRecommendation,
  moveSeoIssue,
  recordSetupReview,
  refreshRecommendations,
  verifySeoIssue,
  type AccessProfile,
  type ReviewStep,
} from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { str } from "@/lib/actions";
import { isWebsiteId } from "@/lib/seo-scope";
import { loadSeoContextWithDb, type SeoSite } from "@/lib/seo-workspace";

const PAGE = "/seo/tasks";

function back(websiteId: string, tab: string, notice: string, extra: Record<string, string> = {}): never {
  redirect(`${PAGE}?${new URLSearchParams({ website: websiteId, tab, notice, ...extra })}`);
}

/** The selected website for an editor, re-resolved on the server (D65). */
async function editableSite(access: AccessProfile, websiteId: string): Promise<SeoSite | null> {
  if (!isWebsiteId(websiteId)) return null;
  const site = await staffTx(access, async (db) => (await loadSeoContextWithDb(db, { website: websiteId })).selected);
  return site && site.id === websiteId && canEditClient(access, site.clientId) ? site : null;
}

function ruleMessage(error: unknown): string | null {
  return error instanceof SeoWorkRuleError || error instanceof IssueRuleError || error instanceof TaskRuleError ? error.message : null;
}

/** SEO-02.1: records a staff review for a review step. */
export async function recordSetupReviewAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const step = str(formData, "step") as ReviewStep;
  const access = await requireAccess();
  const site = await editableSite(access, websiteId);
  if (!site) back(websiteId, "setup", "denied");
  try {
    await staffTx(access, (db) => recordSetupReview(db, { clientId: site.clientId, websiteId, step, note: str(formData, "note") || null, actorUserId: access.user.id }));
  } catch (error) {
    const message = ruleMessage(error);
    if (message) back(websiteId, "setup", "invalid", { reason: message });
    throw error;
  }
  revalidatePath(PAGE);
  back(websiteId, "setup", "review_saved");
}

/** SEO-02.2: start work or mark ready to verify. */
export async function moveSeoIssueAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const issueId = str(formData, "issueId");
  const to = str(formData, "to") === "resolved_pending_verification" ? "resolved_pending_verification" : "investigating";
  const access = await requireAccess();
  const site = await editableSite(access, websiteId);
  if (!site || !isWebsiteId(issueId)) back(websiteId, "issues", "denied");
  try {
    await staffTx(access, (db) => moveSeoIssue(db, { websiteId, issueId, to, note: str(formData, "note") || null, actorUserId: access.user.id }));
  } catch (error) {
    const message = ruleMessage(error);
    if (message) back(websiteId, "issues", "invalid", { reason: message });
    throw error;
  }
  revalidatePath(PAGE);
  back(websiteId, "issues", to === "investigating" ? "issue_started" : "issue_ready");
}

/** SEO-02.2: verifies a fix with recheck evidence or a recorded verification. */
export async function verifySeoIssueAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const issueId = str(formData, "issueId");
  const evidence = str(formData, "evidence") === "recheck" ? "recheck" : "recorded";
  const access = await requireAccess();
  const site = await editableSite(access, websiteId);
  if (!site || !isWebsiteId(issueId)) back(websiteId, "issues", "denied");
  try {
    await staffTx(access, (db) => verifySeoIssue(db, { websiteId, issueId, evidence, note: str(formData, "note") || null, actorUserId: access.user.id }));
  } catch (error) {
    const message = ruleMessage(error);
    if (message) back(websiteId, "issues", "invalid", { reason: message });
    throw error;
  }
  revalidatePath(PAGE);
  back(websiteId, "issues", "issue_verified");
}

/** SEO-02.3: stores suggestions found in the current evidence. Decided suggestions keep their decision. */
export async function refreshRecommendationsAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const access = await requireAccess();
  const site = await editableSite(access, websiteId);
  if (!site) back(websiteId, "recommendations", "denied");
  const added = await staffTx(access, (db) => refreshRecommendations(db, { id: site.id, clientId: site.clientId }));
  revalidatePath(PAGE);
  back(websiteId, "recommendations", "suggestions_found", { added: String(added) });
}

/** SEO-02.3: accepting twice (or at once) links one task. */
export async function acceptRecommendationAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const recommendationId = str(formData, "recommendationId");
  const access = await requireAccess();
  const site = await editableSite(access, websiteId);
  if (!site || !isWebsiteId(recommendationId)) back(websiteId, "recommendations", "denied");
  let created = false;
  try {
    created = (await staffTx(access, (db) => acceptRecommendation(db, { websiteId, recommendationId, ownerUserId: access.user.id, actorUserId: access.user.id }))).created;
  } catch (error) {
    const message = ruleMessage(error);
    if (message) back(websiteId, "recommendations", "invalid", { reason: message });
    throw error;
  }
  revalidatePath(PAGE);
  back(websiteId, "recommendations", created ? "task_created" : "task_exists");
}

export async function dismissRecommendationAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const recommendationId = str(formData, "recommendationId");
  const access = await requireAccess();
  const site = await editableSite(access, websiteId);
  if (!site || !isWebsiteId(recommendationId)) back(websiteId, "recommendations", "denied");
  try {
    await staffTx(access, (db) => dismissRecommendation(db, { websiteId, recommendationId, reason: str(formData, "reason") || null, actorUserId: access.user.id }));
  } catch (error) {
    const message = ruleMessage(error);
    if (message) back(websiteId, "recommendations", "invalid", { reason: message });
    throw error;
  }
  revalidatePath(PAGE);
  back(websiteId, "recommendations", "dismissed");
}
