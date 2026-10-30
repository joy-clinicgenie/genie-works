import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatDateTime, recordAudit } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card, KeyValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Notice";
import { EnquiryTabs } from "@/components/modules/EnquiryTabs";
import { formName, getFormSubmission, submissionClinicScope } from "@/lib/form-submissions";

export const dynamic = "force-dynamic";

const STATUS_TONE = { new: "info", acknowledged: "warn", closed: "neutral" } as const;
const STATUS_LABEL = { new: "New", acknowledged: "Acknowledged", closed: "Closed" } as const;

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAccess();
  const { id } = await params;
  const submission = await getFormSubmission(submissionClinicScope(access), id);
  if (submission === "unavailable") {
    return <EmptyState title="This enquiry could not be loaded">The clinic website database is not connected. Nothing was changed.</EmptyState>;
  }
  if (!submission) notFound();
  await staffTx(access, (db) => recordAudit(db, {
    actorType: "staff",
    actorUserId: access.user.id,
    action: "form_submission.view",
    targetType: "form_submission",
    targetId: submission.id,
    outcome: "success",
    metadata: { clinicId: submission.clinicId, reference: submission.reference },
  }));
  const preference = [submission.preferredDate ? formatDate(submission.preferredDate) : null, submission.preferredTimeWindow].filter(Boolean).join(" · ");
  return (
    <EnquiryTabs>
      <PageHeader
        eyebrow={<Link href="/enquiries" className="hover:text-action">Enquiries</Link>}
        title={submission.submitterName}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[submission.status]}>{STATUS_LABEL[submission.status]}</Badge>{submission.isSynthetic && <Badge tone="warn">Demonstration data</Badge>}</span>}
      />
      <Card className="p-5">
        <p className="mb-4 text-sm text-muted">{submission.clinicName} · {formName(submission.formKey)} · {formatDateTime(submission.submittedAt)} · {submission.reference}</p>
        <KeyValue items={[
          { label: "Name", value: submission.submitterName },
          { label: "Telephone", value: submission.contactNumber },
          { label: "Email", value: submission.email },
          { label: "Reason", value: submission.reason },
          { label: "Preferred time", value: preference || null },
          { label: "Page", value: submission.pagePath },
          { label: "Message", value: submission.message ? <span className="whitespace-pre-wrap">{submission.message}</span> : null },
        ]} />
        <p className="mt-4 text-xs text-muted">A preferred time is a request, not a booked appointment. Closed does not mean an appointment took place.</p>
      </Card>
    </EnquiryTabs>
  );
}
