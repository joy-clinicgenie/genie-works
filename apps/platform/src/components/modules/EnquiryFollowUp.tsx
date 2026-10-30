"use client";

import { useActionState } from "react";
import { updateEnquiryStatusAction } from "@/app/actions/enquiries";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Select, Textarea } from "@/components/ui/Field";
import type { SubmissionStatus } from "@/lib/form-submissions";

const OPTIONS: Array<{ value: SubmissionStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "closed", label: "Closed" },
];

export function EnquiryFollowUp({ enquiryId, status }: { enquiryId: string; status: SubmissionStatus }) {
  const [state, action, pending] = useActionState(updateEnquiryStatusAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="enquiryId" value={enquiryId} />
      <input type="hidden" name="fromStatus" value={status} />
      <Field label="Follow-up status" htmlFor={`status-${enquiryId}`} hint="New means the enquiry is waiting for staff. Acknowledged means staff have taken follow-up. It does not mean an email was sent. Closed means no further action in this workflow. It does not mean an appointment was booked. Closed can be reopened.">
        <Select id={`status-${enquiryId}`} name="status" defaultValue={status}>
          {OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </Field>
      <Field label="Internal note" htmlFor={`note-${enquiryId}`} hint="Optional. This note stays in Genie Works and is not sent to the clinic or the person who enquired.">
        <Textarea id={`note-${enquiryId}`} name="note" maxLength={1000} />
      </Field>
      <FormError state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save follow-up"}</Button>
    </form>
  );
}
