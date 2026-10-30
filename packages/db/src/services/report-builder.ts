import { checklistItem, REPORT_CHECKLIST, type ReportGroupKey } from "@clinic-genie/contracts";
import type { Queryable } from "../client";
import { publishedReport, type PublishedReport } from "../analytics/read";
import { usersFromReport } from "../analytics/measure";
import { isValidDate } from "./dates";

export interface ReportLine {
  label: string;
  current: string;
  previous: string | null;
  change: string | null;
  note: string | null;
}

export interface ReportBlock {
  groupKey: string;
  groupLabel: string;
  itemKey: string;
  itemLabel: string;
  narrative: string | null;
  suggestion: string | null;
  lines: ReportLine[];
}

export interface ReportComposition {
  blocks: ReportBlock[];
  limitationNote: string;
}

const LIMITATION = "Unavailable figures stay blank and are not shown as zero. A WhatsApp click or a call-button click is not a confirmed enquiry. A booking-link click is not a confirmed appointment. Cost per lead is shown only when advertising cost and a recorded enquiry count are both available.";

const ANALYTICS_TEMPLATES = ["ga4.traffic_range", "ga4.acquisition", "ga4.landing", "ga4.device", "ga4.country", "gsc.totals", "gsc.queries", "gsc.pages"] as const;

interface Snap {
  source: string;
  channel: string;
  metric: string;
  dimension: string;
  value: number | null;
}

type Reading = { state: "value"; value: number; note?: string } | { state: "missing" } | { state: "unavailable" };

interface Work {
  completed: string[];
  openTasks: string[];
  issues: string[];
  changes: string[];
  decisions: string[];
}

interface Loaded {
  current: Snap[];
  previous: Snap[];
  compared: boolean;
  currentAnalytics: Map<string, PublishedReport>;
  previousAnalytics: Map<string, PublishedReport>;
  blogPublished: number;
  blogExisting: number;
  blogTitles: string[];
  seoStatuses: Array<{ status: string; count: number }>;
  seoFlags: Array<{ path: string; flag: string; note: string | null }>;
  profiles: Array<{ name: string; status: string }>;
  work: Work;
}

export function costPerLead(cost: number | null | undefined, enquiries: number | null | undefined): { value: number | null; note: string } {
  if (cost === null || cost === undefined || enquiries === null || enquiries === undefined) {
    return { value: null, note: "Cost per lead needs both recorded advertising cost and a recorded enquiry count. Clicks are not used as leads." };
  }
  if (enquiries <= 0) return { value: null, note: "Cost per lead is not shown when the recorded enquiry count is zero." };
  return { value: Number((cost / enquiries).toFixed(2)), note: "Advertising cost divided by recorded enquiries. Contact clicks are not included." };
}

export function conversionRate(enquiries: number | null | undefined, sessions: number | null | undefined): { value: number | null; note: string } {
  if (enquiries === null || enquiries === undefined || sessions === null || sessions === undefined || sessions <= 0) {
    return { value: null, note: "Conversion rate needs both recorded enquiries and recorded sessions. Clicks are not the numerator." };
  }
  return { value: Number(((enquiries / sessions) * 100).toFixed(1)), note: "Recorded enquiries divided by recorded sessions." };
}

export async function listReportWebsites(db: Queryable, clientIds: string[]): Promise<Array<{ id: string; client_id: string; name: string; url: string | null }>> {
  if (clientIds.length === 0) return [];
  const { rows } = await db.query<{ id: string; client_id: string; name: string; url: string | null }>(
    `select id, client_id, name, url from websites
     where client_id = any($1::uuid[]) and status = 'active'
     order by name`,
    [clientIds],
  );
  return rows;
}

export async function composeReport(db: Queryable, input: {
  clientId: string;
  websiteId: string | null;
  periodStart: string;
  periodEnd: string;
  comparisonStart: string | null;
  comparisonEnd: string | null;
  items: string[];
}): Promise<ReportComposition> {
  if (!isValidDate(input.periodStart) || !isValidDate(input.periodEnd) || input.periodEnd < input.periodStart) {
    return { blocks: [], limitationNote: LIMITATION };
  }
  const compared = Boolean(input.comparisonStart && input.comparisonEnd && isValidDate(input.comparisonStart) && isValidDate(input.comparisonEnd));
  const loaded = await load(db, input, compared);
  const selected = new Set(input.items);
  const blocks: ReportBlock[] = [];
  for (const group of REPORT_CHECKLIST) {
    for (const item of group.items) {
      if (!selected.has(item.key)) continue;
      blocks.push(renderItem(group.key, group.label, item.key, item.label, loaded, compared));
    }
  }
  return { blocks, limitationNote: LIMITATION };
}

