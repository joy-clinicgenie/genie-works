import Link from "next/link";
import { Building2, FileText, Globe, Inbox, Info } from "lucide-react";
import type { AgencySessionSummary } from "@clinic-genie/db";
import { formatDateTime } from "@clinic-genie/db";
import { DashboardFilters } from "@/components/modules/DashboardFilters";
import { analyticsDashboardHref, type DashboardRangeId } from "@/lib/agency-overview";

const ILLUSTRATIVE = [12, 18, 16, 28, 24, 36, 32, 44, 40, 52];

export interface OverviewDraft {
  id: string;
  name: string;
  clientName: string;
  updatedAt: Date;
}

export function AgencyOverview({
  clients,
  clientId,
  rangeId,
  activeClients,
  linkedWebsites,
  clientsHref,
  websitesHref,
  enquiries,
  enquiryHrefs,
  notificationFailures,
  notificationHref,
  draftCount,
  latestDraft,
  reportsHref,
  reportsUnavailable,
  sessions,
  comparison,
  analyticsHref,
  notices,
}: {
  clients: Array<{ id: string; name: string; referenceNumber: string | null }>;
  clientId: string;
  rangeId: DashboardRangeId;
  activeClients: number | null;
  linkedWebsites: number | null;
  clientsHref: string;
  websitesHref: string;
  enquiries: { connected: true; total: number; counts: { new: number; acknowledged: number; closed: number } } | { connected: false };
  enquiryHrefs: { total: string; new: string; acknowledged: string; closed: string };
  notificationFailures: number | null;
  notificationHref: string | null;
  draftCount: number | null;
  latestDraft: OverviewDraft | null;
  reportsHref: string;
  reportsUnavailable: boolean;
  sessions: AgencySessionSummary;
  comparison: string | null;
  analyticsHref: string;
  notices: string[];
}) {
  const received = enquiries.connected ? enquiries.total : null;
  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[1.65rem] font-semibold tracking-tight text-ink">Agency Overview</h1>
          <p className="mt-1 text-sm text-muted">Your agency at a glance</p>
          <div className="mt-4">
            <DashboardFilters clients={clients} clientId={clientId} rangeId={rangeId} />
          </div>
        </div>
        <p className="text-xs text-muted">Data freshness shown per module</p>
      </header>

      <section aria-label="Agency status" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi href={clientsHref} icon={Building2} label="Active clients" value={activeClients === null ? null : String(activeClients)} hint={activeClients === null ? "Unavailable" : "Current registry"} />
        <Kpi href={websitesHref} icon={Globe} label="Linked websites" value={linkedWebsites === null ? null : String(linkedWebsites)} hint={linkedWebsites === null ? "Unavailable" : "Current registry"} />
        <Kpi href={enquiryHrefs.total} icon={Inbox} label="Enquiries received" value={received === null ? null : String(received)} hint={enquiries.connected ? "Stored submissions" : "Connection required"} />
        <Kpi href={reportsHref} icon={FileText} label="Reports in progress" value={draftCount === null ? null : String(draftCount)} hint={reportsUnavailable ? "Unavailable" : draftCount === 0 ? "Awaiting report records" : "Unfinished drafts"} />
      </section>

      <section className="card" aria-labelledby="website-performance">
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-5">
          <div>
            <h2 id="website-performance" className="text-base font-semibold">Website performance</h2>
            <p className="mt-0.5 text-xs text-muted">Sessions across reporting websites</p>
          </div>
          <Link href={analyticsHref} className="text-sm font-medium text-action hover:underline">View Analytics</Link>
        </div>
        <div className="px-5 pb-5">
          <div className="rounded-2xl bg-surface-muted px-4 py-4">
            <p className="text-sm text-muted">Total website sessions</p>
            <p className="num mt-1 text-3xl font-semibold tracking-tight">{sessionFigure(sessions)}</p>
            {comparison && <p className="mt-1 text-sm text-ink-soft">{comparison}</p>}
            {sessions.state === "partial" && sessions.total !== null && <p className="mt-1 text-xs text-muted">Synchronised websites only.</p>}
            <SessionTrend sessions={sessions} />
            {sessions.fetchedAt && <p className="mt-2 text-xs text-muted">Last synchronised {formatDateTime(sessions.fetchedAt)}</p>}
            {sessions.unconnectedCount > 0 && sessions.total !== null && (
              <p className="mt-1 text-xs text-muted">Websites without a traffic connection are not included.</p>
            )}
          </div>
          <div className="mt-4 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium">Top 3 websites by sessions</h3>
            {sessions.top.length === 0 && <p className="text-xs text-muted">Available after synchronisation</p>}
          </div>
          {sessions.top.length > 0 && (
            <ol className="mt-2 divide-y divide-line/80">
              {sessions.top.map((site) => (
                <li key={site.websiteId}>
                  <Link href={analyticsDashboardHref(rangeId, site.clientId, site.websiteId)} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-action">
                    <span>
                      <span className="font-medium">{site.websiteName}</span>
                      <span className="mt-0.5 block text-xs text-muted">{site.clientName}</span>
                    </span>
                    <span className="num font-semibold">{formatNumber(site.sessions)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card" aria-labelledby="enquiries-heading">
          <div className="flex items-center justify-between px-5 pb-2 pt-5">
            <h2 id="enquiries-heading" className="text-base font-semibold">Enquiries</h2>
            <Inbox className="size-4 text-muted" aria-hidden="true" />
          </div>
          <ul className="px-5 pb-3">
            <EnquiryRow href={enquiryHrefs.new} label="New" value={enquiries.connected ? enquiries.counts.new : null} />
            <EnquiryRow href={enquiryHrefs.acknowledged} label="Acknowledged" value={enquiries.connected ? enquiries.counts.acknowledged : null} />
            <EnquiryRow href={enquiryHrefs.closed} label="Closed" value={enquiries.connected ? enquiries.counts.closed : null} />
            {notificationFailures !== null && notificationFailures > 0 && notificationHref && (
              <EnquiryRow href={notificationHref} label="Notification failures" value={notificationFailures} />
            )}
          </ul>
          {!enquiries.connected && <p className="px-5 pb-5 text-xs text-muted">Connection required. Counts are stored submissions, not clicks or bookings.</p>}
          {enquiries.connected && <p className="px-5 pb-5 text-xs text-muted">Stored submissions for this period. Closed does not mean an appointment.</p>}
        </section>

        <section className="card" aria-labelledby="reports-heading">
          <div className="flex items-center justify-between px-5 pb-2 pt-5">
            <h2 id="reports-heading" className="text-base font-semibold">Reports</h2>
            <FileText className="size-4 text-muted" aria-hidden="true" />
          </div>
          <dl className="px-5">
            <div className="flex items-center justify-between gap-3 py-3 text-sm">
              <dt className="text-muted">Saved drafts</dt>
              <dd className="num font-semibold">{draftCount === null ? "—" : String(draftCount)}</dd>
            </div>
            <div className="flex items-start justify-between gap-3 border-t border-line/80 py-3 text-sm">
              <dt className="text-muted">Recently updated</dt>
              <dd className="text-right">
                {latestDraft ? (
                  <>
                    <span className="block font-medium">{latestDraft.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">{latestDraft.clientName} · {formatDateTime(latestDraft.updatedAt)}</span>
                  </>
                ) : (
                  <span className="num font-semibold">—</span>
                )}
              </dd>
            </div>
          </dl>
          <div className="px-5 pb-5">
            {latestDraft ? (
              <Link href={`/reports/${latestDraft.id}`} className="text-sm font-medium text-action hover:underline">Continue</Link>
            ) : (
              <p className="text-sm text-muted">{reportsUnavailable ? "Unavailable" : "Awaiting report records"}</p>
            )}
            <div className="mt-3">
              <Link href={reportsHref} className="text-sm font-medium text-action hover:underline">Open reports</Link>
            </div>
          </div>
        </section>
      </div>

      {notices.length > 0 && (
        <section className="card flex gap-3 px-5 py-4" aria-labelledby="connection-notice">
          <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
          <div>
            <h2 id="connection-notice" className="text-sm font-semibold">Connection notice</h2>
            {notices.length === 1 ? (
              <p className="mt-1 text-sm text-muted">{notices[0]}</p>
            ) : (
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-muted">
                {notices.map((notice) => <li key={notice}>{notice}</li>)}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({ href, icon: Icon, label, value, hint }: { href: string; icon: typeof Building2; label: string; value: string | null; hint: string }) {
  return (
    <Link href={href} className="card flex h-full flex-col p-5 hover:border-action/40">
      <span className="flex items-center justify-between gap-3 text-sm text-muted">
        {label}
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="num mt-3 text-4xl font-semibold tracking-tight">{value ?? "—"}</span>
      <span className="mt-auto pt-3 text-xs text-muted">{hint}</span>
    </Link>
  );
}

function EnquiryRow({ href, label, value }: { href: string; label: string; value: number | null }) {
  return (
    <li className="border-b border-line/80 last:border-0">
      <Link href={href} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-action">
        <span>{label}</span>
        <span className="num font-semibold">{value === null ? "—" : String(value)}</span>
      </Link>
    </li>
  );
}

function placeholderCaption(sessions: AgencySessionSummary): string {
  if (sessions.state === "not_synchronised") return "Illustrative trend only. Display when this period has been synchronised.";
  if (sessions.state === "unavailable") return "Illustrative trend only. Sessions are unavailable.";
  return "Illustrative trend only. Display when session data is connected.";
}

function sessionFigure(sessions: AgencySessionSummary): string {
  if (sessions.total !== null) return formatNumber(sessions.total);
  if (sessions.websiteCount === 0) return "—";
  if (sessions.state === "not_synchronised") return "Not yet synchronised";
  if (sessions.state === "not_connected") return "Not connected";
  if (sessions.state === "unavailable") return "Unavailable";
  return "Awaiting data";
}

function SessionTrend({ sessions }: { sessions: AgencySessionSummary }) {
  if (sessions.websiteCount === 0) {
    return <p className="mt-4 text-sm text-muted">No websites are recorded.</p>;
  }
  const live = sessions.series && sessions.series.length > 0 ? sessions.series.map((point) => point.value) : null;
  if (!live) {
    return (
      <div className="mt-4">
        <p className="text-sm font-medium text-ink-soft">Awaiting data</p>
        <Trend values={ILLUSTRATIVE} muted label="Illustrative session trend" />
        <p className="mt-2 text-xs text-muted">{placeholderCaption(sessions)}</p>
      </div>
    );
  }
  return (
    <div className="mt-4">
      <Trend values={live} label={`Session trend, ${formatNumber(sessions.total ?? 0)} in this period`} />
    </div>
  );
}

function Trend({ values, muted = false, label }: { values: number[]; muted?: boolean; label: string }) {
  const width = 640;
  const height = 140;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - 12 - (value / max) * (height - 24);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className={`mt-3 h-36 w-full ${muted ? "opacity-50" : ""}`}>
      {[0.25, 0.5, 0.75].map((level) => (
        <line key={level} x1="0" x2={width} y1={height * level} y2={height * level} stroke="#d7e7e9" strokeDasharray="4 6" />
      ))}
      <polyline fill="none" stroke="#136c72" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={points} />
    </svg>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-SG", { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 }).format(value);
}
