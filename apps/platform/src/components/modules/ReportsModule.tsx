import { canEditClient, comparePeriods, formatDateTime, formatPeriod, listPeriods, listReportNotes, listSnapshots, type AccessProfile, type PoolClient } from "@clinic-genie/db";
import { REPORT_CHANNELS, REPORT_SOURCES } from "@clinic-genie/contracts";
import { Card, CardHeader } from "@/components/ui/Card";
import { FilterBar, FilterSelect } from "@/components/ui/Filters";
import { ComparisonTable, SnapshotTable } from "@/components/modules/ReportViews";
import { ReportCatalogue } from "@/components/modules/ReportCatalogue";
import { ObservationForm, SnapshotForm } from "@/components/modules/ReportForms";
import { Notice } from "@/components/ui/Notice";
import { label } from "@/components/ui/Badge";

export interface ReportParams {
  source?: string;
  channel?: string;
  current?: string;
  previous?: string;
  history?: string;
}

/** Shared by /reports?client= and the client Reports tab. */
export async function ReportsModule({ db, access, clientId, params, action }: { db: PoolClient; access: AccessProfile; clientId: string; params: ReportParams; action: string }) {
  const source = params.source || "clinic_records";
  const channel = params.channel || "all";
  const periods = await listPeriods(db, clientId, source, channel);
  const parse = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(v) ? { start: v.slice(0, 10), end: v.slice(11) } : null);
  const current = parse(params.current) ?? periods[0] ?? null;
  const previous = parse(params.previous) ?? periods.find((p) => p.start !== current?.start || p.end !== current?.end) ?? null;
  const comparison = current && previous ? await comparePeriods(db, clientId, { source, channel, current, previous }) : null;
  const snapshots = await listSnapshots(db, { clientId, includeSuperseded: params.history === "1" });
  const notes = await listReportNotes(db, { clientId });
  const canEdit = canEditClient(access, clientId);
  const periodOptions = periods.map((p) => ({ value: `${p.start}_${p.end}`, label: formatPeriod(p.start, p.end, " to ") }));
  return (
    <>
      <ReportCatalogue />
      <FilterBar action={action}>
        <input type="hidden" name="client" value={clientId} />
        <FilterSelect name="source" label="Source" value={source} allLabel="Clinic records" options={REPORT_SOURCES.filter((s) => s !== "clinic_records").map((s) => ({ value: s, label: label(s) }))} />
        <FilterSelect name="channel" label="Channel" value={channel} allLabel="All channels" options={REPORT_CHANNELS.filter((c) => c !== "all").map((c) => ({ value: c, label: label(c) }))} />
        <FilterSelect name="current" label="Current period" value={current ? `${current.start}_${current.end}` : undefined} allLabel="Latest" options={periodOptions} />
        <FilterSelect name="previous" label="Compare with" value={previous ? `${previous.start}_${previous.end}` : undefined} allLabel="Previous recorded" options={periodOptions} />
      </FilterBar>
      <Card>
        <CardHeader title="Period comparison" description={`${label(source)}, ${label(channel)}. Clicks, enquiries and confirmed appointments are separate metrics and never combined.`} />
        <div className="px-5 pb-5">
          {!comparison ? <Notice tone="neutral">Record figures for at least two periods with the same source and channel to compare them.</Notice> : (
            <>
              {!comparison.likeForLike && <div className="mb-3"><Notice tone="warn" title="Not like-for-like">{comparison.lengthNote}</Notice></div>}
              <ComparisonTable comparison={comparison} />
            </>
          )}
        </div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2 mt-6">
        <Card>
          <CardHeader title="Observations" description="What the numbers show, kept apart from possible explanations." />
          <ul className="divide-y divide-line">
            {notes.length === 0 && <li className="px-5 py-3 text-sm text-muted">No observations yet.</li>}
            {notes.map((n) => (
              <li key={n.id} className="px-5 py-3 text-sm">
                <div className="text-xs text-muted">{formatPeriod(n.period_start, n.period_end, " to ")} · {n.author_name}, {formatDateTime(n.created_at)}</div>
                <p className="mt-1 whitespace-pre-wrap"><span className="font-semibold">Observed:</span> {n.observation}</p>
                {n.possible_explanations && <p className="mt-1 whitespace-pre-wrap text-ink-soft"><span className="font-semibold">Possible explanations:</span> {n.possible_explanations}</p>}
              </li>
            ))}
          </ul>
          {canEdit && <div className="px-5 pb-5"><ObservationForm clientId={clientId} periodStart={current?.start} periodEnd={current?.end} /></div>}
        </Card>
        {canEdit && <Card><CardHeader title="Record a figure" description="Each figure is an immutable snapshot of one metric for one period." /><div className="px-5 pb-5"><SnapshotForm clientId={clientId} /></div></Card>}
      </div>
      <Card className="mt-6">
        <CardHeader title="Recorded snapshots" action={<a href={`${action}?client=${clientId}&source=${source}&channel=${channel}&history=${params.history === "1" ? "0" : "1"}`} className="text-sm text-action hover:underline">{params.history === "1" ? "Hide superseded" : "Show superseded"}</a>} />
        <SnapshotTable snapshots={snapshots} />
      </Card>
    </>
  );
}
