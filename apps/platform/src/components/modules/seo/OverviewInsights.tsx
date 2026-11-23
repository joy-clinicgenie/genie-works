import type { ReactNode } from "react";
import Link from "next/link";
import { AI_PROVIDER_LABELS, formatDate, todaySgt, type LatestCrawl, type SearchChanges, type SearchDay, type SearchReport } from "@clinic-genie/db";
import { Table, Td, Th } from "@/components/ui/Table";
import { seoHref, type GoogleControls, type SeoContext } from "@/lib/seo-workspace";

/* SEO Overview row 3 (D76): Site performance on Google (2/3) beside Gen AI Visibility (1/3). Both read stored data
   only; where it is missing they show a compact empty state instead of a figure. */

export const OVERVIEW_METRICS = [["impressions", "Impressions"], ["clicks", "Clicks"]] as const;
export type OverviewMetric = (typeof OVERVIEW_METRICS)[number][0];
export const OVERVIEW_RANGES = [["7"], ["30"], ["90"]] as const;

function count(value: number | null): string {
  return value === null ? "–" : Math.round(value).toLocaleString("en-SG");
}

/** A small "not available" note that keeps the panel compact. */
export function CompactEmpty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-muted px-4 py-3 text-sm" data-empty>
      <div className="font-medium text-ink">{title}</div>
      <p className="mt-0.5 text-muted">{children}</p>
    </div>
  );
}

