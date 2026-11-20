import type { Queryable } from "../client";
import { loadWebsiteConnections, type ConnectionState } from "../analytics/website-connections";
import { latestPublishedReport, publishedReport, type PublishedReport } from "../analytics/read";
import { enqueueJob, windowLength } from "../analytics/sync";
import { addDays } from "./dates";
import { loadAiActivity, type AiActivity } from "./ai-visibility";
import { pageSettingsSummary } from "./seo-overview";
import { listCompletedTasks, UNRESOLVED_ISSUE_STATUSES, type CompletedTask } from "./seo-workflow";

/* SEO-07.1 Google Search Performance, SEO-07.2 SEO Work and SEO-07.3 AI reports (D66). Each loader is the
   report data contract the SEO Overview (Part 8) reads, so a card and its report cannot disagree. */

// ---------------------------------------------------------------------------------------------------------
// SEO-07.1 Google Search Performance

/** Search Console reports on Pacific days (D58). */
export const SEARCH_TIMEZONE = "America/Los_Angeles";
/** Dated rows are prepared on demand, not by the scheduled worker (D66, D56 job budget). */
export const GSC_DAILY_TEMPLATE = "gsc.daily";
const GSC_RANGE_TEMPLATES = ["gsc.totals", "gsc.pages", "gsc.queries"] as const;

export interface SearchMetrics {
  clicks: number | null;
  impressions: number | null;
  /** The provider's aggregate values, never recomputed from rows. */
  ctr: number | null;
  position: number | null;
}

export interface SearchRow extends SearchMetrics {
  key: string;
}

export interface SearchDay extends SearchMetrics {
  date: string;
}

export type SearchPart<T> = { status: "available"; rows: T[]; fetchedAt: Date } | { status: "not_stored" | "preparing" };

export interface SearchReport {
  connection: { state: ConnectionState; property: string | null };
  requested: { start: string; end: string };
  /** The stored window shown. For a preset it may be the latest stored window of the same length (D58). */
  window: { start: string; end: string } | null;
  timezone: typeof SEARCH_TIMEZONE;
  totals: (SearchMetrics & { fetchedAt: Date }) | null;
  /** The equal window before; null means the comparison is unavailable. */
  previous: { window: { start: string; end: string }; totals: SearchMetrics } | null;
  pages: SearchPart<SearchRow>;
  queries: SearchPart<SearchRow>;
  daily: SearchPart<SearchDay>;
  /** The newest Pacific day the report includes: the last dated row with data, otherwise the window end. */
  latestDate: string | null;
}

function metrics(row: PublishedReport["rows"][number] | undefined): SearchMetrics {
  const value = (key: string) => row?.metrics.find((item) => item.key === key && item.state === "available")?.value ?? null;
  return { clicks: value("clicks"), impressions: value("impressions"), ctr: value("ctr"), position: value("position") };
}

