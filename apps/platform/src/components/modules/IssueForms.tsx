"use client";

import { useActionState, useState, type ReactNode } from "react";
import { ISSUE_SEVERITIES } from "@clinic-genie/contracts";
import type { IssueStatus } from "@clinic-genie/contracts";
import { addEvidenceAction, createIssueAction, transitionIssueAction, updateIssueAction } from "@/app/actions/issues";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/Field";
import { label } from "@/components/ui/Badge";

export function IssueForm({ mode, values, owners, relatedPicker }: { mode: "create" | "edit"; values: { issueId?: string; clientId: string; title?: string; description?: string | null; severity?: string; ownerUserId?: string }; owners: Array<{ id: string; display_name: string }>; relatedPicker: ReactNode }) {
  const [state, action, pending] = useActionState(mode === "create" ? createIssueAction : updateIssueAction, null);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="clientId" value={values.clientId} />
      {values.issueId && <input type="hidden" name="issueId" value={values.issueId} />}
      <Field label="Title" htmlFor="title" required>
        <Input id="title" name="title" defaultValue={values.title ?? ""} required maxLength={200} />
      </Field>
      <Field label="Description" htmlFor="description" hint="What is wrong, where, and how it was noticed.">
        <Textarea id="description" name="description" defaultValue={values.description ?? ""} maxLength={4000} rows={4} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Severity" htmlFor="severity">
          <Select id="severity" name="severity" defaultValue={values.severity ?? "medium"}>{ISSUE_SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        </Field>
        <Field label="Owner" htmlFor="ownerUserId" required>
          <Select id="ownerUserId" name="ownerUserId" defaultValue={values.ownerUserId ?? ""} required>
            <option value="" disabled>Choose</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.display_name}</option>)}
          </Select>
        </Field>
      </div>
      {relatedPicker}
      <FormError state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving" : mode === "create" ? "Open issue" : "Save issue"}</Button>
    </form>
  );
}

const NEXT: Record<IssueStatus, IssueStatus[]> = {
  open: ["investigating", "resolved_pending_verification"],
  investigating: ["resolved_pending_verification", "open"],
  resolved_pending_verification: ["verified_closed", "reopened"],
  verified_closed: ["reopened"],
  reopened: ["investigating", "resolved_pending_verification"],
};

export function IssueTransitionForm({ issueId, status }: { issueId: string; status: IssueStatus }) {
  const [state, action, pending] = useActionState(transitionIssueAction, null);
  const [next, setNext] = useState<IssueStatus>(NEXT[status][0]!);
  const verifying = next === "verified_closed" || (next === "reopened" && status === "resolved_pending_verification");
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="issueId" value={issueId} />
      {verifying && <input type="hidden" name="verificationResult" value={next === "verified_closed" ? "passed" : "failed"} />}
      <Field label="Move to" htmlFor="status">
        <Select id="status" name="status" value={next} onChange={(e) => setNext(e.target.value as IssueStatus)}>
          {NEXT[status].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
      </Field>
      <Field label={next === "resolved_pending_verification" ? "Resolution" : verifying ? "What was checked and the result" : "Note"} htmlFor="note" required={next !== "investigating" && next !== "open"} hint={next === "verified_closed" ? "Recorded as a passed verification with you as verifier." : next === "reopened" && status === "resolved_pending_verification" ? "Recorded as a failed verification." : undefined}>
        <Textarea id="note" name="note" required={next !== "investigating" && next !== "open"} maxLength={4000} />
      </Field>
      <FormError state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving" : label(next)}</Button>
    </form>
  );
}

export function EvidenceForm({ clientId, issueId }: { clientId: string; issueId: string | null }) {
  const [state, action, pending] = useActionState(addEvidenceAction, null);
  return (
    <form action={action} className="space-y-3" encType="multipart/form-data">
      <input type="hidden" name="clientId" value={clientId} />
      {issueId && <input type="hidden" name="issueId" value={issueId} />}
      <Field label="Label" htmlFor="ev-label" required>
        <Input id="ev-label" name="label" required maxLength={200} />
      </Field>
      <Field label="Upload a file" htmlFor="ev-file" hint="PNG, JPEG, WebP, GIF, PDF, text or CSV up to 4 MB. Stored privately; only staff with access to this client can open it.">
        <Input id="ev-file" name="file" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv" />
      </Field>
      <Field label="Or an https link" htmlFor="ev-url">
        <Input id="ev-url" name="url" type="url" placeholder="https://" />
      </Field>
      <FormError state={state} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Saving" : "Add evidence"}</Button>
    </form>
  );
}
