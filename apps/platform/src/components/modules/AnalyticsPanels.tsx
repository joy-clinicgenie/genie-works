import type { ReactNode } from "react";
import Link from "next/link";
import { formatDateTime } from "@clinic-genie/db";
import { formatCount, formatDuration, formatMove, formatPercentPoint } from "@/lib/site-metrics";
import type { AnalyticsBoard, AnalyticsFigure, AnalyticsTrend, ChannelRow, LandingRow, PageRow } from "@/lib/analytics-board";
import type { BreakdownLinks } from "@/lib/report-link";
import { NavigationFlows } from "@/components/modules/NavigationFlows";

const OVERVIEW_CARDS = [
  { key: "sessions", label: "Sessions", meaning: "A visit to the site. One person can have more than one session." },
  { key: "users", label: "Total users", meaning: "People who visited. This is not the same measure as a session." },
  { key: "leads", label: "Total leads", meaning: "Stored enquiries. Contact clicks are counted separately." },
  { key: "conversionRate", label: "Visitor-to-lead conversion rate", meaning: "Stored enquiries divided by visitors." },
  { key: "engagementRate", label: "Engagement rate", meaning: "Shown only when the export records an engagement rate." },
  { key: "organic", label: "Organic traffic", meaning: "Sessions from organic search. This is not Search Console clicks." },
] as const;

const CURRENT = "#136c72";
const PREVIOUS = "#8fd4d8";

export function analyticsHrefs(clientId: string, clientSlug: string, websiteId: string | null) {
  const seo = new URLSearchParams({ client: clientId });
  if (websiteId) seo.set("website", websiteId);
  return {
    leadsHref: `/enquiries?clinic=${encodeURIComponent(clientSlug)}`,
    seoHref: `/seo?${seo.toString()}`,
  };
}

function figureText(figure: AnalyticsFigure): string {
  if (figure.unit === "percent") return formatPercentPoint(figure.current);
  if (figure.unit === "duration") return formatDuration(figure.current);
  return formatCount(figure.current);
}

function shareOf(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return Number(((part / whole) * 100).toFixed(1));
}

function Delta({ percent, suffix }: { percent: number | null; suffix?: string }) {
  if (percent === null) return null;
  if (percent === 0) return <span className="text-xs text-muted">No change</span>;
  const down = percent < 0;
  return (
    <span className="inline-flex items-baseline gap-1 text-xs">
      <span className={`font-semibold ${down ? "text-bad" : "text-good"}`}>
        <span className="sr-only">{down ? "Down " : "Up "}</span>
        {formatMove(percent)}
      </span>
      {suffix && <span className="text-muted">{suffix}</span>}
    </span>
  );
}

function MetricStrip({ label, cells, href }: { label: string; cells: Array<{ key: string; label: string; figure: AnalyticsFigure; meaning: string }>; href?: string }) {
  const columns = cells.length >= 6 ? "md:grid-cols-3 xl:grid-cols-6" : cells.length === 4 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3";
  return (
    <section className="card min-w-0 overflow-hidden" aria-label={label}>
      <h2 className="sr-only">{label}</h2>
      <div className={`grid grid-cols-2 gap-px bg-line ${columns}`}>
        {cells.map((cell) => {
          const missing = cell.figure.current === null;
          return (
            <div key={cell.key} className="bg-surface px-5 py-4" title={cell.meaning}>
              <p className="text-xs text-muted">{cell.label}</p>
              <p className={missing ? "mt-2 text-lg font-semibold text-ink-soft" : "num mt-2 text-3xl font-semibold tracking-tight"}>{figureText(cell.figure)}</p>
              <p className="mt-1 min-h-4"><Delta percent={cell.figure.percent} suffix="vs previous period" /></p>
              <p className="sr-only">{cell.meaning}</p>
            </div>
          );
        })}
      </div>
      {href && <div className="border-t border-line bg-surface px-5 py-3 text-right"><PanelLink href={href} /></div>}
    </section>
  );
}

function SourceLine({ board, leadsHref, seoHref }: { board: AnalyticsBoard; leadsHref: string; seoHref: string }) {
  return (
    <p className="text-sm text-muted">
      {board.sourceNote}
      {board.updatedAt ? ` Last recorded ${formatDateTime(board.updatedAt)}.` : ""}
      {" "}
      <Link href={leadsHref} className="font-semibold text-action hover:underline">Leads and forms</Link>
      {" · "}
      <Link href={seoHref} className="font-semibold text-action hover:underline">SEO</Link>
    </p>
  );
}

