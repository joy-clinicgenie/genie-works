import Link from "next/link";
import { addDays, canManageRegistry, formatDate, formatDateTime, loadAiReport, loadSearchReport, loadWorkReport, todaySgt, type SearchMetrics, type SearchPart, type SearchRow } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Table, Td, Th } from "@/components/ui/Table";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { prepareSearchReportAction } from "@/app/actions/seo-reports";
import { loadSeoContext, queryText, readGoogleControls, searchConsoleWindow, selectedTab, seoHref, type SeoContext, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO reports" };

const TABS = [
  ["google-search", "Google Search"],
  ["work", "SEO Work"],
  ["ai", "AI Report"],
] as const;

const NOTICES: Record<string, string> = {
  denied: "Only an administrator or manager can prepare Search Console reports for this website.",
  bad_dates: "Choose a start date on or before the end date, up to the latest day Search Console has published.",
  search_queued: "The Search Console reports for this period are queued. They appear after the next worker run.",
  search_nothing: "Every report for this period is already stored or queued.",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const n = (value: number | null) => (value === null ? "Unavailable" : Math.round(value).toLocaleString("en-SG"));
const pct = (value: number | null) => (value === null ? "Unavailable" : `${(value * 100).toFixed(1)}%`);
const pos = (value: number | null) => (value === null ? "Unavailable" : value.toFixed(1));

function change(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "No comparison";
  if (previous === 0) return current === 0 ? "No change" : "New";
  const delta = ((current - previous) / previous) * 100;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(0)}% vs previous`;
}

function partNote(part: SearchPart<unknown>, label: string): string {
  return part.status === "preparing" ? `${label} for this period are being prepared.` : `${label} are not stored for this period.`;
}

export default async function SeoReportsPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const tab = selectedTab(queryText(query, "tab"), TABS, "google-search");
  const site = ctx.selected && !ctx.demo ? ctx.selected : null;
  const notice = queryText(query, "notice");
  return (
    <SeoFrame ctx={ctx} pathname="/seo/reports" title="Reports" description="Search performance, SEO work and AI activity for the selected website. Each figure shows its own dates and source." tabs={TABS} currentTab={tab}>
      {notice && NOTICES[notice] && <div className="mb-4"><Notice tone="neutral">{NOTICES[notice]}</Notice></div>}
      {ctx.demo ? <DemoNote>Report tables do not contain sample performance.</DemoNote> : !site ? null : tab === "google-search" ? (
        <SearchTab ctx={ctx} query={query} canPrepare={canManageRegistry(access)} access={access} />
      ) : tab === "work" ? (
        <WorkTab ctx={ctx} query={query} access={access} />
      ) : (
        <AiTab ctx={ctx} query={query} access={access} />
      )}
    </SeoFrame>
  );
}

type TabProps = { ctx: SeoContext; query: SeoSearch; access: Awaited<ReturnType<typeof requireAccess>> };

// SEO-07.1 -------------------------------------------------------------------------------------------------

async function SearchTab({ ctx, query, access, canPrepare }: TabProps & { canPrepare: boolean }) {
  const site = ctx.selected!;
  const controls = readGoogleControls(query);
  const view = queryText(query, "view") === "queries" ? "queries" : "pages";
  const q = queryText(query, "q")?.trim() ?? "";
  const window = searchConsoleWindow(controls);
  const report = window ? await staffTx(access, (db) => loadSearchReport(db, { clientId: site.clientId, websiteId: site.id, ...window, preset: controls.range !== "custom" })) : null;
  const keep = { range: controls.range, from: controls.range === "custom" ? controls.from : undefined, to: controls.range === "custom" ? controls.to : undefined };
  const part = report ? (view === "pages" ? report.pages : report.queries) : null;
  const rows: SearchRow[] = part?.status === "available" ? part.rows.filter((row) => !q || row.key.toLowerCase().includes(q.toLowerCase())) : [];
  const connected = report?.connection.state === "connected";
  return (
    <div className="space-y-5">
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm" aria-label="Report period">
        <input type="hidden" name="website" value={site.id} />
        <input type="hidden" name="tab" value="google-search" />
        <input type="hidden" name="view" value={view} />
        {(["7", "30", "90"] as const).map((range) => (
          <Link key={range} href={seoHref("/seo/reports", ctx, { tab: "google-search", view, range })} aria-current={controls.range === range ? "true" : undefined} className={`rounded-full border px-3 py-1 ${controls.range === range ? "border-action bg-brand-pale text-action" : "border-line"}`}>Last {range} days</Link>
        ))}
        <input type="hidden" name="range" value="custom" />
        <Field label="From" htmlFor="search-from"><Input id="search-from" type="date" name="from" defaultValue={controls.range === "custom" ? controls.from : report?.window?.start ?? window?.start} required /></Field>
        <Field label="To" htmlFor="search-to"><Input id="search-to" type="date" name="to" defaultValue={controls.range === "custom" ? controls.to : report?.window?.end ?? window?.end} required /></Field>
        <Button type="submit" variant="secondary" size="sm">Apply dates</Button>
      </form>

      {!window || !report ? (
        <Unavailable title="Choose a valid period">The start date must be on or before the end date, and Search Console publishes days after about three days.</Unavailable>
      ) : (
        <>
          <Card>
            <CardHeader
              title="Search Console totals"
              description={report.window
                ? `${formatDate(report.window.start)} to ${formatDate(report.window.end)}, Pacific time · ${report.connection.property ?? "property not recorded"} · latest reporting date ${report.latestDate ? formatDate(report.latestDate) : "not known"} · read from Google ${formatDateTime(report.totals!.fetchedAt)}`
                : `${formatDate(report.requested.start)} to ${formatDate(report.requested.end)}, Pacific time.`}
              action={<Badge tone={connected ? "good" : "neutral"}>{connected ? "Connected" : report.connection.state === "reconnect_required" ? "Reconnect required" : "Not connected"}</Badge>}
            />
            {report.totals ? (
              <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4" data-search-totals>
                {([["Clicks", "clicks", n], ["Impressions", "impressions", n], ["CTR", "ctr", pct], ["Average position", "position", pos]] as const).map(([label, key, format]) => (
                  <div key={key} data-metric={key}>
                    <div className="text-xs uppercase text-muted">{label}</div>
                    <div className="mt-1 text-xl font-semibold">{format(report.totals![key as keyof SearchMetrics])}</div>
                    <div className="text-xs text-muted">{report.previous ? (key === "position" ? `Previous ${pos(report.previous.totals.position)}` : change(report.totals![key as keyof SearchMetrics], report.previous.totals[key as keyof SearchMetrics])) : "Comparison unavailable"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted">{connected ? "Totals are not stored for this period." : "Search Console is not connected for this website, so totals are unavailable."}</p>
            )}
            <div className="space-y-2 border-t border-line px-5 py-4 text-sm text-muted">
              <p>CTR and average position are Search Console&apos;s own figures for the whole period, not averages of the rows below.</p>
              <p>{report.previous ? `Compared with ${formatDate(report.previous.window.start)} to ${formatDate(report.previous.window.end)}.` : "The previous period is not stored, so no comparison is shown."}</p>
              {canPrepare && connected && (
                <form action={prepareSearchReportAction} className="flex flex-wrap gap-2">
                  <input type="hidden" name="websiteId" value={site.id} />
                  <input type="hidden" name="range" value={controls.range} />
                  {controls.range === "custom" && <><input type="hidden" name="from" value={controls.from} /><input type="hidden" name="to" value={controls.to} /></>}
                  <Button type="submit" variant="secondary" size="sm">Prepare reports for this period</Button>
                  {report.window && <Button type="submit" name="refresh" value="1" variant="ghost" size="sm">Read again from Google</Button>}
                </form>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Daily trend" description="Clicks and impressions for each Pacific day of the period." />
            {report.daily.status === "available" ? (
              <Table caption="Search Console daily rows">
                <thead><tr><Th>Date</Th><Th>Clicks</Th><Th>Impressions</Th><Th>CTR</Th><Th>Position</Th></tr></thead>
                <tbody>{report.daily.rows.map((row) => <tr key={row.date}><Td>{formatDate(row.date)}</Td><Td>{n(row.clicks)}</Td><Td>{n(row.impressions)}</Td><Td>{pct(row.ctr)}</Td><Td>{pos(row.position)}</Td></tr>)}</tbody>
              </Table>
            ) : <p className="px-5 pb-5 text-sm text-muted">{partNote(report.daily, "Daily rows")}</p>}
          </Card>

          <Card>
            <CardHeader title={view === "pages" ? "Pages" : "Queries"} description="Sorted by clicks. Search filters the rows; the totals above stay the period's totals." />
            <div className="flex flex-wrap items-end gap-3 px-5 pb-4 text-sm">
              <div role="group" aria-label="Breakdown" className="flex gap-2">
                {(["pages", "queries"] as const).map((item) => (
                  <Link key={item} href={seoHref("/seo/reports", ctx, { tab: "google-search", view: item, ...keep })} aria-current={view === item ? "true" : undefined} className={`rounded-full border px-3 py-1 ${view === item ? "border-action bg-brand-pale text-action" : "border-line"}`}>{item === "pages" ? "Pages" : "Queries"}</Link>
                ))}
              </div>
              <form method="get" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="website" value={site.id} />
                <input type="hidden" name="tab" value="google-search" />
                <input type="hidden" name="view" value={view} />
                <input type="hidden" name="range" value={controls.range} />
                {controls.range === "custom" && <><input type="hidden" name="from" value={controls.from} /><input type="hidden" name="to" value={controls.to} /></>}
                <Field label={view === "pages" ? "Search by path" : "Search queries"} htmlFor="search-q"><Input id="search-q" name="q" defaultValue={q} maxLength={200} /></Field>
                <Button type="submit" variant="secondary" size="sm">Search</Button>
              </form>
            </div>
            {part?.status === "available" ? (
              <Table caption={view === "pages" ? "Pages by clicks" : "Queries by clicks"}>
                <thead><tr><Th>{view === "pages" ? "Page" : "Query"}</Th><Th>Clicks</Th><Th>Impressions</Th><Th>CTR</Th><Th>Position</Th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-muted">No {view} match this search.</td></tr>}
                  {rows.map((row) => <tr key={row.key} data-row={row.key}><Td className="break-all">{row.key}</Td><Td>{n(row.clicks)}</Td><Td>{n(row.impressions)}</Td><Td>{pct(row.ctr)}</Td><Td>{pos(row.position)}</Td></tr>)}
                </tbody>
              </Table>
            ) : <p className="px-5 pb-5 text-sm text-muted">{part ? partNote(part, view === "pages" ? "Page rows" : "Query rows") : ""}</p>}
          </Card>
        </>
      )}
    </div>
  );
}

// SEO-07.2 -------------------------------------------------------------------------------------------------

function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

async function WorkTab({ ctx, query, access }: TabProps) {
  const site = ctx.selected!;
  const today = todaySgt();
  const from = queryText(query, "from");
  const to = queryText(query, "to");
  const valid = from && to && DATE.test(from) && DATE.test(to) && from <= to && to <= today && addDays(from, 92) >= to;
  const start = valid ? from! : addDays(today, -6);
  const end = valid ? to! : today;
  const report = await staffTx(access, (db) => loadWorkReport(db, { websiteId: site.id, start, end }));
  const thisMonday = mondayOf(today);
  const weeks = [0, 1, 2, 3].map((back) => {
    const monday = addDays(thisMonday, -7 * back);
    return { label: back === 0 ? "This week" : back === 1 ? "Last week" : `Week of ${formatDate(monday)}`, from: monday, to: back === 0 ? today : addDays(monday, 6) };
  });
  const tasksHref = seoHref("/seo/tasks", ctx, { tab: "completed" });
  const issuesHref = seoHref("/seo/tasks", ctx, { tab: "issues" });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        {weeks.map((week) => (
          <Link key={week.from} href={seoHref("/seo/reports", ctx, { tab: "work", from: week.from, to: week.to })} aria-current={week.from === start && week.to === end ? "true" : undefined} className={`rounded-full border px-3 py-1 ${week.from === start && week.to === end ? "border-action bg-brand-pale text-action" : "border-line"}`}>{week.label}</Link>
        ))}
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="website" value={site.id} />
          <input type="hidden" name="tab" value="work" />
          <Field label="From" htmlFor="work-from"><Input id="work-from" type="date" name="from" defaultValue={start} max={today} required /></Field>
          <Field label="To" htmlFor="work-to"><Input id="work-to" type="date" name="to" defaultValue={end} max={today} required /></Field>
          <Button type="submit" variant="secondary" size="sm">Apply dates</Button>
        </form>
      </div>
      {(from || to) && !valid && <Notice tone="neutral">Those dates were not used: choose up to 93 days ending today or earlier. Showing the last 7 days.</Notice>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Completed tasks" value={report.completedTasks.length} note={`${formatDate(start)} to ${formatDate(end)}`} href={tasksHref} linkLabel="Open completed tasks" />
        <Figure label="Issues resolved" value={report.resolutions.length} note={`${formatDate(start)} to ${formatDate(end)}`} href={issuesHref} linkLabel="Open issues" />
        <Figure label="Recorded changes" value={report.changes.length} note={`${formatDate(start)} to ${formatDate(end)}`} href={seoHref("/seo/pages", ctx, { tab: "pages" })} linkLabel="Open pages" />
        <Figure label="Open issues today" value={report.openIssues.count} note={`As of ${formatDateTime(report.openIssues.asOf)}; not limited to the period`} href={issuesHref} linkLabel="Open issues" testId="open-today" />
      </div>
      <p className="text-xs text-muted">Period: {formatDate(start)} to {formatDate(end)}, Asia/Singapore days. Open issues are counted now and do not change with the period.</p>

      <Card>
        <CardHeader title={`Issues resolved: ${report.resolutions.length}`} description="Each verified fix in the period. A later reopen keeps the resolution and shows the issue's current state." />
        {report.resolutions.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No issue was verified as fixed in this period.</p> : (
          <Table caption="Issues resolved in the period">
            <thead><tr><Th>Resolved</Th><Th>Issue</Th><Th>By</Th><Th>Evidence</Th><Th>Now</Th></tr></thead>
            <tbody>{report.resolutions.map((row) => (
              <tr key={`${row.issueId}-${row.resolvedAt.toISOString()}`} data-resolution={row.issueId}>
                <Td>{formatDateTime(row.resolvedAt)}</Td>
                <Td><Link href={`/issues/${row.issueId}`} className="text-action hover:underline">{row.title}</Link></Td>
                <Td>{row.resolvedBy ?? "Unknown"}</Td>
                <Td className="text-muted">{row.evidence ?? "None recorded"}</Td>
                <Td>{row.currentStatus === "verified_closed" ? "Resolved" : row.currentStatus === "reopened" ? "Reopened" : row.currentStatus.replaceAll("_", " ")}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title={`Completed tasks: ${report.completedTasks.length}`} description="Tasks linked to this website that were completed in the period and are still completed." />
        {report.completedTasks.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No linked task was completed in this period.</p> : (
          <Table caption="Completed tasks in the period">
            <thead><tr><Th>Completed</Th><Th>Task</Th><Th>Responsible</Th><Th>Linked to</Th></tr></thead>
            <tbody>{report.completedTasks.map((task) => <tr key={task.id}><Td>{formatDateTime(task.completedAt)}</Td><Td><Link href={`/tasks/${task.id}`} className="text-action hover:underline">{task.title}</Link></Td><Td>{task.ownerName ?? "Unassigned"}</Td><Td className="break-all">{task.linkedLabel}</Td></tr>)}</tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title={`Recorded changes: ${report.changes.length}`} description="Page SEO settings saved in Genie Works and content changes recorded against mapped pages." />
        {report.changes.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No change was recorded in this period.</p> : (
          <Table caption="Recorded changes in the period">
            <thead><tr><Th>When</Th><Th>Page</Th><Th>Change</Th><Th>By</Th></tr></thead>
            <tbody>{report.changes.map((row, index) => <tr key={index}><Td>{formatDateTime(row.at)}</Td><Td className="break-all"><Link href={seoHref("/seo/pages", ctx, { tab: "pages", q: row.pagePath })} className="text-action hover:underline">{row.pagePath}</Link></Td><Td>{row.summary}</Td><Td>{row.actor ?? "Unknown"}</Td></tr>)}</tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Figure({ label, value, note, href, linkLabel, testId }: { label: string; value: number | null; note: string; href: string; linkLabel: string; testId?: string }) {
  return (
    <div className="card p-4" data-figure={testId ?? label}>
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value === null ? <Badge>Unavailable</Badge> : value}</div>
      <p className="mt-1 text-xs text-muted">{note}</p>
      <Link href={href} className="mt-2 inline-block text-sm text-action hover:underline">{linkLabel}</Link>
    </div>
  );
}

// SEO-07.3 -------------------------------------------------------------------------------------------------

async function AiTab({ ctx, query, access }: TabProps) {
  const site = ctx.selected!;
  // The same GA4 preset ranges as AI Activity: 7, 30 or 90 Asia/Singapore days ending yesterday (D63).
  const days = [7, 30, 90].includes(Number(queryText(query, "range"))) ? Number(queryText(query, "range")) : 30;
  const end = addDays(todaySgt(), -1);
  const start = addDays(end, 1 - days);
  const report = await staffTx(access, (db) => loadAiReport(db, { clientId: site.clientId, websiteId: site.id, start, end }));
  const activity = (anchor: string) => `${seoHref("/seo/ai-visibility", ctx, { tab: "visibility", range: String(days) })}#${anchor}`;
  const { crawlerVisits, referralSessions, trackedMentions } = report.figures;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Date range">
        <span className="text-muted">{formatDate(start)} to {formatDate(end)}, Asia/Singapore:</span>
        {[7, 30, 90].map((value) => (
          <Link key={value} href={seoHref("/seo/reports", ctx, { tab: "ai", range: String(value) })} aria-current={value === days ? "true" : undefined} className={`rounded-full border px-3 py-1 ${value === days ? "border-action bg-brand-pale text-action" : "border-line"}`}>Last {value} days</Link>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="Crawler visits" value={crawlerVisits.value} note={`ChatGPT, Gemini and Claude crawlers only. ${crawlerVisits.coverage}`} href={activity("crawler-visits")} linkLabel="Open crawler records" testId="crawler" />
        <Figure label="AI referral sessions" value={referralSessions.value} note={referralSessions.coverage} href={activity("referral-sessions")} linkLabel="Open referral sessions" testId="referrals" />
        <Figure label="Tracked mentions" value={trackedMentions.value} note={trackedMentions.coverage} href={activity("tracked-mentions")} linkLabel="Open answer tests" testId="mentions" />
      </div>
      <p className="text-xs text-muted">These are the AI Activity figures for the same website and dates. The three measures are separate and are not added together. Branch details stay in Google Business Profile.</p>
      <Card>
        <CardHeader title="Source availability" />
        <Table caption="AI source availability">
          <thead><tr><Th>Source</Th><Th>Status</Th><Th>Last update</Th></tr></thead>
          <tbody>
            {(["chatgpt", "gemini", "claude"] as const).map((key) => {
              const row = report.activity.crawlers.providers[key];
              return <tr key={key} data-provider={key}><Td>{{ chatgpt: "ChatGPT", gemini: "Gemini", claude: "Claude" }[key]} crawlers</Td><Td>{row.availability === "available" ? `Available · ${row.count}` : <Badge>Unavailable</Badge>}</Td><Td>{report.activity.crawlers.lastSuccessAt ? formatDateTime(report.activity.crawlers.lastSuccessAt) : "None"}</Td></tr>;
            })}
            <tr><Td>GA4 referral sessions</Td><Td>{report.activity.referrals.status === "available" ? "Available" : <Badge>Unavailable</Badge>}</Td><Td>{report.activity.referrals.fetchedAt ? formatDateTime(report.activity.referrals.fetchedAt) : "None"}</Td></tr>
            <tr><Td>Saved answer tests</Td><Td>Available · {report.activity.mentions.tests} test(s)</Td><Td>Recorded by staff</Td></tr>
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
