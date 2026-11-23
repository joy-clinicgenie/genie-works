import type { ReactNode } from "react";
import Link from "next/link";
import { formatDate, formatDateTime, type AiReport, type ChecklistHealth, type RecentChange, type SearchDay, type SearchReport, type SearchRow } from "@clinic-genie/db";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Table, Td, Th } from "@/components/ui/Table";
import { seoHref, type GoogleControls, type SeoContext } from "@/lib/seo-workspace";
import { Unavailable } from "@/components/modules/seo/SeoFrame";
import { QualityNotices } from "@/components/modules/QualityNotices";

/* SEO Overview cards (D67). Every figure comes from the loader its destination uses, and every link keeps the
   selected website and environment, plus the period where the destination has one. */

function Stat({ label, value, note, href, linkLabel, id }: { label: string; value: ReactNode; note: ReactNode; href: string; linkLabel: string; id: string }) {
  return (
    <div className="rounded-2xl border border-line p-4" data-card={id}>
      <div className="text-xs uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold" data-value>{value}</div>
      <div className="mt-1 text-xs text-muted">{note}</div>
      <Link href={href} className="mt-2 inline-block text-sm text-action hover:underline">{linkLabel}</Link>
    </div>
  );
}

// SEO-01.2 ---------------------------------------------------------------------------------------------------

export function ChecklistHealthPanel({ ctx, health }: { ctx: SeoContext; health: ChecklistHealth }) {
  const { counts, lastCheck } = health;
  const tasks = (tab: string, extra: Record<string, string> = {}) => seoHref("/seo/tasks", ctx, { tab, ...extra });
  return (
    <Card>
      <CardHeader
        title="SEO Checklist & Health"
        description="Setup progress and the Checklist & Tasks queues for this website."
        action={health.next ? <LinkButton href={health.next.href} size="sm">Continue setup</LinkButton> : <Badge tone="good">Setup complete</Badge>}
      />
      <div className="grid gap-3 px-5 pb-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat id="setup" label="Setup" value={`${health.setupPercent}%`} note={`${counts.setupDone} of ${counts.setupTotal} steps complete${health.next ? ` · next: ${health.next.title}` : ""}`} href={tasks("setup")} linkLabel="Open setup checklist" />
        <Stat id="issues" label="Unresolved issues" value={counts.unresolvedIssues} note={lastCheck ? "Found by website checks; includes issues ready to verify." : "No website check has run, so no issue can be found yet."} href={tasks("issues")} linkLabel="Open issues" />
        <Stat id="recommendations" label="New recommendations" value={counts.newRecommendations} note="Suggestions not yet accepted or dismissed." href={tasks("recommendations")} linkLabel="Open recommendations" />
        <Stat id="completed" label="Completed tasks" value={counts.completedTasks} note={`${formatDate(health.completedWindow.start)} to ${formatDate(health.completedWindow.end)}`} href={tasks("completed", { days: String(health.completedWindow.days) })} linkLabel="Open completed tasks" />
      </div>
      <p className="border-t border-line px-5 py-3 text-sm" data-last-check>
        {lastCheck
          ? <>Last website check completed {formatDateTime(lastCheck.finishedAt)}: {lastCheck.completed} page(s) checked, {lastCheck.failed} failed, {lastCheck.skipped} skipped. <Link href={seoHref("/seo/site-health", ctx, { tab: "checks" })} className="text-action hover:underline">Website checks</Link></>
          : <>Website check has not run. <Link href={seoHref("/seo/site-health", ctx, { tab: "checks" })} className="text-action hover:underline">Run a website check</Link></>}
      </p>
    </Card>
  );
}

// SEO-01.3 ---------------------------------------------------------------------------------------------------

const METRICS = [["clicks", "Clicks"], ["impressions", "Impressions"], ["ctr", "CTR"], ["position", "Average position"]] as const;
type Metric = (typeof METRICS)[number][0];

export function formatMetric(metric: Metric, value: number | null): string {
  if (value === null) return "Unavailable";
  if (metric === "ctr") return `${(value * 100).toFixed(1)}%`;
  if (metric === "position") return value.toFixed(1);
  return Math.round(value).toLocaleString("en-SG");
}