async function load(db: Queryable, input: {
  clientId: string;
  websiteId: string | null;
  periodStart: string;
  periodEnd: string;
  comparisonStart: string | null;
  comparisonEnd: string | null;
}, compared: boolean): Promise<Loaded> {
  const snaps = await db.query<Snap & { period_start: string; period_end: string }>(
    `select source, channel, metric, dimension, period_start::text as period_start, period_end::text as period_end, value
     from report_snapshots
     where client_id = $1 and superseded_by_id is null
       and (
         (period_start = $2::date and period_end = $3::date)
         or ($4::date is not null and period_start = $4::date and period_end = $5::date)
       )`,
    [input.clientId, input.periodStart, input.periodEnd, compared ? input.comparisonStart : null, compared ? input.comparisonEnd : null],
  );
  const current = snaps.rows.filter((row) => row.period_start.slice(0, 10) === input.periodStart && row.period_end.slice(0, 10) === input.periodEnd);
  const previous = compared
    ? snaps.rows.filter((row) => row.period_start.slice(0, 10) === input.comparisonStart && row.period_end.slice(0, 10) === input.comparisonEnd)
    : [];
  const [currentAnalytics, previousAnalytics] = await Promise.all([
    loadAnalytics(db, input.clientId, input.websiteId, input.periodStart, input.periodEnd),
    compared && input.comparisonStart && input.comparisonEnd
      ? loadAnalytics(db, input.clientId, input.websiteId, input.comparisonStart, input.comparisonEnd)
      : Promise.resolve(new Map<string, PublishedReport>()),
  ]);
  const blog = await db.query<{ published: number; existing: number }>(
    `select
       count(*) filter (where first_published_at::date between $3::date and $4::date)::int as published,
       count(*) filter (where status = 'published' and first_published_at::date < $3::date)::int as existing
     from blog_articles
     where client_id = $1 and ($2::uuid is null or website_id = $2)`,
    [input.clientId, input.websiteId, input.periodStart, input.periodEnd],
  );
  const titles = await db.query<{ title: string }>(
    `select title from blog_articles
     where client_id = $1 and ($2::uuid is null or website_id = $2)
       and first_published_at::date between $3::date and $4::date
     order by first_published_at desc limit 8`,
    [input.clientId, input.websiteId, input.periodStart, input.periodEnd],
  );
  const statuses = await db.query<{ status: string; count: number }>(
    `select content_status as status, count(*)::int as count from seo_pages
     where client_id = $1 and archived_at is null and ($2::uuid is null or website_id = $2)
     group by content_status order by content_status`,
    [input.clientId, input.websiteId],
  );
  const flags = await db.query<{ path: string; flag: string; note: string | null }>(
    `select page_path as path, mapping_flag as flag, flag_note as note from seo_pages
     where client_id = $1 and archived_at is null and mapping_flag <> 'none' and ($2::uuid is null or website_id = $2)
     order by page_path limit 12`,
    [input.clientId, input.websiteId],
  );
  const profiles = await db.query<{ name: string; status: string }>(
    `select branch_name as name, setup_status as status from seo_business_profiles where client_id = $1 order by branch_name`,
    [input.clientId],
  );
  const completed = await db.query<{ title: string }>(
    `select title from tasks where client_id = $1 and status = 'completed' and completed_at::date between $2::date and $3::date order by completed_at desc limit 12`,
    [input.clientId, input.periodStart, input.periodEnd],
  );
  const openTasks = await db.query<{ title: string }>(
    `select title from tasks where client_id = $1 and status in ('open', 'in_progress', 'waiting') order by due_date nulls last, title limit 8`,
    [input.clientId],
  );
  const issues = await db.query<{ title: string }>(
    `select title from issues where client_id = $1 and status <> 'verified_closed' order by opened_at desc limit 12`,
    [input.clientId],
  );
  const seoChanges = await db.query<{ title: string }>(
    `select coalesce(reason, change_type) as title from seo_changes
     where client_id = $1 and changed_on between $2::date and $3::date order by changed_on desc limit 8`,
    [input.clientId, input.periodStart, input.periodEnd],
  );
  const adsChanges = await db.query<{ title: string }>(
    `select description as title from ads_changes
     where client_id = $1 and implemented_on between $2::date and $3::date order by implemented_on desc limit 8`,
    [input.clientId, input.periodStart, input.periodEnd],
  );
  const decisions = await db.query<{ title: string }>(
    `select title from approvals where client_id = $1 and status in ('submitted', 'changes_requested') order by updated_at desc limit 8`,
    [input.clientId],
  );
  return {
    current,
    previous,
    compared,
    currentAnalytics,
    previousAnalytics,
    blogPublished: Number(blog.rows[0]?.published ?? 0),
    blogExisting: Number(blog.rows[0]?.existing ?? 0),
    blogTitles: titles.rows.map((row) => row.title),
    seoStatuses: statuses.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
    seoFlags: flags.rows,
    profiles: profiles.rows,
    work: {
      completed: completed.rows.map((row) => row.title),
      openTasks: openTasks.rows.map((row) => row.title),
      issues: issues.rows.map((row) => row.title),
      changes: [...seoChanges.rows, ...adsChanges.rows].map((row) => row.title).filter(Boolean),
      decisions: decisions.rows.map((row) => row.title),
    },
  };
}