function PanelLink({ href }: { href: string }) {
  return <Link href={href} className="shrink-0 text-sm font-semibold text-action hover:underline">Open the full breakdown</Link>;
}

function Panel({ title, note, aside, children }: { title: string; note?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card flex min-w-0 flex-col">
      <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {note && <p className="mt-1 text-xs text-muted">{note}</p>}
        </div>
        {aside}
      </header>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

function Legend({ showPrevious }: { showPrevious: boolean }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: CURRENT }} /> This period</span>
      {showPrevious && <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: PREVIOUS }} /> Previous period</span>}
    </div>
  );
}

function BarsChart({ points, ariaLabel, mode }: { points: Array<{ label: string; current: number | null; previous: number | null }>; ariaLabel: string; mode: "paired" | "periods" | "single" }) {
  const paired = mode === "paired";
  const drawn = points.some((point) => point.current !== null || (paired && point.previous !== null));
  if (!drawn) return <p className="px-5 pb-5 text-sm text-muted">Not recorded.</p>;
  const width = 720;
  const height = 232;
  const plot = { left: 12, right: 664, top: 12, bottom: 196 };
  const values = points.flatMap((point) => [point.current, paired ? point.previous : null]).filter((value): value is number => value !== null);
  const peak = Math.max(...values, 1);
  const yAt = (value: number) => plot.bottom - (value / (peak * 1.12)) * (plot.bottom - plot.top);
  const slot = (plot.right - plot.left) / Math.max(points.length, 1);
  const barWidth = paired ? Math.min(10, slot * 0.28) : Math.min(points.length <= 3 ? 56 : 22, slot * 0.46);
  const ticks = [0, Math.round(peak / 2), peak];
  const labelEvery = points.length <= 8 ? 1 : points.length <= 16 ? 2 : points.length <= 45 ? 7 : 14;
  return (
    <div className="px-3 pb-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-60 w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={plot.left} x2={plot.right} y1={yAt(tick)} y2={yAt(tick)} stroke="#d7e7e9" />
            <text x={width - 8} y={yAt(tick) + 4} textAnchor="end" fill="#5b7479" fontSize="11">{formatCount(tick)}</text>
          </g>
        ))}
        <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke="#d7e7e9" />
        {points.map((point, index) => {
          const center = plot.left + slot * index + slot / 2;
          const bars = paired
            ? [
                { value: point.previous, fill: PREVIOUS, x: center - barWidth - 1 },
                { value: point.current, fill: CURRENT, x: center + 1 },
              ]
            : [{ value: point.current, fill: mode === "periods" && index === 0 ? PREVIOUS : CURRENT, x: center - barWidth / 2 }];
          const showLabel = index % labelEvery === 0 || index === points.length - 1;
          return (
            <g key={`${point.label}-${index}`}>
              {bars.map((bar) => {
                if (bar.value === null) return null;
                const y = yAt(bar.value);
                return <rect key={bar.fill + bar.x} x={bar.x} y={y} width={barWidth} height={Math.max(plot.bottom - y, 0)} rx="3" fill={bar.fill} />;
              })}
              {showLabel && (
                <text x={center} y={height - 8} textAnchor="middle" fill="#5b7479" fontSize="11">{point.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead><tr><th>Point</th><th>This period</th>{paired && <th>Previous period</th>}</tr></thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}><td>{point.label}</td><td>{formatCount(point.current)}</td>{paired && <td>{formatCount(point.previous)}</td>}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendChart({ trend }: { trend: AnalyticsTrend }) {
  const paired = trend.mode === "daily" && trend.points.some((point) => point.previous !== null);
  return (
    <BarsChart
      points={trend.points}
      mode={paired ? "paired" : trend.mode === "period" ? "periods" : "single"}
      ariaLabel={paired ? "Sessions by day, with the previous period aligned by day" : "Sessions for the previous and current periods"}
    />
  );
}

function MixPanel({ title, href, rows, progress, empty }: {
  title: string;
  href?: string;
  rows: Array<{ name: string; value: number | null; share: number | null; percent?: number | null }>;
  progress?: { label: string; value: number | null };
  empty: string;
}) {
  const recorded = rows.some((row) => row.value !== null && row.value > 0);
  const max = Math.max(...rows.map((row) => row.value ?? 0), 1);
  return (
    <Panel title={title} aside={href ? <PanelLink href={href} /> : undefined}>
      {!recorded ? <p className="px-5 pb-5 text-sm text-muted">{empty}</p> : (
        <ul className="space-y-3 px-5 pb-2">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">{row.name}</span>
                <span className="inline-flex shrink-0 items-baseline gap-1.5">
                  <span className="num">{row.share !== null ? formatPercentPoint(row.share) : formatCount(row.value)}</span>
                  {row.percent !== undefined && <Delta percent={row.percent} />}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-brand-pale" aria-hidden="true">
                <div className="h-full rounded-full bg-action" style={{ width: `${Math.max(row.value ? 6 : 0, ((row.value ?? 0) / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {progress && progress.value !== null && (
        <div className="mt-auto px-5 pt-3 pb-5">
          <div className="flex items-baseline justify-between gap-3 text-xs text-muted">
            <span>{progress.label}</span>
            <span className="num font-semibold text-ink">{formatPercentPoint(progress.value)}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-brand-pale" role="img" aria-label={`${progress.label} ${formatPercentPoint(progress.value)}`}>
            <div className="h-full rounded-full bg-action" style={{ width: `${Math.min(100, Math.max(progress.value, 0))}%` }} />
          </div>
        </div>
      )}
    </Panel>
  );
}

function ReportTable({ caption, columns, rows }: {
  caption: string;
  columns: string[];
  rows: Array<{ key: string; cells: ReactNode[] }>;
}) {
  return (
    <div className="overflow-x-auto" tabIndex={0} aria-label={caption}>
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={column} scope="col" className={`border-b border-line px-5 py-3 text-xs font-medium text-muted ${index === 0 ? "text-left" : "text-right"}`}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) => (
                <td key={columns[index]} className={`border-b border-line/70 px-5 py-3.5 ${index === 0 ? "max-w-[16rem] truncate font-medium text-action" : "num text-right"}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Amount({ value, percent }: { value: string; percent?: number | null }) {
  return (
    <span className="inline-flex items-baseline justify-end gap-1.5">
      <span>{value}</span>
      {percent !== undefined && <Delta percent={percent} />}
    </span>
  );
}

function ChannelTable({ rows }: { rows: ChannelRow[] }) {
  return (
    <ReportTable
      caption="Sessions by channel"
      columns={["Channel", "Sessions", "Share"]}
      rows={rows.map((row) => ({
        key: row.channel,
        cells: [row.name, <Amount key="sessions" value={formatCount(row.current)} percent={row.percent} />, formatPercentPoint(row.share)],
      }))}
    />
  );
}

function LandingTable({ rows }: { rows: LandingRow[] }) {
  const shown = rows.slice(0, 6);
  const withContacts = rows.some((row) => row.contacts !== null);
  return (
    <>
      <ReportTable
        caption="Landing pages"
        columns={withContacts ? ["Page", "Sessions", "Share", "Contact actions", "Contact rate"] : ["Page", "Sessions", "Share"]}
        rows={shown.map((row) => ({
          key: row.name,
          cells: withContacts
            ? [row.name, formatCount(row.sessions), formatPercentPoint(row.share), formatCount(row.contacts), formatPercentPoint(row.contactRate)]
            : [row.name, formatCount(row.sessions), formatPercentPoint(row.share)],
        }))}
      />
      {rows.length > shown.length && <p className="px-5 py-3 text-xs text-muted">Showing {shown.length} of {rows.length}.</p>}
    </>
  );
}

function PageTable({ rows }: { rows: PageRow[] }) {
  return (
    <ReportTable
      caption="Page performance"
      columns={["Page", "Visits", "Avg. time", "Exit rate"]}
      rows={rows.map((row) => ({
        key: row.name,
        cells: [row.name, formatCount(row.visits), formatDuration(row.time), formatPercentPoint(row.exitRate)],
      }))}
    />
  );
}

export function AnalyticsOverview({ board, links, leadsHref, seoHref }: { board: AnalyticsBoard; links: BreakdownLinks; leadsHref: string; seoHref: string }) {
  const organicShare = shareOf(board.organic.current, board.sessions.current);
  const paired = board.trend.mode === "daily" && board.trend.points.some((point) => point.previous !== null);
  return (
    <div className="min-w-0 space-y-4">
      <SourceLine board={board} leadsHref={leadsHref} seoHref={seoHref} />
      <MetricStrip label="Key figures" cells={OVERVIEW_CARDS.map((card) => ({ ...card, figure: board[card.key] }))} />
      <div className="grid min-w-0 items-stretch gap-4 md:grid-cols-[minmax(0,1.7fr)_minmax(14rem,0.85fr)]">
        <Panel
          title="Traffic trend"
          note={board.trend.mode === "daily" ? "Sessions on each recorded day. The previous period follows the same day order." : "The two recorded periods. Daily sessions are not stored for this export."}
          aside={<span className="flex flex-col items-end gap-2"><Legend showPrevious={paired || board.trend.mode === "period"} /><PanelLink href={links.trends} /></span>}
        >
          <TrendChart trend={board.trend} />
        </Panel>
        <MixPanel
          title="Channel mix"
          href={links.sources}
          rows={board.channels.slice(0, 6).map((row) => ({ name: row.name, value: row.current, share: row.share, percent: row.percent }))}
          progress={{ label: "Organic share this period", value: organicShare }}
          empty="Not recorded. Sessions are not split by channel."
        />
      </div>
      <Panel title="Landing pages" note="Contact actions are clicks on the landing page. Stored leads are not split by page.">
        {board.landing.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Not recorded. Landing pages are not in this export.</p> : <LandingTable rows={board.landing} />}
      </Panel>
    </div>
  );
}

export function AnalyticsTraffic({ board, links, leadsHref, seoHref }: { board: AnalyticsBoard; links: BreakdownLinks; leadsHref: string; seoHref: string }) {
  const paired = board.trend.mode === "daily" && board.trend.points.some((point) => point.previous !== null);
  const mobile = board.devices.find((row) => row.name === "Mobile");
  const deviceTotal = board.devices.reduce((sum, row) => sum + (row.current ?? 0), 0);
  return (
    <div className="min-w-0 space-y-4">
      <SourceLine board={board} leadsHref={leadsHref} seoHref={seoHref} />
      <MetricStrip
        label="Traffic totals"
        cells={[
          { key: "sessions", label: "Sessions", figure: board.sessions, meaning: "A visit to the site. One person can have more than one session." },
          { key: "users", label: "Total users", figure: board.users, meaning: "People who visited. This is not the same measure as a session." },
          { key: "new", label: "New visitors", figure: board.newVisitors, meaning: "Visitors the export marks as new." },
          { key: "returning", label: "Returning visitors", figure: board.returningVisitors, meaning: "Visitors the export marks as returning." },
        ]}
        href={links.visitors}
      />
      <div className="grid min-w-0 items-stretch gap-4 md:grid-cols-[minmax(0,1.7fr)_minmax(14rem,0.85fr)]">
        <Panel
          title="Traffic trend"
          note={board.trend.mode === "daily" ? "Sessions on each recorded day." : "The two recorded periods. Daily sessions are not stored for this export."}
          aside={<span className="flex flex-col items-end gap-2"><Legend showPrevious={paired || board.trend.mode === "period"} /><PanelLink href={links.trends} /></span>}
        >
          <TrendChart trend={board.trend} />
        </Panel>
        <MixPanel
          title="Device"
          href={links.devices}
          rows={board.devices.map((row) => ({ name: row.name, value: row.current, share: shareOf(row.current, deviceTotal || null), percent: row.percent }))}
          progress={{ label: "Mobile share this period", value: shareOf(mobile?.current ?? null, deviceTotal || null) }}
          empty="Not recorded. Sessions are not split by device."
        />
      </div>
      <Panel title="Acquisition" note="Every recorded channel, with its share of sessions." aside={<PanelLink href={links.sources} />}>
        {board.channels.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Not recorded. Sessions are not split by channel.</p> : <ChannelTable rows={board.channels} />}
      </Panel>
      {board.countries.length > 0 && (
        <Panel title="Country" note="Sessions by country.">
          <ReportTable
            caption="Sessions by country"
            columns={["Country", "Sessions"]}
            rows={board.countries.slice(0, 12).map((row) => ({ key: row.name, cells: [row.name, formatCount(row.sessions)] }))}
          />
          {board.countries.length > 12 && <p className="px-5 py-3 text-xs text-muted">Showing 12 of {board.countries.length}.</p>}
        </Panel>
      )}
    </div>
  );
}

function PageBars({ rows }: { rows: PageRow[] }) {
  const points = rows.filter((row) => row.visits !== null).slice(0, 5).map((row) => ({
    label: row.name.length > 16 ? `${row.name.slice(0, 15)}…` : row.name,
    current: row.visits,
    previous: null,
  }));
  return <BarsChart points={points} mode="single" ariaLabel="Visits for the five pages with the most visits" />;
}

export function AnalyticsBehaviour({ board, links, leadsHref, seoHref }: { board: AnalyticsBoard; links: BreakdownLinks; leadsHref: string; seoHref: string }) {
  const engagement = [
    { name: "Avg. session duration", figure: board.duration },
    { name: "Pages per session", figure: board.pagesPerSession },
    { name: "Bounce rate", figure: board.bounceRate },
    { name: "Engagement rate", figure: board.engagementRate },
  ];
  return (
    <div className="min-w-0 space-y-4">
      <SourceLine board={board} leadsHref={leadsHref} seoHref={seoHref} />
      {board.behaviourNote && <p className="text-sm text-muted">{board.behaviourNote}</p>}
      <MetricStrip
        label="Leads"
        cells={[
          { key: "leads", label: "Total leads", figure: board.leads, meaning: "Stored enquiries. Contact clicks are counted separately." },
          { key: "conversion", label: "Visitor-to-lead conversion rate", figure: board.conversionRate, meaning: "Stored enquiries divided by visitors." },
          { key: "starts", label: "Form starts", figure: board.formStarts, meaning: "Recorded starts of the enquiry form." },
          { key: "submissions", label: "Successful submissions", figure: board.formSubmissions, meaning: "Stored form submissions. WhatsApp and phone can bypass the form." },
        ]}
        href={links.forms}
      />
      <div className="grid min-w-0 items-stretch gap-4 md:grid-cols-[minmax(0,1.7fr)_minmax(14rem,0.85fr)]">
        <Panel title="Top pages" note="The five pages with the most visits." aside={<Legend showPrevious={false} />}>
          {board.pages.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Not recorded. Visits are not split by page.</p> : <PageBars rows={board.pages} />}
        </Panel>
        <Panel title="Engagement" note="Scroll depth is not recorded.">
          <ul className="space-y-3 px-5 pb-2">
            {engagement.map((item) => (
              <li key={item.name} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink-soft">{item.name}</span>
                <span className="inline-flex shrink-0 items-baseline gap-1.5">
                  <span className={item.figure.current === null ? "font-semibold text-ink-soft" : "num font-semibold"}>{figureText(item.figure)}</span>
                  <Delta percent={item.figure.percent} />
                </span>
              </li>
            ))}
          </ul>
          <div className="px-5 pb-5">
            <MixProgress label="Form completion" value={shareOf(board.formSubmissions.current, board.formStarts.current)} />
          </div>
        </Panel>
      </div>
      <Panel title="All pages" note="Visits, time on page and exit rate." aside={<PanelLink href={links.pages} />}>
        {board.pages.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Not recorded. Page performance is not in this export.</p> : <PageTable rows={board.pages} />}
      </Panel>
      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <h2 className="text-sm font-semibold">Events</h2>
            <p className="mt-1 text-xs text-muted">Clicks to contact. These are not stored leads.</p>
          </div>
          <PanelLink href={links.clicks} />
        </div>
        <MetricStrip
          label="Contact events"
          cells={board.events.map((event) => ({
            key: event.name,
            label: event.name,
            figure: { current: event.current, previous: event.previous, percent: event.percent, unit: "count" as const },
            meaning: "A click to contact. This is not a stored lead.",
          }))}
        />
      </div>
      <Panel title="Recorded paths" note="The first pages visitors open, in order. This is a stored path, not a complete funnel." aside={<PanelLink href={links.paths} />}>
        {board.flows.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Not recorded. The export does not include the path from one page to the next.</p> : <div className="px-5 pb-5"><NavigationFlows flows={board.flows} /></div>}
      </Panel>
    </div>
  );
}

function MixProgress({ label, value }: { label: string; value: number | null }) {
  if (value === null) return <p className="text-xs text-muted">Form completion is not recorded.</p>;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted">
        <span>{label}</span>
        <span className="num font-semibold text-ink">{formatPercentPoint(value)}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-brand-pale" role="img" aria-label={`${label} ${formatPercentPoint(value)}`}>
        <div className="h-full rounded-full bg-action" style={{ width: `${Math.min(100, Math.max(value, 0))}%` }} />
      </div>
    </div>
  );
}