function changeText(metric: Metric, current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "No comparison";
  if (metric === "position") return `Previous ${previous.toFixed(1)}`;
  if (previous === 0) return current === 0 ? "No change" : "New";
  const delta = ((current - previous) / previous) * 100;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(0)}% vs previous`;
}

/** Daily bars of one metric. Single series in the action colour; each bar has a tooltip and a table view. */
function SearchTrend({ days, metric }: { days: SearchDay[]; metric: Metric }) {
  const label = METRICS.find(([key]) => key === metric)![1];
  const values = days.map((day) => day[metric]);
  const max = Math.max(...values.map((value) => value ?? 0), metric === "ctr" ? 0.01 : 1);
  const width = 600;
  const height = 120;
  const slot = width / days.length;
  const bar = Math.max(2, Math.min(16, slot - 2));
  return (
    <figure className="px-5 pb-4" data-trend>
      <svg viewBox={`0 0 ${width} ${height + 4}`} role="img" aria-label={`Daily ${label.toLowerCase()}, ${formatDate(days[0]!.date)} to ${formatDate(days.at(-1)!.date)}`} className="h-32 w-full">
        <line x1="0" x2={width} y1={height} y2={height} className="stroke-line" strokeWidth="1" />
        {days.map((day, index) => {
          const value = day[metric];
          const h = value === null ? 0 : Math.max(1, (value / max) * (height - 8));
          return (
            <rect key={day.date} x={index * slot + (slot - bar) / 2} y={height - h} width={bar} height={h} rx={Math.min(4, bar / 2)} className="fill-action hover:opacity-80">
              <title>{`${formatDate(day.date)}: ${formatMetric(metric, value)} ${label.toLowerCase()}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="flex justify-between text-xs text-muted"><span>{formatDate(days[0]!.date)}</span><span>Peak {formatMetric(metric, max)}</span><span>{formatDate(days.at(-1)!.date)}</span></figcaption>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-action">Show daily values as a table</summary>
        <Table caption={`Daily ${label.toLowerCase()}`}>
          <thead><tr><Th>Date</Th><Th>{label}</Th></tr></thead>
          <tbody>{days.map((day) => <tr key={day.date}><Td>{formatDate(day.date)}</Td><Td>{formatMetric(metric, day[metric])}</Td></tr>)}</tbody>
        </Table>
      </details>
    </figure>
  );
}