async function queued(db: Queryable, websiteId: string, templateKey: string, window: { start: string; end: string }): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from analytics_jobs where website_id = $1 and template_key = $2 and start_date = $3 and end_date = $4 and state in ('queued', 'leased') limit 1`,
    [websiteId, templateKey, window.start, window.end],
  );
  return Boolean(rows[0]);
}

async function part<T>(db: Queryable, ids: { clientId: string; websiteId: string }, templateKey: string, window: { start: string; end: string }, map: (report: PublishedReport) => T[]): Promise<SearchPart<T>> {
  const report = await publishedReport(db, { ...ids, templateKey, ...window });
  if (report) return { status: "available", rows: map(report), fetchedAt: report.fetchedAt };
  return { status: (await queued(db, ids.websiteId, templateKey, window)) ? "preparing" : "not_stored" };
}

const byClicks = (a: SearchRow, b: SearchRow) => (b.clicks ?? -1) - (a.clicks ?? -1) || (b.impressions ?? -1) - (a.impressions ?? -1) || a.key.localeCompare(b.key);

/**
 * Totals, page and query breakdowns and dated rows for one website and Pacific window, each from a stored
 * Search Console report for that exact window. `preset` allows the D58 fallback for rolling ranges.
 */
export async function loadSearchReport(db: Queryable, input: { clientId: string; websiteId: string; start: string; end: string; preset: boolean }): Promise<SearchReport> {
  const ids = { clientId: input.clientId, websiteId: input.websiteId };
  const card = (await loadWebsiteConnections(db, input.websiteId))?.cards.search;
  const connection = { state: card?.state ?? ("not_connected" as ConnectionState), property: card?.property ?? null };
  const query = { ...ids, templateKey: "gsc.totals" };
  const totalsReport = await publishedReport(db, { ...query, start: input.start, end: input.end })
    ?? (input.preset ? await latestPublishedReport(db, { ...query, days: windowLength(input.start, input.end), end: input.end }) : null);
  const window = totalsReport ? { start: totalsReport.start, end: totalsReport.end } : { start: input.start, end: input.end };
  const rowsOf = (report: PublishedReport) => report.rows.map((row) => ({ key: row.dimensionKey, ...metrics(row) })).sort(byClicks);
  const pages = await part(db, ids, "gsc.pages", window, rowsOf);
  const queries = await part(db, ids, "gsc.queries", window, rowsOf);
  const daily = await part(db, ids, GSC_DAILY_TEMPLATE, window, (report) =>
    report.rows.map((row) => ({ date: row.dimensionKey, ...metrics(row) })).sort((a, b) => a.date.localeCompare(b.date)));
  const previousEnd = addDays(window.start, -1);
  const previousWindow = { start: addDays(previousEnd, 1 - windowLength(window.start, window.end)), end: previousEnd };
  const previousReport = totalsReport ? await publishedReport(db, { ...query, ...previousWindow }) : null;
  const lastDay = daily.status === "available" ? daily.rows.filter((row) => (row.impressions ?? 0) > 0).at(-1)?.date ?? null : null;
  return {
    connection,
    requested: { start: input.start, end: input.end },
    window: totalsReport ? window : null,
    timezone: SEARCH_TIMEZONE,
    totals: totalsReport ? { ...metrics(totalsReport.rows.find((row) => row.dimensionKey === "property") ?? totalsReport.rows[0]), fetchedAt: totalsReport.fetchedAt } : null,
    previous: previousReport ? { window: previousWindow, totals: metrics(previousReport.rows.find((row) => row.dimensionKey === "property") ?? previousReport.rows[0]) } : null,
    pages,
    queries,
    daily,
    latestDate: lastDay ?? (totalsReport ? window.end : null),
  };
}

/**
 * Queues the Search Console reports a window still needs: totals, pages, queries and dated rows, plus totals
 * for the equal window before. Existing reports are queued again only when asked to refresh. Returns new jobs.
 */
export async function prepareSearchReport(db: Queryable, input: { clientId: string; websiteId: string; start: string; end: string; refresh: boolean }): Promise<number> {
  const connection = (await db.query<{ id: string }>(
    "select id from analytics_connections where website_id = $1 and client_id = $2 and provider = 'gsc' and status = 'connected' and disconnected_at is null limit 1",
    [input.websiteId, input.clientId],
  )).rows[0];
  if (!connection) return 0;
  const previousEnd = addDays(input.start, -1);
  const previous = { start: addDays(previousEnd, 1 - windowLength(input.start, input.end)), end: previousEnd };
  const wanted = [...[...GSC_RANGE_TEMPLATES, GSC_DAILY_TEMPLATE].map((templateKey) => ({ templateKey, start: input.start, end: input.end })), { templateKey: "gsc.totals", ...previous }];
  let created = 0;
  for (const job of wanted) {
    if (!input.refresh && await publishedReport(db, { clientId: input.clientId, websiteId: input.websiteId, ...job })) continue;
    const result = await enqueueJob(db, { clientId: input.clientId, websiteId: input.websiteId, connectionId: connection.id, ...job });
    if (!result.reused) created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------------------------------------
// SEO-07.2 SEO Work

export interface WorkResolution {
  issueId: string;
  title: string;
  pagePath: string;
  resolvedAt: Date;
  resolvedBy: string | null;
  evidence: string | null;
  currentStatus: string;
}

export interface WorkChange {
  at: Date;
  kind: "page_settings" | "content_change";
  pagePath: string;
  summary: string;
  actor: string | null;
}

export interface WorkReport {
  window: { start: string; end: string };
  timezone: "Asia/Singapore";
  completedTasks: CompletedTask[];
  resolutions: WorkResolution[];
  changes: WorkChange[];
  /** Today's count, independent of the window. */
  openIssues: { count: number; asOf: Date };
}

function sgtRange(start: string, end: string): [string, string] {
  return [new Date(`${start}T00:00:00+08:00`).toISOString(), new Date(new Date(`${end}T00:00:00+08:00`).getTime() + 86_400_000).toISOString()];
}

/** Today's unresolved SEO issues for a website: issues linked to its website-check findings, not yet resolved. */
export async function countOpenSeoIssues(db: Queryable, websiteId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(distinct i.id)::int as n from issues i join seo_site_findings f on f.issue_id = i.id
     where f.website_id = $1 and i.status = any($2::text[])`,
    [websiteId, [...UNRESOLVED_ISSUE_STATUSES]],
  );
  return rows[0]?.n ?? 0;
}

