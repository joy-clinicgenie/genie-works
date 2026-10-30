import Link from "next/link";
import { notFound } from "next/navigation";
import { canEditClient, formatDate, formatDateTime, getClientBySlug, listAuditEvents, listEnquiryStatusEvents, recordAudit } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card, KeyValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Notice";
import { EnquiryTabs } from "@/components/modules/EnquiryTabs";
import { EnquiryFollowUp } from "@/components/modules/EnquiryFollowUp";
import { EnquiryNotification } from "@/components/modules/EnquiryNotification";
import { STATUS_LABEL, canRetryNotifications, enquiryConnection, enquiryUnavailableCopy, formName, getFormSubmission, sourceLabel, submissionClinicScope, type SubmissionStatus } from "@/lib/form-submissions";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<SubmissionStatus, "info" | "warn" | "neutral"> = { new: "info", acknowledged: "warn", closed: "neutral" };

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAccess();
  const { id } = await params;
  const submission = await getFormSubmission(submissionClinicScope(access), id);
  if (submission === "unavailable") {
    const source = await enquiryConnection();
    return <EmptyState title="This enquiry could not be loaded">{enquiryUnavailableCopy(source, "The clinic website database is not connected. Nothing was changed.")}</EmptyState>;
  }
  if (!submission) notFound();
  const { client, events, retries } = await staffTx(access, async (db) => ({
    client: await getClientBySlug(db, submission.clinicId),
    events: await listEnquiryStatusEvents(db, submission.id),
    retries: submission.notification
      ? await listAuditEvents(db, { action: "notification.retry", targetIds: [submission.notification.id], limit: 50 })
      : [],
  }));
  await staffTx(access, (db) => recordAudit(db, {
    actorType: "staff",
    actorUserId: access.user.id,
    action: "form_submission.view",
    targetType: "form_submission",
    targetId: submission.id,
    outcome: "success",
    metadata: { clinicId: submission.clinicId, reference: submission.reference },
  }));
  const latest = events[0];
  const canEdit = Boolean(client && canEditClient(access, client.id));
  const preference = [submission.preferredDate ? formatDate(submission.preferredDate) : null, submission.preferredTimeWindow].filter(Boolean).join(" · ");
  return (
    <EnquiryTabs>
      <PageHeader
        eyebrow={<Link href="/enquiries" className="hover:text-action">Enquiries</Link>}
        title={submission.submitterName}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[submission.status]}>{STATUS_LABEL[submission.status]}</Badge>{submission.isSynthetic && <Badge tone="warn">Demonstration data</Badge>}</span>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
        <Card className="p-5">
          <p className="mb-4 text-sm text-muted">{submission.clinicName} · {formName(submission.formKey)} · {formatDateTime(submission.submittedAt)} · {submission.reference}</p>
          <KeyValue items={[
            { label: "Name", value: submission.submitterName },
            { label: "Telephone", value: submission.contactNumber },
            { label: "Email", value: submission.email },
            { label: "Reason", value: submission.reason },
            { label: "Preferred time", value: preference || null },
            { label: "Page", value: submission.pagePath },
            { label: "Source", value: sourceLabel(submission.attributionSource) },
            { label: "Message", value: submission.message ? <span className="whitespace-pre-wrap">{submission.message}</span> : null },
          ]} />
          <p className="mt-4 text-xs text-muted">A preferred time is a request, not a booked appointment. Closed does not mean an appointment took place. Acknowledged does not mean an email was sent.</p>
        </Card>
        <div className="space-y-4">
        <Card className="p-5">
          <EnquiryNotification
            storedAt={submission.submittedAt}
            status={submission.notificationStatus}
            notification={submission.notification}
            manualRetries={[...retries].reverse().map((retry) => ({ id: retry.id, at: retry.occurred_at, actor: retry.actor_name ?? "Staff" }))}
            canRetry={canRetryNotifications(access)}
          />
        </Card>
        <Card className="p-5">
          <h2 className="text-base font-semibold">Follow-up</h2>
          <p className="mt-2 text-sm text-muted">
            {latest ? <>Last updated {formatDateTime(latest.occurred_at)} by {latest.actor_name}.</> : "This status was recorded on the website. This platform has no staff change yet."}
          </p>
          <div className="mt-4">
            {canEdit ? <EnquiryFollowUp enquiryId={submission.id} status={submission.status} /> : <p className="text-sm">You can view this enquiry. Changing follow-up status needs edit access for the client.</p>}
          </div>
          <h3 className="mt-6 text-sm font-semibold">Status history</h3>
          {events.length === 0 ? <p className="mt-2 text-sm text-muted">No staff changes are recorded.</p> : (
            <ol className="mt-2 space-y-3 text-sm">
              {events.map((event) => (
                <li key={event.id}>
                  <p>{STATUS_LABEL[event.from_status]} to {STATUS_LABEL[event.to_status]}</p>
                  <p className="text-xs text-muted">{formatDateTime(event.occurred_at)} · {event.actor_name}</p>
                  {event.note && <p className="mt-1 whitespace-pre-wrap">{event.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
        </div>
      </div>
    </EnquiryTabs>
  );
}