async function loadAnalytics(db: Queryable, clientId: string, websiteId: string | null, start: string, end: string): Promise<Map<string, PublishedReport>> {
  const found = new Map<string, PublishedReport>();
  if (!websiteId) return found;
  await Promise.all(ANALYTICS_TEMPLATES.map(async (templateKey) => {
    const report = await publishedReport(db, { clientId, websiteId, templateKey, start, end });
    if (report) found.set(templateKey, report);
  }));
  return found;
}

function renderItem(groupKey: ReportGroupKey, groupLabel: string, itemKey: string, itemLabel: string, loaded: Loaded, compared: boolean): ReportBlock {
  const base = { groupKey, groupLabel, itemKey, itemLabel, narrative: null as string | null, suggestion: null as string | null, lines: [] as ReportLine[] };
  const spec = checklistItem(itemKey);
  if (spec?.kind === "insight") return { ...base, suggestion: suggest(itemKey, loaded) };
  return { ...base, lines: figureLines(itemKey, loaded, compared) };
}

function suggest(itemKey: string, loaded: Loaded): string | null {
  const work = loaded.work;
  if (itemKey === "performance_overview") return overview(loaded);
  if (itemKey === "key_insights") return insights(loaded);
  if (itemKey === "achievements" || itemKey === "completed_activities") return joinList(work.completed, "Completed in this period: ", "No completed task is recorded in this period.");
  if (itemKey === "attention" || itemKey === "outstanding_issues") return joinList(work.issues, "Open issues: ", "No open issue is recorded.");
  if (itemKey === "recommendations_next" || itemKey === "optimisation") return joinList(work.changes, "Recorded changes in this period: ", null);
  if (itemKey === "next_priorities") return joinList(work.openTasks, "Open work: ", "No open task is recorded.");
  if (itemKey === "client_decisions") return joinList(work.decisions, "Waiting decisions: ", "No approval is waiting for a decision.");
  return null;
}

function joinList(items: string[], prefix: string, empty: string | null): string | null {
  if (items.length === 0) return empty;
  return `${prefix}${items.join("; ")}.`;
}

function overview(loaded: Loaded): string | null {
  const sentences: string[] = [];
  const sessions = headline(loaded.current, "sessions");
  const leads = headline(loaded.current, "enquiries", { source: "clinic_records" });
  const clicks = headline(loaded.current, "clicks", { source: "search_console_export" });
  if (sessions.state === "value") sentences.push(`Recorded sessions were ${formatCount(sessions.value)}.`);
  if (leads.state === "value") sentences.push(`Recorded enquiries were ${formatCount(leads.value)}.`);
  if (clicks.state === "value") sentences.push(`Recorded organic clicks were ${formatCount(clicks.value)}.`);
  return sentences.length ? sentences.join(" ") : null;
}

function insights(loaded: Loaded): string | null {
  if (!loaded.compared) return null;
  const pairs: Array<[string, Reading, Reading]> = [
    ["Recorded sessions", headline(loaded.current, "sessions"), headline(loaded.previous, "sessions")],
    ["Recorded enquiries", headline(loaded.current, "enquiries", { source: "clinic_records" }), headline(loaded.previous, "enquiries", { source: "clinic_records" })],
    ["Organic clicks", headline(loaded.current, "clicks", { source: "search_console_export" }), headline(loaded.previous, "clicks", { source: "search_console_export" })],
  ];
  const lines = pairs.flatMap(([label, current, previous]) => {
    if (current.state !== "value" || previous.state !== "value" || previous.value === 0) return [];
    const change = Number((((current.value - previous.value) / previous.value) * 100).toFixed(1));
    return [`${label} ${change > 0 ? "rose" : change < 0 ? "fell" : "were unchanged"} (${formatSigned(change)}%).`];
  });
  if (lines.length === 0) return null;
  return lines.slice(0, 3).join(" ");
}

