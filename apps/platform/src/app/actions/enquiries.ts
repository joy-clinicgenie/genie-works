"use server";

import { revalidatePath } from "next/cache";
import { canEditClient, getClientBySlug, recordAudit, recordEnquiryStatusEvent } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { canRetryNotifications, getFormSubmission, retryNotification, submissionClinicScope, submissionEditScope, submissionStatus, updateEnquiryStatus } from "@/lib/form-submissions";
import { optional, str, toActionError, type ActionState } from "@/lib/actions";

export async function retryNotificationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "outboxId");
  if (!canRetryNotifications(access)) return { ok: false, error: "You do not have permission to retry a notification." };
  const scope = submissionClinicScope(access);
  try {
    const result = await retryNotification(scope, id);
    if (result === "unavailable") return { ok: false, error: "The clinic website database is not connected. Nothing was changed." };
    if (!result) return { ok: false, error: "That notification cannot be retried." };
    await staffTx(access, async (db) => {
      const client = await getClientBySlug(db, result.clinicId);
      await recordAudit(db, {
        actorType: "staff",
        actorUserId: access.user.id,
        action: "notification.retry",
        targetType: "notification_outbox",
        targetId: result.id,
        clientId: client?.id ?? null,
        outcome: "success",
        metadata: { clinicId: result.clinicId },
      });
    });
    revalidatePath("/enquiries/notifications");
    revalidatePath("/enquiries");
    revalidatePath(`/enquiries/${result.enquiryId}`);
  } catch (err) {
    return toActionError(err);
  }
  return { ok: true, message: "The notification is waiting to be sent again. No new enquiry was created." };
}

export async function updateEnquiryStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "enquiryId");
  const fromStatus = submissionStatus(str(form, "fromStatus"));
  const toStatus = submissionStatus(str(form, "status"));
  const note = optional(form, "note");
  if (!/^[0-9a-f-]{36}$/.test(id) || !fromStatus || !toStatus) return { ok: false, error: "Choose a follow-up status.", field: "status" };
  if (note && note.length > 1000) return { ok: false, error: "The note must be 1000 characters or fewer.", field: "note" };
  if (fromStatus === toStatus && !note) return { ok: false, error: "Choose a different status, or add a note.", field: "status" };
  const editScope = submissionEditScope(access);
  if (editScope && editScope.length === 0) return { ok: false, error: "You do not have permission to change follow-up status." };
  const current = await getFormSubmission(submissionClinicScope(access), id);
  if (current === "unavailable") return { ok: false, error: "The clinic website database is not connected. Nothing was changed." };
  if (!current) return { ok: false, error: "That enquiry is not available." };
  if (current.status !== fromStatus) return { ok: false, error: "The status changed before this was saved. Reload the enquiry.", field: "status" };
  const client = await staffTx(access, (db) => getClientBySlug(db, current.clinicId));
  if (!client || !canEditClient(access, client.id)) return { ok: false, error: "You do not have permission to change follow-up status." };
  if (editScope && !editScope.includes(current.clinicId)) return { ok: false, error: "You do not have permission to change follow-up status." };
  if (fromStatus !== toStatus) {
    const updated = await updateEnquiryStatus(editScope, id, fromStatus, toStatus);
    if (updated === "unavailable") return { ok: false, error: "The clinic website database is not connected. Nothing was changed." };
    if (!updated) return { ok: false, error: "The status changed before this was saved. Reload the enquiry.", field: "status" };
  }
  try {
    await staffTx(access, async (db) => {
      await recordEnquiryStatusEvent(db, {
        enquiryId: id,
        clinicSlug: current.clinicId,
        websiteKey: current.websiteKey,
        fromStatus,
        toStatus,
        note,
        actorUserId: access.user.id,
      });
      await recordAudit(db, {
        actorType: "staff",
        actorUserId: access.user.id,
        action: "form_submission.status",
        targetType: "form_submission",
        targetId: id,
        clientId: client.id,
        outcome: "success",
        metadata: { fromStatus, toStatus, noteSet: Boolean(note) },
      });
    });
  } catch (err) {
    if (fromStatus !== toStatus) return { ok: false, error: "The follow-up status was saved, but the history could not be recorded. Reload the enquiry." };
    return toActionError(err);
  }
  revalidatePath(`/enquiries/${id}`);
  revalidatePath("/enquiries");
  return { ok: true, message: fromStatus === toStatus ? "Note saved. The follow-up status is unchanged." : "Follow-up status saved." };
}
