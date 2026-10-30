"use client";

import { useActionState } from "react";
import { REPORT_SECTIONS } from "@clinic-genie/contracts";
import { createSavedReportAction, duplicateSavedReportAction, saveSavedReportAction } from "@/app/actions/saved-reports";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, FormError, Input, Select, Textarea } from "@/components/ui/Field";
import { Card, CardHeader } from "@/components/ui/Card";

export interface ReportDraft {
  id?: string;
  clientId: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  comparisonStart: string;
  comparisonEnd: string;
  sections: string[];
  summary: string;
  observations: string;
  actionsTaken: string;
  nextSteps: string;
  dataSourcesNote: string;
  missingConnections: string;
  measurementLimitations: string;
}

export function SavedReportEditor({
  draft,
  clients,
  readOnly,
  includeNotes = true,
}: {
  draft: ReportDraft;
  clients: Array<{ id: string; label: string }>;
  readOnly: boolean;
  includeNotes?: boolean;
}) {
  const action = draft.id ? saveSavedReportAction : createSavedReportAction;
  const [state, submit, pending] = useActionState(action, null);
  return (
    <form action={submit} className="space-y-4">
      {draft.id && <input type="hidden" name="reportId" value={draft.id} />}
      <Card>
        <CardHeader title="Report setup" description="Choose the reporting period, an optional comparison period, and the sections to include." />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
          <Field label="Report name" htmlFor="name" required>
            <Input id="name" name="name" defaultValue={draft.name} required maxLength={160} readOnly={readOnly} />
          </Field>
          {draft.id ? (
            <input type="hidden" name="clientId" value={draft.clientId} />
          ) : (
            <Field label="Client" htmlFor="clientId" required>
              <Select id="clientId" name="clientId" defaultValue={draft.clientId} required disabled={readOnly}>
                <option value="">Choose a client</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Reporting period starts" htmlFor="periodStart" required>
            <Input id="periodStart" name="periodStart" type="date" defaultValue={draft.periodStart} required readOnly={readOnly} />
          </Field>
          <Field label="Reporting period ends" htmlFor="periodEnd" required>
            <Input id="periodEnd" name="periodEnd" type="date" defaultValue={draft.periodEnd} required readOnly={readOnly} />
          </Field>
          <Field label="Comparison period starts" htmlFor="comparisonStart" hint="Leave both comparison dates blank when there is nothing to compare.">
            <Input id="comparisonStart" name="comparisonStart" type="date" defaultValue={draft.comparisonStart} readOnly={readOnly} />
          </Field>
          <Field label="Comparison period ends" htmlFor="comparisonEnd">
            <Input id="comparisonEnd" name="comparisonEnd" type="date" defaultValue={draft.comparisonEnd} readOnly={readOnly} />
          </Field>
          <fieldset className="md:col-span-2">
            <legend className="mb-2 text-sm font-medium">Report sections</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {REPORT_SECTIONS.map((section) => (
                <Checkbox key={section.key} name="sections" value={section.key} defaultChecked={draft.sections.includes(section.key)} label={section.label} disabled={readOnly} />
              ))}
            </div>
          </fieldset>
        </div>
      </Card>
      {includeNotes && (
        <>
          <Card>
            <CardHeader title="Written commentary" description="Summary, observations, actions taken and proposed next steps." />
            <div className="grid gap-4 px-5 pb-5">
              <Field label="Summary" htmlFor="summary"><Textarea id="summary" name="summary" defaultValue={draft.summary} maxLength={4000} readOnly={readOnly} /></Field>
              <Field label="Observations" htmlFor="observations"><Textarea id="observations" name="observations" defaultValue={draft.observations} maxLength={4000} readOnly={readOnly} /></Field>
              <Field label="Actions taken" htmlFor="actionsTaken"><Textarea id="actionsTaken" name="actionsTaken" defaultValue={draft.actionsTaken} maxLength={4000} readOnly={readOnly} /></Field>
              <Field label="Proposed next steps" htmlFor="nextSteps"><Textarea id="nextSteps" name="nextSteps" defaultValue={draft.nextSteps} maxLength={4000} readOnly={readOnly} /></Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Data notes" description="Add a note where the recorded sources, refresh time, missing connections or limitations need an explanation. The preview fills the recorded facts." />
            <div className="grid gap-4 px-5 pb-5">
              <Field label="Data sources" htmlFor="dataSourcesNote" hint="The preview lists sources found for the chosen periods.">
                <Textarea id="dataSourcesNote" name="dataSourcesNote" defaultValue={draft.dataSourcesNote} maxLength={2000} readOnly={readOnly} />
              </Field>
              <Field label="Missing connections" htmlFor="missingConnections" hint="The preview lists exports that have no figures for these periods.">
                <Textarea id="missingConnections" name="missingConnections" defaultValue={draft.missingConnections} maxLength={2000} readOnly={readOnly} />
              </Field>
              <Field label="Measurement limitations" htmlFor="measurementLimitations">
                <Textarea id="measurementLimitations" name="measurementLimitations" defaultValue={draft.measurementLimitations} maxLength={2000} readOnly={readOnly} />
              </Field>
            </div>
          </Card>
        </>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : draft.id ? "Save" : "Create"}</Button>
          <FormError state={state} />
        </div>
      )}
    </form>
  );
}

export function DuplicateReport({ reportId }: { reportId: string }) {
  const [state, submit, pending] = useActionState(duplicateSavedReportAction, null);
  return (
    <form action={submit}>
      <input type="hidden" name="reportId" value={reportId} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Duplicating…" : "Duplicate"}</Button>
      <FormError state={state} />
    </form>
  );
}