function figureLines(itemKey: string, loaded: Loaded, compared: boolean): ReportLine[] {
  switch (itemKey) {
    case "sessions":
      return [metricLine("Sessions", sessionReading(loaded.current, loaded.currentAnalytics), sessionReading(loaded.previous, loaded.previousAnalytics), "count", compared, "Recorded sessions. Channels without a figure are omitted and are not treated as zero.")];
    case "users":
      return [
        metricLine("Users", userReading(loaded.current, loaded.currentAnalytics), userReading(loaded.previous, loaded.previousAnalytics), "count", compared, "Distinct users are used only when an exact-range total is stored."),
        metricLine("New users", headline(loaded.current, "new_visitors"), headline(loaded.previous, "new_visitors"), "count", compared, null),
      ];
    case "page_views":
      return [metricLine("Page views", headline(loaded.current, "page_views"), headline(loaded.previous, "page_views"), "count", compared, null)];
    case "engagement_rate":
      return [missingLine("Engagement rate", "Engagement rate is not in the stored analytics report.")];
    case "engagement_time":
      return [missingLine("Average engagement time", "Average engagement time is not in the stored analytics report.")];
    case "traffic_sources":
    case "organic_channels":
      return channelLines(loaded, compared);
    case "top_pages":
      return rankedLines(loaded.currentAnalytics.get("ga4.landing"), "sessions", "Top pages are not stored for this period.");
    case "devices":
      return deviceLines(loaded, compared);
    case "geography":
      return rankedLines(loaded.currentAnalytics.get("ga4.country"), "sessions", "A geographical breakdown is not stored for this period.");
    case "month_comparison":
    case "organic_comparison":
    case "lead_comparison":
      return [comparisonLine(loaded)];
    case "organic_sessions":
      return [metricLine("Organic sessions", channelMetric(loaded.current, "sessions", "organic_search"), channelMetric(loaded.previous, "sessions", "organic_search"), "count", compared, "Organic sessions are not added to paid sessions.")];
    case "search_impressions":
      return [metricLine("Impressions", headline(loaded.current, "impressions", { source: "search_console_export" }), headline(loaded.previous, "impressions", { source: "search_console_export" }), "count", compared, null)];
    case "organic_clicks":
      return [metricLine("Organic clicks", headline(loaded.current, "clicks", { source: "search_console_export" }), headline(loaded.previous, "clicks", { source: "search_console_export" }), "count", compared, "Search clicks are not treated as website sessions or enquiries.")];
    case "search_ctr":
      return [rateLine("Click-through rate", ctr(loaded.current, "search_console_export"), ctr(loaded.previous, "search_console_export"), compared, "Organic clicks divided by organic impressions.")];
    case "search_position":
      return [metricLine("Average position", positionReading(loaded.current, loaded.currentAnalytics), positionReading(loaded.previous, loaded.previousAnalytics), "position", compared, null)];
    case "top_queries":
      return rankedLines(loaded.currentAnalytics.get("gsc.queries"), "clicks", "Top queries are not stored for this period. Visible queries are not added up to rebuild the site total.");
    case "organic_landings":
      return rankedLines(loaded.currentAnalytics.get("gsc.pages"), "clicks", "Top organic landing pages are not stored for this period.");
    case "ranking_changes":
      return [rankingLine(loaded)];
    case "seo_checklist":
      return seoStatusLines(loaded);
    case "technical_seo":
      return technicalLines(loaded);
    case "gbp":
      return gbpLines(loaded);
    case "total_leads":
      return [metricLine("Recorded enquiries", headline(loaded.current, "enquiries", { source: "clinic_records" }), headline(loaded.previous, "enquiries", { source: "clinic_records" }), "count", compared, "Total leads are recorded enquiries. Form submissions and clicks are not added into this figure.")];
    case "form_submissions":
      return [metricLine("Form submissions", headline(loaded.current, "form_submissions"), headline(loaded.previous, "form_submissions"), "count", compared, "A form submission is listed separately from a recorded enquiry.")];
    case "whatsapp_clicks":
      return [clickLine("WhatsApp clicks", loaded, "contact_whatsapp", "A WhatsApp click is not a confirmed enquiry.")];
    case "call_clicks":
      return [clickLine("Call button clicks", loaded, "contact_phone", "A call-button click is not a confirmed enquiry.")];
    case "booking_clicks":
      return [clickLine("Booking link clicks", loaded, "contact_booking", "A booking-link click is not a confirmed appointment.")];
    case "conversion_rate":
      return [conversionLine(loaded, compared)];
    case "leads_by_source":
      return leadsBySource(loaded);
    case "cost_per_lead":
      return [cplLine(loaded, compared)];
    case "ad_spend":
      return [metricLine("Spend", headline(loaded.current, "cost", { source: "google_ads_export" }), headline(loaded.previous, "cost", { source: "google_ads_export" }), "sgd", compared, null)];
    case "ad_delivery":
      return [
        metricLine("Impressions", headline(loaded.current, "impressions", { source: "google_ads_export" }), headline(loaded.previous, "impressions", { source: "google_ads_export" }), "count", compared, null),
        metricLine("Clicks", headline(loaded.current, "clicks", { source: "google_ads_export" }), headline(loaded.previous, "clicks", { source: "google_ads_export" }), "count", compared, "Ad clicks are not enquiries."),
      ];
    case "ad_ctr":
      return [rateLine("CTR", ctr(loaded.current, "google_ads_export"), ctr(loaded.previous, "google_ads_export"), compared, "Ad clicks divided by ad impressions. Search Console clicks are not used.")];
    case "ad_cpc":
      return [moneyRateLine("Average CPC", per(headline(loaded.current, "cost", { source: "google_ads_export" }), headline(loaded.current, "clicks", { source: "google_ads_export" })), per(headline(loaded.previous, "cost", { source: "google_ads_export" }), headline(loaded.previous, "clicks", { source: "google_ads_export" })), compared, "Advertising cost divided by recorded ad clicks.")];
    case "ad_conversions":
      return [metricLine("Platform-reported conversions", headline(loaded.current, "conversions_reported", { source: "google_ads_export" }), headline(loaded.previous, "conversions_reported", { source: "google_ads_export" }), "count", compared, "These are platform-reported conversions, not confirmed enquiries or appointments.")];
    case "cost_per_conversion":
      return [moneyRateLine("Cost per conversion", per(headline(loaded.current, "cost", { source: "google_ads_export" }), headline(loaded.current, "conversions_reported", { source: "google_ads_export" })), per(headline(loaded.previous, "cost", { source: "google_ads_export" }), headline(loaded.previous, "conversions_reported", { source: "google_ads_export" })), compared, "Advertising cost divided by platform-reported conversions.")];
    case "campaign_performance":
      return [missingLine("Campaign performance", "Campaign totals are not stored separately from the account figures.")];
    case "ad_keywords":
      return [missingLine("Top-performing keywords", "Google Ads keywords are not stored for this period. Organic queries are not used in their place.")];
    case "search_vs_pmax":
      return [missingLine("Search versus Performance Max", "Search and Performance Max are not stored as separate campaign types, so they are not shown as a split.")];
    case "blogs_published":
      return [{ label: "Published in this period", current: String(loaded.blogPublished), previous: null, change: null, note: loaded.blogTitles.length ? loaded.blogTitles.join("; ") : "Count of articles first published in the reporting period." }];
    case "blog_views":
      return [metricLine("Blog views", headline(loaded.current, "post_views"), headline(loaded.previous, "post_views"), "count", compared, null)];
    case "top_posts":
      return [missingLine("Top-performing posts", "Views are not stored for individual posts, so a ranking is not estimated.")];
    case "organic_blog_traffic":
      return [missingLine("Organic blog traffic", "Organic traffic is not stored for blog URLs.")];
    case "blog_engagement":
      return [missingLine("Blog engagement", "Blog engagement is not in the stored analytics report.")];
    case "blog_leads":
      return [missingLine("Blog-generated leads", "Enquiry records are not linked to a blog post, so blog-generated leads are not estimated.")];
    case "blog_search":
      return blogSearchLines(loaded.currentAnalytics.get("gsc.pages"));
    case "new_vs_existing":
      return [
        { label: "New posts", current: String(loaded.blogPublished), previous: null, change: null, note: "First published in this period." },
        { label: "Existing published posts", current: String(loaded.blogExisting), previous: null, change: null, note: "Already published before this period and still published." },
      ];
    default:
      return [missingLine(itemKey, "This item is not recorded.")];
  }
}