function Segmented({ label, items }: { label: string; items: Array<{ key: string; label: ReactNode; href: string; current: boolean }> }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface-muted p-1">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          scroll={false}
          aria-current={item.current ? "true" : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors ${item.current ? "bg-white text-ink shadow-[0_1px_3px_rgba(23,60,64,0.12)]" : "text-ink-soft hover:bg-white/70 hover:text-ink"}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

/** Daily bars of one metric in the action colour, each with a tooltip, plus the same values as a table. */
function Trend({ days, metric }: { days: SearchDay[]; metric: OverviewMetric }) {
  const label = OVERVIEW_METRICS.find(([key]) => key === metric)![1];
  const max = Math.max(...days.map((day) => day[metric] ?? 0), 1);
  const width = 600;
  const height = 140;
  const slot = width / days.length;
  const bar = Math.max(2, Math.min(18, slot - 3));
  return (
    <figure data-trend={metric}>
      <svg viewBox={`0 0 ${width} ${height + 4}`} role="img" aria-label={`Daily ${label.toLowerCase()}, ${formatDate(days[0]!.date)} to ${formatDate(days.at(-1)!.date)}`} className="h-36 w-full">
        <line x1="0" x2={width} y1={height} y2={height} className="stroke-line" strokeWidth="1" />
        {days.map((day, index) => {
          const value = day[metric];
          const h = value === null ? 0 : Math.max(1, (value / max) * (height - 8));
          return (
            <rect key={day.date} x={index * slot + (slot - bar) / 2} y={height - h} width={bar} height={h} rx={Math.min(5, bar / 2)} className="fill-action hover:opacity-80">
              <title>{`${formatDate(day.date)}: ${count(value)} ${label.toLowerCase()}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="flex justify-between text-xs text-muted"><span>{formatDate(days[0]!.date)}</span><span>Peak {count(max)}</span><span>{formatDate(days.at(-1)!.date)}</span></figcaption>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-action">Show daily values as a table</summary>
        <Table caption={`Daily ${label.toLowerCase()}`}>
          <thead><tr><Th>Date</Th><Th align="right">{label}</Th></tr></thead>
          <tbody>{days.map((day) => <tr key={day.date}><Td>{formatDate(day.date)}</Td><Td align="right">{count(day[metric])}</Td></tr>)}</tbody>
        </Table>
      </details>
    </figure>
  );
}

export function GooglePerformancePanel({ ctx, controls, metric, report, changes }: { ctx: SeoContext; controls: GoogleControls; metric: OverviewMetric; report: SearchReport | null; changes: SearchChanges | null }) {
  const state = { range: controls.range, metric, record: controls.record, direction: controls.direction };
  const here = (patch: Partial<typeof state>) => seoHref("/seo", ctx, { ...state, ...patch });
  const connected = report?.connection.state === "connected";
  const recordLabel = controls.record === "queries" ? "queries" : "pages";
  const list = changes?.status === "available" ? (controls.direction === "increased" ? changes.increased : changes.decreased) : [];
  return (
    <section className="card p-5" aria-labelledby="seo-google-title" data-google-panel>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="seo-google-title" className="text-base font-semibold leading-tight tracking-tight">Site performance on Google</h2>
          <p className="mt-1 text-sm text-muted" data-google-source>
            Source: Google Search Console{report?.connection.property ? ` · ${report.connection.property}` : ""} · Latest reporting date: {report?.latestDate ? formatDate(report.latestDate) : "not available"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={seoHref("/seo/reports", ctx, { tab: "google-search", range: controls.range })} className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-action hover:underline">Open full report</Link>
          <Segmented label="Date range" items={OVERVIEW_RANGES.map(([key]) => ({ key, label: <><span className="hidden sm:inline">Last&nbsp;</span>{key}&nbsp;days</>, href: here({ range: key }), current: controls.range === key }))} />
        </div>
      </header>

      <h3 className="mt-5 text-sm font-semibold">Total performance over time</h3>
      {!report || !report.totals ? (
        <div className="mt-3">
          <CompactEmpty title={connected ? "No Search Console totals are stored for this period" : "Google Search Console is not connected"}>
            {connected
              ? "They appear after the scheduled sync stores this period."
              : <>Connect it in <Link href={seoHref("/seo/settings", ctx, { tab: "connections" })} className="text-action hover:underline">Settings &amp; Connections</Link>.</>}
          </CompactEmpty>
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Metric">
            {OVERVIEW_METRICS.map(([key, label]) => (
              <Link
                key={key}
                href={here({ metric: key })}
                scroll={false}
                aria-current={metric === key ? "true" : undefined}
                data-metric={key}
                className={`rounded-2xl p-3 transition-colors ${metric === key ? "bg-brand-pale shadow-[inset_0_0_0_1px_var(--color-brand-pale-strong)]" : "bg-surface-muted hover:bg-brand-pale/60"}`}
              >
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</div>
                <div className="mt-1 text-2xl font-semibold num" data-value>{count(report.totals![key])}</div>
                {report.previous && <div className="text-xs text-muted">Previous period {count(report.previous.totals[key])}</div>}
              </Link>
            ))}
          </div>
          <div className="mt-4">
            {report.daily.status === "available" && report.daily.rows.length > 0
              ? <Trend days={report.daily.rows} metric={metric} />
              : <CompactEmpty title="Trend not available">Daily figures are not stored for this period. The totals above are Search Console&apos;s own period totals.</CompactEmpty>}
          </div>
        </>
      )}

      <div className="mt-5 border-t border-line pt-4" data-changes>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Most significant changes</h3>
          <div className="flex flex-wrap gap-2">
            <Segmented label="Breakdown" items={(["pages", "queries"] as const).map((record) => ({ key: record, label: record === "pages" ? "Pages" : "Queries", href: here({ record }), current: controls.record === record }))} />
            <Segmented label="Direction" items={(["increased", "decreased"] as const).map((direction) => ({ key: direction, label: direction === "increased" ? "Increased" : "Decreased", href: here({ direction }), current: controls.direction === direction }))} />
          </div>
        </div>
        <div className="mt-3">
          {!changes || changes.status !== "available" ? (
            <CompactEmpty title="Changes not available">
              {changes?.missing === "previous"
                ? `The ${recordLabel} report for the period before is not stored, so there is nothing to compare.`
                : `The ${recordLabel} report for this period is not stored.`}
            </CompactEmpty>
          ) : list.length === 0 ? (
            <CompactEmpty title={`No ${controls.direction} ${recordLabel}`}>No {recordLabel} listed in both periods {controls.direction === "increased" ? "gained" : "lost"} {metric}.</CompactEmpty>
          ) : (
            <ol className="space-y-1.5 text-sm" data-change-list>
              {list.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2">
                  <span className="min-w-0 break-all">{row.key}</span>
                  <span className="shrink-0 text-right num">
                    <span className={`font-semibold ${row.change > 0 ? "text-good" : "text-bad"}`}>{row.change > 0 ? "▲ +" : "▼ −"}{count(Math.abs(row.change))}</span>
                    <span className="ml-1 text-xs text-muted">{metric} ({count(row.previous)} → {count(row.current)})</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {changes?.status === "available" && <p className="mt-2 text-xs text-muted">Compared with {formatDate(changes.previousWindow.start)} to {formatDate(changes.previousWindow.end)}, for {recordLabel} listed in both periods.</p>}
        </div>
      </div>
    </section>
  );
}

function crawlText(crawl: LatestCrawl): string {
  if (crawl.state === "no_source") return "Not connected";
  if (crawl.state === "not_measured") return "Not measured";
  // The crawl day on the Asia/Singapore calendar (D8).
  return crawl.lastCrawledAt ? formatDate(todaySgt(crawl.lastCrawledAt)) : "No crawl recorded";
}

export function GenAiVisibilityPanel({ ctx, crawls }: { ctx: SeoContext; crawls: LatestCrawl[] }) {
  return (
    <section className="card p-5" aria-labelledby="seo-ai-title" data-ai-panel>
      <header>
        <h2 id="seo-ai-title" className="text-base font-semibold leading-tight tracking-tight">Gen AI Visibility</h2>
        <p className="mt-1 text-sm text-muted" data-ai-period>Last 30 days</p>
      </header>

      <h3 className="mt-5 text-sm font-semibold">Last crawled by platform</h3>
      <ul className="mt-2 space-y-1.5" data-crawls>
        {crawls.map((crawl) => (
          <li key={crawl.provider} className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 text-sm" data-crawl={crawl.provider}>
            <span className="font-medium">{AI_PROVIDER_LABELS[crawl.provider]}</span>
            <span className={`shrink-0 text-right ${crawl.lastCrawledAt ? "num" : "text-muted"}`}>{crawlText(crawl)}</span>
          </li>
        ))}
      </ul>
      {crawls.every((crawl) => crawl.state === "no_source") && (
        <p className="mt-2 text-xs text-muted">No crawl log source is connected for this website.</p>
      )}

      <div className="mt-5 space-y-3">
        <div>
          <h3 className="mb-2 text-sm font-semibold">User queries on AI by page</h3>
          <CompactEmpty title="No data source">Crawl activity cannot show the questions people ask.</CompactEmpty>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">ChatGPT visibility score</h3>
          <CompactEmpty title="No data source">Crawl activity cannot establish a visibility score.</CompactEmpty>
        </div>
      </div>

      <Link href={seoHref("/seo/ai-visibility", ctx, { tab: "visibility", range: "30" })} className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-action hover:underline">
        Go to AI Visibility Overview
      </Link>
    </section>
  );
}
