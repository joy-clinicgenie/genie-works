"use client";

import { useActionState, useMemo, useState } from "react";
import { itemsForTemplate, REPORT_CHECKLIST, REPORT_TEMPLATES, REPORT_TYPES, REPORT_TYPE_LABELS, type ReportTemplateKey, type ReportType } from "@clinic-genie/contracts";
import { submitReportBuilder, type BuilderState } from "@/app/actions/saved-reports";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Input, Select } from "@/components/ui/Field";
import { Card, CardHeader } from "@/components/ui/Card";
import { ReportDocument } from "@/components/modules/ReportDocument";

export interface BuilderDraft {
  id?: string;
  clientId: string;
  websiteId: string;
  reportType: ReportType;
  templateKey: ReportTemplateKey;
  name: string;
  periodStart: string;
  periodEnd: string;
  comparisonStart: string;
  comparisonEnd: string;
  items: string[];
}

export function ReportBuilder({
  draft,
  clients,
  websites,
  preparedBy,
  readOnly,
}: {
  draft: BuilderDraft;
  clients: Array<{ id: string; label: string }>;
  websites: Array<{ id: string; clientId: string; label: string }>;
  preparedBy: string;
  readOnly: boolean;
}) {
  const [state, submit, pending] = useActionState(submitReportBuilder, null as BuilderState);
  const [clientId, setClientId] = useState(draft.clientId);
  const [websiteId, setWebsiteId] = useState(draft.websiteId);
  const [reportType, setReportType] = useState<ReportType>(draft.reportType);
  const [templateKey, setTemplateKey] = useState<ReportTemplateKey>(draft.templateKey);
  const [name, setName] = useState(draft.name);
  const initialMonth = draft.periodStart ? null : previousMonth();
  const initialComparison = initialMonth ? monthBefore(initialMonth.start) : null;
  const [periodStart, setPeriodStart] = useState(draft.periodStart || initialMonth?.start || "");
  const [periodEnd, setPeriodEnd] = useState(draft.periodEnd || initialMonth?.end || "");
  const [comparisonStart, setComparisonStart] = useState(draft.comparisonStart || initialComparison?.start || "");
  const [comparisonEnd, setComparisonEnd] = useState(draft.comparisonEnd || initialComparison?.end || "");
  const [items, setItems] = useState<string[]>(draft.items);
  const [datesTouched, setDatesTouched] = useState(Boolean(draft.periodStart));
  const clientSites = websites.filter((site) => site.clientId === clientId);
  const selected = useMemo(() => new Set(items), [items]);
  const preview = state && state.ok ? state.preview : undefined;

  function applyTemplate(key: ReportTemplateKey) {
    setTemplateKey(key);
    setItems(itemsForTemplate(key));
    const label = REPORT_TEMPLATES.find((item) => item.key === key)?.label ?? "";
    setName((current) => !current.trim() || REPORT_TEMPLATES.some((item) => item.label === current) ? label : current);
  }

  function applyType(next: ReportType) {
    setReportType(next);
    if (datesTouched || draft.id) return;
    const range = next === "quarterly" ? previousQuarter() : next === "monthly" ? previousMonth() : null;
    if (!range) return;
    setPeriodStart(range.start);
    setPeriodEnd(range.end);
    const comparison = next === "quarterly" ? quarterBefore(range.start) : monthBefore(range.start);
    setComparisonStart(comparison.start);
    setComparisonEnd(comparison.end);
  }

  function toggleItem(key: string) {
    setItems((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function toggleGroup(keys: string[], on: boolean) {
    setItems((current) => {
      const rest = current.filter((item) => !keys.includes(item));
      return on ? [...rest, ...keys] : rest;
    });
  }

  return (
    <form action={submit} className="space-y-4">
      {draft.id && <input type="hidden" name="reportId" value={draft.id} />}
      <Card>
        <CardHeader title="1. Select client" description="Choose the clinic, its website, the report type and who prepared it." />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
          <Field label="Report title" htmlFor="name" required>
            <Input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} readOnly={readOnly} />
          </Field>
          {draft.id ? (
            <input type="hidden" name="clientId" value={draft.clientId} />
          ) : (
            <Field label="Client" htmlFor="clientId" required>
              <Select id="clientId" name="clientId" value={clientId} required disabled={readOnly} onChange={(event) => { setClientId(event.target.value); setWebsiteId(""); }}>
                <option value="">Choose a client</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Website" htmlFor="websiteId" required={clientSites.length > 0}>
            <Select id="websiteId" name="websiteId" value={websiteId} disabled={readOnly || clientSites.length === 0} onChange={(event) => setWebsiteId(event.target.value)}>
              <option value="">{clientSites.length ? "Choose a website" : "No website recorded"}</option>
              {clientSites.map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}
            </Select>
          </Field>
          <Field label="Report type" htmlFor="reportType" required>
            <Select id="reportType" name="reportType" value={reportType} disabled={readOnly} onChange={(event) => applyType(event.target.value as ReportType)}>
              {REPORT_TYPES.map((type) => <option key={type} value={type}>{REPORT_TYPE_LABELS[type]}</option>)}
            </Select>
          </Field>
          <Field label="Prepared by" htmlFor="preparedBy">
            <Input id="preparedBy" value={preparedBy} readOnly />
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="2. Choose report template" description="A template selects the usual sections. Any item can be changed before the report is generated." />
        <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
          {REPORT_TEMPLATES.map((template) => (
            <label key={template.key} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${templateKey === template.key ? "border-action bg-brand-pale" : "border-line"}`}>
              <input type="radio" name="templateKey" value={template.key} checked={templateKey === template.key} disabled={readOnly} onChange={() => applyTemplate(template.key)} className="mt-1 accent-action" />
              <span>
                <span className="block text-sm font-medium">{template.label}</span>
                <span className="mt-1 block text-sm text-muted">{template.summary}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="3. Set reporting period" description="The comparison period is optional. Movement is shown only where both periods have a recorded figure." />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
          <Field label="Reporting period starts" htmlFor="periodStart" required>
            <Input id="periodStart" name="periodStart" type="date" value={periodStart} required readOnly={readOnly} onChange={(event) => { setDatesTouched(true); setPeriodStart(event.target.value); }} />
          </Field>
          <Field label="Reporting period ends" htmlFor="periodEnd" required>
            <Input id="periodEnd" name="periodEnd" type="date" value={periodEnd} required readOnly={readOnly} onChange={(event) => { setDatesTouched(true); setPeriodEnd(event.target.value); }} />
          </Field>
          <Field label="Comparison period starts" htmlFor="comparisonStart" hint="Leave both comparison dates blank when there is nothing to compare.">
            <Input id="comparisonStart" name="comparisonStart" type="date" value={comparisonStart} readOnly={readOnly} onChange={(event) => { setDatesTouched(true); setComparisonStart(event.target.value); }} />
          </Field>
          <Field label="Comparison period ends" htmlFor="comparisonEnd">
            <Input id="comparisonEnd" name="comparisonEnd" type="date" value={comparisonEnd} readOnly={readOnly} onChange={(event) => { setDatesTouched(true); setComparisonEnd(event.target.value); }} />
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="4. Select metrics and sections" description="Untick anything this report should leave out. Missing figures stay blank. Clicks are not counted as enquiries." />
        <div className="space-y-5 px-5 pb-5">
          {REPORT_CHECKLIST.map((group) => {
            const keys = group.items.map((item) => item.key);
            const checked = keys.filter((key) => selected.has(key)).length;
            return (
              <fieldset key={group.key} className="border-t border-line/80 pt-4 first:border-t-0 first:pt-0">
                <legend className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    className="size-4 accent-action"
                    checked={checked === keys.length}
                    ref={(node) => { if (node) node.indeterminate = checked > 0 && checked < keys.length; }}
                    disabled={readOnly}
                    onChange={(event) => toggleGroup(keys, event.target.checked)}
                  />
                  {group.label}
                </legend>
                {group.description && <p className="mb-2 pl-6 text-xs text-muted">{group.description}</p>}
                <div className="grid gap-1 pl-6 md:grid-cols-2">
                  {group.items.map((item) => (
                    <label key={item.key} className="flex min-h-11 items-start gap-2 py-1 text-sm">
                      <input type="checkbox" name="items" value={item.key} className="mt-1 size-4 accent-action" checked={selected.has(item.key)} disabled={readOnly} onChange={() => toggleItem(item.key)} />
                      <span>
                        {item.label}
                        {item.hint && <span className="mt-0.5 block text-xs text-muted">{item.hint}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </Card>
      {preview && (
        <Card>
          <CardHeader title="5. Preview report" description="Recorded figures only. A blank cell means the figure is not stored, not that it is zero." />
          <div className="px-5 pb-5">
            <ReportDocument
              name={preview.name}
              clientName={preview.clientName}
              websiteLabel={preview.websiteLabel}
              reportType={preview.reportType}
              preparedBy={preview.preparedBy}
              periodStart={preview.periodStart}
              periodEnd={preview.periodEnd}
              comparisonStart={preview.comparisonStart}
              comparisonEnd={preview.comparisonEnd}
              sections={[]}
              figures={[]}
              summary={null}
              observations={null}
              actionsTaken={null}
              nextSteps={null}
              dataSources={[]}
              dataSourcesNote={null}
              lastRefresh={null}
              missingConnections={[]}
              missingNote={null}
              limitationNote={preview.limitationNote}
              measurementLimitations={null}
              blocks={preview.blocks}
            />
          </div>
        </Card>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" name="intent" value="preview" variant="secondary" disabled={pending}>{pending ? "Working…" : "Preview report"}</Button>
          <Button type="submit" name="intent" value="draft" disabled={pending}>Save draft</Button>
          <Button type="submit" name="intent" value="pdf" variant="secondary" disabled={pending}>Generate PDF</Button>
          {draft.id && <Button type="submit" name="intent" value="review" variant="secondary" disabled={pending}>Save for review</Button>}
          <FormError state={state} />
        </div>
      )}
    </form>
  );
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function singaporeMonth(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month") };
}

function monthRange(year: number, month: number): { start: string; end: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: iso(year, month, 1), end: iso(year, month, last) };
}

function previousMonth(): { start: string; end: string } {
  const { year, month } = singaporeMonth();
  return monthRange(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
}

function monthBefore(start: string): { start: string; end: string } {
  const [year, month] = start.split("-").map(Number);
  return monthRange(month === 1 ? year! - 1 : year!, month === 1 ? 12 : month! - 1);
}

function previousQuarter(): { start: string; end: string } {
  const { year, month } = singaporeMonth();
  const quarter = Math.floor((month - 1) / 3);
  const previous = quarter === 0 ? 3 : quarter - 1;
  const startYear = quarter === 0 ? year - 1 : year;
  const startMonth = previous * 3 + 1;
  return { start: iso(startYear, startMonth, 1), end: monthRange(startYear, startMonth + 2).end };
}

function quarterBefore(start: string): { start: string; end: string } {
  const [year, month] = start.split("-").map(Number);
  const quarter = Math.floor((month! - 1) / 3);
  const previous = quarter === 0 ? 3 : quarter - 1;
  const startYear = quarter === 0 ? year! - 1 : year!;
  const startMonth = previous * 3 + 1;
  return { start: iso(startYear, startMonth, 1), end: monthRange(startYear, startMonth + 2).end };
}