export function GooglePanel({ ctx, controls, report }: { ctx: SeoContext; controls: GoogleControls; report: SearchReport | null }) {
  const period = { range: controls.range, from: controls.range === "custom" ? controls.from : undefined, to: controls.range === "custom" ? controls.to : undefined };
  const here = (patch: Record<string, string | undefined>) => seoHref("/seo", ctx, { ...period, metric: controls.metric, record: controls.record, ...patch });
  const fullReport = seoHref("/seo/reports", ctx, { tab: "google-search", view: controls.record, ...period });
  const connected = report?.connection.state === "connected";
  const breakdownPart = report ? (controls.record === "queries" ? report.queries : report.pages) : null;
  const breakdown: SearchRow[] = breakdownPart?.status === "available" ? breakdownPart.rows : [];
  return (
    <Card>
      <CardHeader
        title="Google Search Performance"
        description={report?.window
          ? `${formatDate(report.window.start)} to ${formatDate(report.window.end)}, Pacific time · ${report.connection.property ?? ""} · latest reporting date ${report.latestDate ? formatDate(report.latestDate) : "not known"}`
          : "Search Console totals for the selected period."}
        action={<Link href={fullReport} className="text-sm text-action hover:underline">Open full report</Link>}
      />
      <div className="flex flex-wrap gap-2 px-5 pb-3 text-sm" role="group" aria-label="Period">
        {(["7", "30", "90"] as const).map((range) => (
          <Link key={range} href={seoHref("/seo", ctx, { range, metric: controls.metric, record: controls.record })} aria-current={controls.range === range ? "true" : undefined} className={`rounded-full border px-3 py-1 ${controls.range === range ? "border-action bg-brand-pale text-action" : "border-line"}`}>Last {range} days</Link>
        ))}
      </div>
      {!report ? (
        <div className="px-5 pb-5"><Unavailable title="Choose a valid period">Search Console publishes each day after about three days.</Unavailable></div>
      ) : !report.totals ? (
        <div className="px-5 pb-5">
          <Unavailable title={connected ? "Search Console totals are not stored for this period" : "Google Search Console is not connected"}>
            {connected ? "Totals appear after the scheduled sync stores this period, or after staff prepare it in the full report." : <>Clicks, impressions, CTR and position are unavailable. <Link href={seoHref("/seo/settings", ctx, { tab: "connections" })} className="text-action hover:underline">Open Website Connections</Link></>}
          </Unavailable>
        </div>
      ) : (
        <>
          <div className="grid gap-3 px-5 pb-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Metric">
            {METRICS.map(([key, label]) => (
              <Link key={key} href={here({ metric: key })} aria-current={controls.metric === key ? "true" : undefined} data-metric={key} className={`rounded-2xl border p-3 ${controls.metric === key ? "border-action bg-brand-pale" : "border-line"}`}>
                <div className="text-xs uppercase text-muted">{label}</div>
                <div className="mt-1 text-xl font-semibold" data-value>{formatMetric(key, report.totals![key])}</div>
                <div className="text-xs text-muted">{report.previous ? changeText(key, report.totals![key], report.previous.totals[key]) : "Comparison unavailable"}</div>
              </Link>
            ))}
          </div>
          {report.quality.length > 0 && <div className="px-5 pb-3"><QualityNotices notes={report.quality} /></div>}
          {report.daily.status === "available" && report.daily.rows.length > 0
            ? <SearchTrend days={report.daily.rows} metric={controls.metric} />
            : <p className="px-5 pb-4 text-sm text-muted" data-trend-unavailable>Trend unavailable: daily observations are not stored for this period. The totals above are Search Console&apos;s own period totals.</p>}
          <div className="border-t border-line px-5 py-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Breakdown">
              {(["pages", "queries"] as const).map((record) => (
                <Link key={record} href={here({ record })} aria-current={controls.record === record ? "true" : undefined} className={`rounded-full border px-3 py-1 ${controls.record === record ? "border-action bg-brand-pale text-action" : "border-line"}`}>Top {record}</Link>
              ))}
            </div>
            {breakdownPart?.status === "available" ? (
              <ol className="space-y-1 text-sm" data-breakdown>
                {breakdown.slice(0, 5).map((row) => <li key={row.key} className="flex justify-between gap-3"><span className="break-all">{row.key}</span><span className="shrink-0 text-muted">{formatMetric("clicks", row.clicks)} clicks</span></li>)}
                {breakdown.length === 0 && <li className="text-muted">No rows for this period.</li>}
              </ol>
            ) : <p className="text-sm text-muted">{controls.record === "queries" ? "Query" : "Page"} rows are not stored for this period.</p>}
          </div>
        </>
      )}
    </Card>
  );
}

// SEO-01.4 ---------------------------------------------------------------------------------------------------

export function AiPanel({ ctx, report, days }: { ctx: SeoContext; report: AiReport; days: number }) {
  const { activity, figures } = report;
  const link = (anchor: string) => `${seoHref("/seo/ai-visibility", ctx, { tab: "visibility", range: String(days) })}#${anchor}`;
  const updates = [activity.crawlers.lastSuccessAt, activity.referrals.fetchedAt].filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime());
  const value = (n: number | null) => (n === null ? <Badge>Unavailable</Badge> : n);
  return (
    <Card>
      <CardHeader
        title="AI Visibility"
        description={`${formatDate(activity.range.start)} to ${formatDate(activity.range.end)} (last ${days} days, Asia/Singapore). Last available update: ${updates[0] ? formatDateTime(updates[0]) : "none"}.`}
        action={<Link href={seoHref("/seo/reports", ctx, { tab: "ai", range: String(days) })} className="text-sm text-action hover:underline">Open AI report</Link>}
      />
      <div className="grid gap-3 px-5 pb-5">
        <Stat id="crawler" label="AI crawler visits" value={value(figures.crawlerVisits.value)} note={`ChatGPT, Gemini and Claude only. ${figures.crawlerVisits.coverage}`} href={link("crawler-visits")} linkLabel="View crawler records" />
        <Stat id="referrals" label="AI referral sessions" value={value(figures.referralSessions.value)} note={figures.referralSessions.coverage} href={link("referral-sessions")} linkLabel="View referral sessions" />
        <Stat id="mentions" label="Tracked mentions" value={value(figures.trackedMentions.value)} note={figures.trackedMentions.coverage} href={link("tracked-mentions")} linkLabel="View answer tests" />
      </div>
    </Card>
  );
}