function sessionReading(snaps: Snap[], analytics: Map<string, PublishedReport>): Reading {
  const fromApi = metricOn(analytics.get("ga4.traffic_range"), "range", "sessions");
  if (fromApi.state === "value") return fromApi;
  return headline(snaps, "sessions", { source: "ga4_export" });
}

function userReading(snaps: Snap[], analytics: Map<string, PublishedReport>): Reading {
  const fromApi = usersFromReport(analytics.get("ga4.traffic_range") ?? null);
  if (fromApi.state === "available") return { state: "value", value: fromApi.value };
  const stored = headline(snaps, "unique_visitors");
  if (stored.state === "value") return stored;
  return { state: "missing" };
}

function positionReading(snaps: Snap[], analytics: Map<string, PublishedReport>): Reading {
  const fromApi = metricOn(analytics.get("gsc.totals"), "range", "position");
  if (fromApi.state === "value") return fromApi;
  return headline(snaps, "avg_position", { source: "search_console_export" });
}

function headline(snaps: Snap[], metric: string, opts: { source?: string; channel?: string } = {}): Reading {
  const rows = snaps.filter((row) => row.metric === metric && row.dimension === "" && (!opts.source || row.source === opts.source) && (!opts.channel || row.channel === opts.channel));
  if (rows.length === 0) return { state: "missing" };
  const valued = rows.filter((row) => row.value !== null);
  if (valued.length === 0) return { state: "unavailable" };
  const combined = valued.find((row) => row.channel === "all");
  if (combined) return { state: "value", value: Number(combined.value) };
  const sources = [...new Set(valued.map((row) => row.source))];
  const source = opts.source && sources.includes(opts.source) ? opts.source : sources[0]!;
  const chosen = valued.filter((row) => row.source === source);
  return { state: "value", value: chosen.reduce((sum, row) => sum + Number(row.value), 0), note: sources.length > 1 ? "Another recorded source was not added." : undefined };
}

