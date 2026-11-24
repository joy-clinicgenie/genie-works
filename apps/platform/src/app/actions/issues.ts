"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addEvidenceLink, addEvidenceUpload, canEditClient, getIssue, openIssue, removeEvidence, transitionIssue, updateIssueDetails, type IssueStatus } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { optional, str, toActionError, type ActionState } from "@/lib/actions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, isAllowedType, storeEvidenceFile } from "@/lib/storage";

function revalidate(id?: string) {
  revalidatePath("/");
  revalidatePath("/issues", "layout");
  revalidatePath("/clients", "layout");
  revalidatePath("/timeline");
  if (id) revalidatePath(`/issues/${id}`);
}

export async function createIssueAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const clientId = str(form, "clientId");
  if (!canEditClient(access, clientId) && access.user.platform_role !== "reviewer") return { ok: false, error: "You cannot open issues for this client." };
  let id: string;
  try {
    id = await staffTx(access, (db) =>
      openIssue(db, clientId, { title: str(form, "title"), description: optional(form, "description"), severity: str(form, "severity") || "medium", ownerUserId: str(form, "ownerUserId") || access.user.id, relatedType: optional(form, "relatedType"), relatedId: optional(form, "relatedId") }, access.user.id),
    );
  } catch (err) {
    return toActionError(err);
  }
  revalidate(id);
  redirect(`/issues/${id}`);
}

export async function updateIssueAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "issueId");
  try {
    await staffTx(access, async (db) => {
      const issue = await getIssue(db, id);
      if (!issue || !canEditClient(access, issue.client_id)) throw Object.assign(new Error("You cannot edit this issue."), { name: "IssueRuleError" });
      await updateIssueDetails(db, id, { title: str(form, "title"), description: optional(form, "description"), severity: str(form, "severity") || "medium", ownerUserId: str(form, "ownerUserId"), relatedType: optional(form, "relatedType"), relatedId: optional(form, "relatedId") }, access.user.id);
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidate(id);
  return { ok: true, message: "Issue saved." };
}

export async function transitionIssueAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "issueId");
  const status = str(form, "status") as IssueStatus;
  try {
    await staffTx(access, async (db) => {
      const issue = await getIssue(db, id);
      if (!issue) throw Object.assign(new Error("Issue not found."), { name: "IssueRuleError" });
      const verifying = status === "verified_closed" || (status === "reopened" && issue.status === "resolved_pending_verification");
      const allowed = canEditClient(access, issue.client_id) || (verifying && access.user.platform_role === "reviewer" && access.memberships.some((m) => m.client_id === issue.client_id));
      if (!allowed) throw Object.assign(new Error("You cannot change this issue."), { name: "IssueRuleError" });
      if (status === "verified_closed" && issue.resolved_by === access.user.id && access.user.platform_role !== "admin") {
        throw Object.assign(new Error("The person who resolved the issue should not be the one verifying it. Ask a colleague."), { name: "IssueRuleError" });
      }
      const result = optional(form, "verificationResult") as "passed" | "failed" | null;
      await transitionIssue(db, id, { status, note: optional(form, "note"), verificationResult: result }, access.user.id);
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidate(id);
  return { ok: true, message: `Issue is now ${status.replace(/_/g, " ")}.` };
}

export async function addEvidenceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const clientId = str(form, "clientId");
  const issueId = optional(form, "issueId");
  if (!canEditClient(access, clientId) && access.user.platform_role !== "reviewer") return { ok: false, error: "You cannot add evidence for this client." };
  const label = str(form, "label");
  const file = form.get("file");
  const url = optional(form, "url");
  try {
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `Files must be ${MAX_UPLOAD_LABEL} or smaller.`, field: "file" };
      if (!isAllowedType(file.type)) return { ok: false, error: "Allowed types: PNG, JPEG, WebP, GIF, PDF, plain text, CSV.", field: "file" };
      const bytes = Buffer.from(await file.arrayBuffer());
      const stored = await storeEvidenceFile(clientId, bytes, file.name, file.type);
      await staffTx(access, (db) => addEvidenceUpload(db, clientId, { issueId, label: label || file.name, storageKey: stored.storageKey, originalName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.size, sha256: stored.sha256 }, access.user.id));
    } else if (url) {
      await staffTx(access, (db) => addEvidenceLink(db, clientId, { issueId, label, url }, access.user.id));
    } else {
      return { ok: false, error: "Choose a file or enter an https link." };
    }
  } catch (err) {
    return toActionError(err);
  }
  revalidate(issueId ?? undefined);
  return { ok: true, message: "Evidence added." };
}

export async function removeEvidenceAction(form: FormData): Promise<void> {
  const access = await requireAccess();
  const id = str(form, "evidenceId");
  const issueId = optional(form, "issueId");
  await staffTx(access, async (db) => {
    const { rows } = await db.query<{ client_id: string }>("select client_id from evidence_items where id = $1", [id]);
    if (!rows[0] || !canEditClient(access, rows[0].client_id)) return;
    await removeEvidence(db, id, access.user.id);
  });
  revalidate(issueId ?? undefined);
}