/** Work done in a window (Asia/Singapore days) and the issues still open now. */
export async function loadWorkReport(db: Queryable, input: { websiteId: string; start: string; end: string; now?: Date }): Promise<WorkReport> {
  const [from, to] = sgtRange(input.start, input.end);
  const completedTasks = await listCompletedTasks(db, { websiteId: input.websiteId, start: input.start, end: input.end });
  // A resolution is each verified close in the append-only issue history, so a later reopen does not erase it.
  const resolutions = (await db.query<{ issue_id: string; title: string; page_path: string; created_at: Date; actor: string | null; note: string | null; status: string }>(
    `select h.issue_id, i.title, f.page_path, h.created_at, u.display_name as actor, h.note, i.status
     from issue_history h
     join issues i on i.id = h.issue_id
     join lateral (select page_path from seo_site_findings where issue_id = i.id and website_id = $1 limit 1) f on true
     left join staff_users u on u.id = h.actor_user_id
     where h.to_status = 'verified_closed' and h.created_at >= $2 and h.created_at < $3
     order by h.created_at desc`,
    [input.websiteId, from, to],
  )).rows.map((row) => ({ issueId: row.issue_id, title: row.title, pagePath: row.page_path, resolvedAt: row.created_at, resolvedBy: row.actor, evidence: row.note, currentStatus: row.status }));
  const settings = (await db.query<{ occurred_at: Date; action: string; metadata: { pagePath?: string; title?: boolean; description?: boolean; indexable?: boolean | null } | null; actor: string | null }>(
    `select a.occurred_at, a.action, a.metadata, u.display_name as actor
     from audit_events a left join staff_users u on u.id = a.actor_user_id
     where a.target_type = 'website' and a.target_id = $1 and a.action in ('seo.page_settings.publish', 'seo.page_settings.clear')
       and a.outcome = 'success' and a.occurred_at >= $2 and a.occurred_at < $3`,
    [input.websiteId, from, to],
  )).rows.map((row): WorkChange => ({ at: row.occurred_at, kind: "page_settings", pagePath: row.metadata?.pagePath ?? "Unknown page", summary: pageSettingsSummary(row.action, row.metadata), actor: row.actor }));
  const content = (await db.query<{ created_at: Date; page_path: string; change_type: string; reason: string; actor: string | null }>(
    `select c.created_at, p.page_path, c.change_type, c.reason, u.display_name as actor
     from seo_changes c join seo_pages p on p.id = c.seo_page_id left join staff_users u on u.id = c.changed_by
     where p.website_id = $1 and c.created_at >= $2 and c.created_at < $3`,
    [input.websiteId, from, to],
  )).rows.map((row): WorkChange => ({ at: row.created_at, kind: "content_change", pagePath: row.page_path, summary: `${row.change_type.replaceAll("_", " ")} change: ${row.reason}`, actor: row.actor }));
  return {
    window: { start: input.start, end: input.end },
    timezone: "Asia/Singapore",
    completedTasks,
    resolutions,
    changes: [...settings, ...content].sort((a, b) => b.at.getTime() - a.at.getTime()),
    openIssues: { count: await countOpenSeoIssues(db, input.websiteId), asOf: input.now ?? new Date() },
  };
}

// ---------------------------------------------------------------------------------------------------------
// SEO-07.3 AI report

export interface AiReport {
  activity: AiActivity;
  figures: {
    crawlerVisits: { value: number | null; coverage: string };
    referralSessions: { value: number | null; coverage: string };
    trackedMentions: { value: number | null; coverage: string };
  };
}

/** The three AI figures, read through `loadAiActivity` so they match AI Activity for the same website and range. */
export async function loadAiReport(db: Queryable, input: { clientId: string; websiteId: string; start: string; end: string }): Promise<AiReport> {
  const activity = await loadAiActivity(db, input);
  const { crawlers, referrals, mentions } = activity;
  const crawlerCoverage = crawlers.total === null
    ? { no_source: "No crawler log source is connected.", disconnected: "The crawler log source is disconnected.", not_covered: "Connected sources do not cover the whole range.", covered: "" }[crawlers.status]
    : crawlers.unavailableProviders.length ? `Measurable platforms only; unavailable: ${crawlers.unavailableProviders.map((key) => ({ chatgpt: "ChatGPT", gemini: "Gemini", claude: "Claude" })[key]).join(", ")}.` : "ChatGPT, Gemini and Claude.";
  const referralCoverage = {
    available: "GA4 sessions from ChatGPT, Gemini and Claude.",
    preparing: "The GA4 referral report for this range is being prepared.",
    not_prepared: "The GA4 referral report for this range has not been prepared.",
    wix_only: "Wix analytics does not report session sources.",
    not_connected: "No GA4 property is connected.",
  }[referrals.status];
  return {
    activity,
    figures: {
      crawlerVisits: { value: crawlers.total, coverage: crawlerCoverage },
      referralSessions: { value: referrals.sessions, coverage: referralCoverage },
      trackedMentions: { value: mentions.mentions, coverage: `${mentions.tests} saved answer test(s) in this range.` },
    },
  };
}