// SEO-01.5 ---------------------------------------------------------------------------------------------------

export function QuickActions({ ctx }: { ctx: SeoContext }) {
  const actions = [
    ["Edit page SEO", seoHref("/seo/pages", ctx, { tab: "pages", pick: "settings" })],
    ["Inspect URL", seoHref("/seo/pages", ctx, { tab: "pages", pick: "inspect" })],
    ["View sitemaps", seoHref("/seo/site-health", ctx, { tab: "crawl" })],
    ["View business profiles", seoHref("/seo/business-profile", ctx, { tab: "locations" })],
  ] as const;
  return (
    <Card>
      <CardHeader title="Quick actions" description="Each opens the workflow for this website and environment. Page actions start from the page list." />
      <div className="grid gap-2 px-5 pb-5 sm:grid-cols-2" data-quick-actions>
        {actions.map(([label, href]) => <LinkButton key={label} href={href} variant="secondary">{label}</LinkButton>)}
      </div>
    </Card>
  );
}

// SEO-01.6 ---------------------------------------------------------------------------------------------------

function publishedText(change: RecentChange): string {
  const p = change.published;
  if (p.state === "published") return `Published ${formatDateTime(p.at)}`;
  if (p.state === "waiting") return p.lastFetch ? `Waiting: website last fetched ${formatDateTime(p.lastFetch)}` : "Waiting: website has not fetched settings";
  if (p.state === "no_credential") return "No website credential issued";
  if (p.state === "superseded") return `Replaced by a later edit ${formatDateTime(p.at)}`;
  return change.kind === "content_change" ? "Recorded on the website" : "Not applicable";
}

function liveText(change: RecentChange): string {
  const l = change.live;
  if (l.state === "checked") {
    const result = { matches: "matches", differs: "differs from saved", failed: "check failed", observed: "observed", staff_verified: "verified by staff" }[l.result];
    return `Live checked ${l.result === "staff_verified" ? formatDate(l.at.toISOString().slice(0, 10)) : formatDateTime(l.at)}: ${result}`;
  }
  if (l.state === "superseded") return "Not checked before a later edit";
  if (l.state === "not_applicable") return "Not applicable";
  return "Live verification pending";
}

export function RecentChanges({ ctx, changes }: { ctx: SeoContext; changes: RecentChange[] }) {
  return (
    <Card>
      <CardHeader title="Recent changes" description="The five newest page edits, with the evidence for each stage." action={<Link href={seoHref("/seo/reports", ctx, { tab: "work" })} className="text-sm text-action hover:underline">All recorded changes</Link>} />
      {changes.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No page edit is recorded for this website.</p> : (
        <ol className="divide-y divide-line" data-recent-changes>
          {changes.map((change) => (
            <li key={`${change.kind}-${change.id}`} className="space-y-1 px-5 py-3 text-sm" data-change={change.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {change.pageId
                  ? <Link href={seoHref(`/seo/pages/${change.pageId}`, ctx)} className="break-all font-medium text-action hover:underline">{change.pagePath}</Link>
                  : <span className="break-all font-medium">{change.pagePath}</span>}
                <span className="text-xs text-muted">{change.actor ?? "Unknown"} · {formatDateTime(change.saved)}</span>
              </div>
              <p>{change.summary}</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <li data-stage="saved">Saved {formatDateTime(change.saved)}</li>
                <li data-stage="published">{publishedText(change)}</li>
                <li data-stage="live">{liveText(change)}</li>
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export function DemoNote({ children }: { children: ReactNode }) {
  return <Unavailable title="Demo data">{children} Nothing on this screen is saved, crawled or sent to Google.</Unavailable>;
}