function channelMetric(snaps: Snap[], metric: string, channel: string): Reading {
  return headline(snaps, metric, { channel, source: "ga4_export" });
}

function ctr(snaps: Snap[], source: string): Reading {
  const clicks = headline(snaps, "clicks", { source });
  const impressions = headline(snaps, "impressions", { source });
  if (clicks.state !== "value" || impressions.state !== "value" || impressions.value <= 0) return { state: "missing" };
  return { state: "value", value: Number(((clicks.value / impressions.value) * 100).toFixed(1)) };
}

function per(numerator: Reading, denominator: Reading): Reading {
  if (numerator.state !== "value" || denominator.state !== "value" || denominator.value <= 0) return { state: "missing" };
  return { state: "value", value: Number((numerator.value / denominator.value).toFixed(2)) };
}

function metricOn(report: PublishedReport | undefined, dimensionKey: string, metric: string): Reading {
  const row = report?.rows.find((item) => item.dimensionKey === dimensionKey) ?? report?.rows[0];
  const found = row?.metrics.find((item) => item.key === metric);
  if (!found || found.state !== "available" || found.value === null) return { state: "missing" };
  return { state: "value", value: Number(found.value) };
}

function metricLine(label: string, current: Reading, previous: Reading, unit: "count" | "sgd" | "position", compared: boolean, note: string | null): ReportLine {
  return {
    label,
    current: show(current, unit),
    previous: compared ? show(previous, unit) : null,
    change: compared ? movement(current, previous, unit) : null,
    note: current.state === "value" ? note : note,
  };
}

function rateLine(label: string, current: Reading, previous: Reading, compared: boolean, note: string): ReportLine {
  return {
    label,
    current: current.state === "value" ? `${current.value}%` : "Not recorded",
    previous: compared ? (previous.state === "value" ? `${previous.value}%` : "Not recorded") : null,
    change: compared ? movement(current, previous, "percent") : null,
    note: current.state === "value" ? note : note,
  };
}

function moneyRateLine(label: string, current: Reading, previous: Reading, compared: boolean, note: string): ReportLine {
  return metricLine(label, current, previous, "sgd", compared, current.state === "value" ? note : note);
}

function missingLine(label: string, note: string): ReportLine {
  return { label, current: "Not recorded", previous: null, change: null, note };
}

