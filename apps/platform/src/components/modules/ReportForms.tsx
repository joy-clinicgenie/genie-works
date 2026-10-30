"use client";

import { useActionState } from "react";
import { REPORT_CHANNELS, REPORT_METRICS, REPORT_SOURCES } from "@clinic-genie/contracts";
import { addNoteAction, addSnapshotAction } from "@/app/actions/reports";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/Field";
import { label } from "@/components/ui/Badge";

export function SnapshotForm({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(addSnapshotAction, null);
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Source" htmlFor="source"><Select id="source" name="source" defaultValue="manual">{REPORT_SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
        <Field label="Channel" htmlFor="channel"><Select id="channel" name="channel" defaultValue="all">{REPORT_CHANNELS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select></Field>
        <Field label="Metric" htmlFor="metric" required error={err("metric")}><Select id="metric" name="metric" defaultValue="enquiries">{REPORT_METRICS.filter((m) => m.key !== "patients").map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select></Field>
        <Field label="Value" htmlFor="value" hint="Leave blank if the figure is unavailable. Never enter zero for missing data." error={err("value")}><Input id="value" name="value" type="number" step="0.01" min="0" /></Field>
        <Field label="Period from" htmlFor="periodStart" required><Input id="periodStart" name="periodStart" type="date" required /></Field>
        <Field label="to" htmlFor="periodEnd" required><Input id="periodEnd" name="periodEnd" type="date" required /></Field>
      </div>
      <Field label="Note" htmlFor="snap-note" hint="For example the export file or why the figure is unavailable."><Input id="snap-note" name="note" maxLength={300} /></Field>
      <FormError state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving" : "Record snapshot"}</Button>
      <p className="text-xs text-muted">Recording the same metric, source, channel and period again supersedes the earlier value and keeps it in history.</p>
    </form>
  );
}

export function ObservationForm({ clientId, periodStart, periodEnd }: { clientId: string; periodStart?: string; periodEnd?: string }) {
  const [state, action, pending] = useActionState(addNoteAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Period from" htmlFor="obs-start" required><Input id="obs-start" name="periodStart" type="date" defaultValue={periodStart ?? ""} required /></Field>
        <Field label="to" htmlFor="obs-end" required><Input id="obs-end" name="periodEnd" type="date" defaultValue={periodEnd ?? ""} required /></Field>
      </div>
      <Field label="Observation" htmlFor="observation" required hint="What the figures show. Facts only."><Textarea id="observation" name="observation" required maxLength={4000} /></Field>
      <Field label="Possible explanations" htmlFor="possibleExplanations" hint="Kept separate. Write 'may be contributing', never 'caused'."><Textarea id="possibleExplanations" name="possibleExplanations" maxLength={4000} /></Field>
      <FormError state={state} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "Saving" : "Record observation"}</Button>
    </form>
  );
}