function show(reading: Reading, unit: "count" | "sgd" | "position" | "percent"): string {
  if (reading.state === "missing") return "Not recorded";
  if (reading.state === "unavailable") return "Unavailable";
  if (unit === "sgd") return `SGD ${reading.value.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (unit === "position") return reading.value.toLocaleString("en-SG", { maximumFractionDigits: 1 });
  if (unit === "percent") return `${reading.value}%`;
  return reading.value.toLocaleString("en-SG");
}

function movement(current: Reading, previous: Reading, unit: string): string {
  if (current.state !== "value" || previous.state !== "value") return "Not recorded";
  if (previous.value === 0) return "Zero baseline, no %";
  const change = Number((((current.value - previous.value) / previous.value) * 100).toFixed(1));
  if (unit === "position") return `${formatSigned(Number((previous.value - current.value).toFixed(1)))} places`;
  return formatSigned(change) + "%";
}

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-SG");
}

function channelLines(loaded: Loaded, compared: boolean): ReportLine[] {
  const report = loaded.currentAnalytics.get("ga4.acquisition");
  if (report && report.rows.length > 0) {
    return report.rows.slice(0, 8).map((row) => {
      const metric = row.metrics.find((item) => item.key === "sessions");
      const value = metric && metric.state === "available" && metric.value !== null ? metric.value.toLocaleString("en-SG") : "Not recorded";
      return { label: row.dimensionKey || "Channel", current: value, previous: null, change: null, note: "Sessions by channel. Paid and organic are not added into one visit total." };
    });
  }
  const channels = [...new Set(loaded.current.filter((row) => row.metric === "sessions" && row.dimension === "" && row.channel !== "all").map((row) => row.channel))];
  if (channels.length === 0) return [missingLine("Channels", "Traffic sources are not stored for this period.")];
  return channels.map((channel) => metricLine(channel.replace(/_/g, " "), channelMetric(loaded.current, "sessions", channel), channelMetric(loaded.previous, "sessions", channel), "count", compared, null));
}

function deviceLines(loaded: Loaded, compared: boolean): ReportLine[] {
  const report = loaded.currentAnalytics.get("ga4.device");
  if (report && report.rows.length > 0) return rankedLines(report, "sessions", "A device breakdown is not stored for this period.");
  const devices = [...new Set(loaded.current.filter((row) => row.metric === "device_sessions").map((row) => row.channel))];
  if (devices.length === 0) return [missingLine("Devices", "A device breakdown is not stored for this period.")];
  return devices.map((device) => metricLine(device, headline(loaded.current, "device_sessions", { channel: device }), headline(loaded.previous, "device_sessions", { channel: device }), "count", compared, null));
}

function rankedLines(report: PublishedReport | undefined, metric: string, empty: string): ReportLine[] {
  if (!report || report.rows.length === 0) return [missingLine("Breakdown", empty)];
  const ranked = report.rows
    .map((row) => ({ label: row.dimensionKey, metric: row.metrics.find((item) => item.key === metric) }))
    .filter((row) => row.metric && row.metric.state === "available" && row.metric.value !== null)
    .sort((left, right) => Number(right.metric!.value) - Number(left.metric!.value))
    .slice(0, 8);
  if (ranked.length === 0) return [missingLine("Breakdown", empty)];
  return ranked.map((row) => ({
    label: row.label,
    current: Number(row.metric!.value).toLocaleString("en-SG"),
    previous: null,
    change: null,
    note: "Top stored rows. They are not a complete list, and they are not added up to rebuild a total.",
  }));
}

function comparisonLine(loaded: Loaded): ReportLine {
  if (!loaded.compared) return missingLine("Comparison", "Set a comparison period to show movement. Nothing is filled in as zero.");
  return { label: "Comparison", current: "Included on the figures above and below", previous: null, change: null, note: "Movement is shown only where both periods have a recorded figure. Different period lengths are not treated as like-for-like." };
}

function clickLine(label: string, loaded: Loaded, metric: string, note: string): ReportLine {
  const current = headline(loaded.current, metric);
  if (current.state === "missing" && headline(loaded.current, "contact_clicks").state === "value") {
    return missingLine(label, `Only an undifferentiated contact click is recorded. ${note}`);
  }
  return metricLine(label, current, headline(loaded.previous, metric), "count", loaded.compared, note);
}

function conversionLine(loaded: Loaded, compared: boolean): ReportLine {
  const current = conversionRate(valueOf(headline(loaded.current, "enquiries", { source: "clinic_records" })), valueOf(sessionReading(loaded.current, loaded.currentAnalytics)));
  const previous = conversionRate(valueOf(headline(loaded.previous, "enquiries", { source: "clinic_records" })), valueOf(sessionReading(loaded.previous, loaded.previousAnalytics)));
  return rateLine("Conversion rate", current.value === null ? { state: "missing" } : { state: "value", value: current.value }, previous.value === null ? { state: "missing" } : { state: "value", value: previous.value }, compared, current.note);
}

function cplLine(loaded: Loaded, compared: boolean): ReportLine {
  const current = costPerLead(valueOf(headline(loaded.current, "cost", { source: "google_ads_export" })), valueOf(headline(loaded.current, "enquiries", { source: "clinic_records" })));
  const previous = costPerLead(valueOf(headline(loaded.previous, "cost", { source: "google_ads_export" })), valueOf(headline(loaded.previous, "enquiries", { source: "clinic_records" })));
  return moneyRateLine("Cost per lead", current.value === null ? { state: "missing" } : { state: "value", value: current.value }, previous.value === null ? { state: "missing" } : { state: "value", value: previous.value }, compared, current.note);
}

function valueOf(reading: Reading): number | null {
  return reading.state === "value" ? reading.value : null;
}

function leadsBySource(loaded: Loaded): ReportLine[] {
  const rows = loaded.current.filter((row) => row.metric === "enquiries" && row.dimension === "" && row.channel !== "all" && row.value !== null);
  if (rows.length === 0) return [missingLine("Leads by source", "Enquiries are not stored by traffic source, so they are not split from the total.")];
  return rows.map((row) => ({ label: row.channel.replace(/_/g, " "), current: Number(row.value).toLocaleString("en-SG"), previous: null, change: null, note: "Recorded enquiries in this channel." }));
}

function rankingLine(loaded: Loaded): ReportLine {
  const current = positionReading(loaded.current, loaded.currentAnalytics);
  const previous = positionReading(loaded.previous, loaded.previousAnalytics);
  if (current.state !== "value") return missingLine("Keyword ranking changes", "Keyword ranking changes are not recorded. Average position is not estimated from the visible queries.");
  return metricLine("Average position", current, previous, "position", loaded.compared, "A change in average position is not a keyword-by-keyword ranking table.");
}

function seoStatusLines(loaded: Loaded): ReportLine[] {
  if (loaded.seoStatuses.length === 0) return [missingLine("Mapped pages", "No SEO page map is recorded for this website.")];
  return loaded.seoStatuses.map((row) => ({
    label: row.status.replace(/_/g, " "),
    current: String(row.count),
    previous: null,
    change: null,
    note: "Count of mapped pages in this status. This is not a completed technical checklist.",
  }));
}

function technicalLines(loaded: Loaded): ReportLine[] {
  if (loaded.seoFlags.length === 0) return [{ label: "Mapping flags", current: "None recorded", previous: null, change: null, note: "Pages with a mapping flag other than none would be listed here." }];
  return loaded.seoFlags.map((row) => ({ label: row.path, current: row.flag.replace(/_/g, " "), previous: null, change: null, note: row.note }));
}

function gbpLines(loaded: Loaded): ReportLine[] {
  if (loaded.profiles.length === 0) return [missingLine("Business Profile", "No Google Business Profile record is stored. Performance figures are not connected.")];
  return loaded.profiles.map((row) => ({
    label: row.name,
    current: row.status.replace(/_/g, " "),
    previous: null,
    change: null,
    note: "Setup status only. Profile views, calls and direction requests are not connected.",
  }));
}

function blogSearchLines(report: PublishedReport | undefined): ReportLine[] {
  if (!report) return [missingLine("Blog search", "Search impressions and clicks are not stored for blog URLs.")];
  const rows = report.rows.filter((row) => row.dimensionKey.includes("/blog"));
  if (rows.length === 0) return [missingLine("Blog search", "None of the stored top pages is a blog URL. A blog total is not estimated.")];
  return rows.slice(0, 8).map((row) => {
    const clicks = row.metrics.find((item) => item.key === "clicks");
    const impressions = row.metrics.find((item) => item.key === "impressions");
    const clickText = clicks && clicks.state === "available" && clicks.value !== null ? `${clicks.value.toLocaleString("en-SG")} clicks` : "Clicks not recorded";
    const impressionText = impressions && impressions.state === "available" && impressions.value !== null ? `${impressions.value.toLocaleString("en-SG")} impressions` : "Impressions not recorded";
    return { label: row.dimensionKey, current: `${impressionText}; ${clickText}`, previous: null, change: null, note: "A stored top page. These rows are not added up to a blog total." };
  });
}
