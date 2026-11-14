import type { PublishedReport } from "@clinic-genie/db";
import type { LiveBundle } from "@/lib/live-analytics";
import { channelsFor, dimensionRows, pairMetric, type MetricPair } from "@/lib/site-metrics";
import type { SiteView } from "@/lib/site-view";

export interface AnalyticsFigure {
  current: number | null;
  previous: number | null;
  percent: number | null;
  unit: "count" | "percent" | "duration";
}

export interface ChannelRow {
  channel: string;
  name: string;
  current: number;
  previous: number | null;
  percent: number | null;
  share: number | null;
}

export interface LandingRow {
  name: string;
  sessions: number;
  share: number | null;
  contacts: number | null;
  contactRate: number | null;
}

export interface PageRow {
  name: string;
  visits: number | null;
  time: number | null;
  exitRate: number | null;
}

export interface NamedFigure {
  name: string;
  current: number | null;
  previous: number | null;
  percent: number | null;
}

export interface TrendPoint {
  label: string;
  current: number | null;
  previous: number | null;
}

export interface AnalyticsTrend {
  mode: "daily" | "period";
  points: TrendPoint[];
}

export interface AnalyticsBoard {
  sourceNote: string;
  updatedAt: Date | null;
  sessions: AnalyticsFigure;
  users: AnalyticsFigure;
  leads: AnalyticsFigure;
  conversionRate: AnalyticsFigure;
  engagementRate: AnalyticsFigure;
  organic: AnalyticsFigure;
  channels: ChannelRow[];
  landing: LandingRow[];
  converting: LandingRow[];
  trend: AnalyticsTrend;
  devices: NamedFigure[];
  newVisitors: AnalyticsFigure;
  returningVisitors: AnalyticsFigure;
  countries: Array<{ name: string; sessions: number }>;
  pages: PageRow[];
  duration: AnalyticsFigure;
  pagesPerSession: AnalyticsFigure;
  bounceRate: AnalyticsFigure;
  events: NamedFigure[];
  formStarts: AnalyticsFigure;
  formSubmissions: AnalyticsFigure;
  flows: Array<{ name: string; current: number }>;
  /** Live mode only: which Behaviour figures are from Google Analytics and which are from the recorded export (D53). */
  behaviourNote: string | null;
}

const SNAPSHOT_SOURCE = "Traffic is from the recorded website analytics export. Leads are stored clinic enquiries.";

const CHANNEL_NAMES: Record<string, string> = {
  paid_search: "Paid",
  organic_search: "Organic",
  direct: "Direct",
  referral: "Referral",
  social: "Social",
  email: "Email",
  "paid search": "Paid",
  "organic search": "Organic",
  "paid social": "Paid social",
  "organic social": "Social",
  unassigned: "Unassigned",
  "cross-network": "Cross-network",
  display: "Display",
};

export function channelName(channel: string): string {
  const spaced = channel.trim().toLowerCase().replace(/_/g, " ");
  return CHANNEL_NAMES[channel] ?? CHANNEL_NAMES[spaced] ?? CHANNEL_NAMES[channel.trim().toLowerCase()] ?? channel.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export function isOrganicChannel(channel: string): boolean {
  const key = channel.trim().toLowerCase().replace(/_/g, " ");
  return key === "organic search" || key === "organic";
}

export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export function figure(current: number | null, previous: number | null, unit: AnalyticsFigure["unit"]): AnalyticsFigure {
  return { current, previous, percent: percentChange(current, previous), unit };
}

/** Stored enquiries divided by visitors. Missing values and a zero visitor count stay unrecorded. */
export function visitorToLeadRate(leads: number | null, visitors: number | null): number | null {
  if (leads === null || visitors === null || visitors <= 0) return null;
  return Number(((leads / visitors) * 100).toFixed(1));
}

/** Organic-search sessions only. Search Console clicks and other channels are left out. */
export function organicFromChannels(channels: Array<{ channel: string; current: number; previous: number | null }>): { current: number | null; previous: number | null } {
  const matched = channels.filter((row) => isOrganicChannel(row.channel));
  if (matched.length === 0) return { current: null, previous: null };
  const current = matched.reduce((sum, row) => sum + row.current, 0);
  const previous = matched.every((row) => row.previous !== null)
    ? matched.reduce((sum, row) => sum + (row.previous ?? 0), 0)
    : null;
  return { current, previous };
}

export function alignDailyTrend(current: Array<{ date: string; value: number | null }>, previous: Array<{ date: string; value: number | null }>): TrendPoint[] {
  return current.map((point, index) => ({
    label: shortDay(point.date),
    current: point.value,
    previous: previous[index]?.value ?? null,
  }));
}

export function trendFrom(currentSessions: number | null, previousSessions: number | null, dailyCurrent: Array<{ date: string; value: number | null }>, dailyPrevious: Array<{ date: string; value: number | null }>): AnalyticsTrend {
  const points = alignDailyTrend(dailyCurrent, dailyPrevious);
  if (points.some((point) => point.current !== null)) return { mode: "daily", points };
  return {
    mode: "period",
    points: [
      { label: "Previous period", current: previousSessions, previous: null },
      { label: "Current period", current: currentSessions, previous: null },
    ],
  };
}

function shortDay(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function fromPair(pair: MetricPair, unit: AnalyticsFigure["unit"]): AnalyticsFigure {
  return figure(pair.current, pair.previous, unit);
}

function emptyFigure(unit: AnalyticsFigure["unit"]): AnalyticsFigure {
  return figure(null, null, unit);
}

function pairStored(view: Pick<SiteView, "snapshots" | "current" | "previous">, metric: string, source: string, channel?: string): MetricPair {
  return pairMetric(view.snapshots, { current: view.current, previous: view.previous }, metric, source, channel);
}

function engagementPair(view: Pick<SiteView, "snapshots" | "current" | "previous">): MetricPair {
  for (const source of ["ga4_export", "manual", "other"]) {
    const pair = pairStored(view, "engagement_rate", source, "all");
    if (pair.current !== null || pair.previous !== null) return pair;
  }
  return { current: null, previous: null, percent: null };
}

function withShare(rows: Array<Omit<ChannelRow, "share">>): ChannelRow[] {
  const total = rows.reduce((sum, row) => sum + row.current, 0);
  return rows
    .map((row) => ({ ...row, share: total > 0 ? Number(((row.current / total) * 100).toFixed(1)) : null }))
    .sort((a, b) => b.current - a.current || a.name.localeCompare(b.name));
}

function landingRows(sessions: Array<{ name: string; current: number }>, contacts: Map<string, number>): LandingRow[] {
  const total = sessions.reduce((sum, row) => sum + row.current, 0);
  return sessions.map((row) => {
    const contactCount = contacts.has(row.name) ? contacts.get(row.name)! : null;
    return {
      name: row.name,
      sessions: row.current,
      share: total > 0 ? Number(((row.current / total) * 100).toFixed(1)) : null,
      contacts: contactCount,
      contactRate: contactCount !== null && row.current > 0 ? Number(((contactCount / row.current) * 100).toFixed(1)) : null,
    };
  }).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
}

function convertingRows(rows: LandingRow[]): LandingRow[] {
  if (!rows.some((row) => row.contacts !== null)) return [];
  return [...rows].sort((a, b) => (b.contacts ?? -1) - (a.contacts ?? -1) || (b.contactRate ?? -1) - (a.contactRate ?? -1) || a.name.localeCompare(b.name));
}

function pageRows(view: Pick<SiteView, "snapshots" | "current">): PageRow[] {
  const visits = dimensionRows(view.snapshots, view.current, "page_visits", "manual");
  const time = new Map(dimensionRows(view.snapshots, view.current, "page_time", "manual").map((row) => [row.name, row.current]));
  const exit = new Map(dimensionRows(view.snapshots, view.current, "page_exit_rate", "manual").map((row) => [row.name, row.current]));
  const names = [...new Set([...visits.map((row) => row.name), ...time.keys(), ...exit.keys()])];
  return names.map((name) => ({
    name,
    visits: visits.find((row) => row.name === name)?.current ?? null,
    time: time.get(name) ?? null,
    exitRate: exit.get(name) ?? null,
  })).sort((a, b) => (b.visits ?? -1) - (a.visits ?? -1) || a.name.localeCompare(b.name));
}

export function boardFromSnapshots(view: Pick<SiteView, "snapshots" | "current" | "previous" | "updatedAt">): AnalyticsBoard {
  const periods = { current: view.current, previous: view.previous };
  const sessions = fromPair(pairMetric(view.snapshots, periods, "sessions", "ga4_export"), "count");
  const users = fromPair(pairStored(view, "unique_visitors", "manual", "all"), "count");
  const leads = fromPair(pairStored(view, "enquiries", "clinic_records", "all"), "count");
  const channelPairs = channelsFor(view.snapshots, view.current, "sessions", "ga4_export", view.previous);
  const channels = withShare(channelPairs.map((row) => ({
    channel: row.channel,
    name: channelName(row.channel),
    current: row.current,
    previous: row.previous,
    percent: percentChange(row.current, row.previous),
  })));
  const organic = organicFromChannels(channelPairs);
  const contacts = new Map(dimensionRows(view.snapshots, view.current, "landing_contacts", "manual").map((row) => [row.name, row.current]));
  const landing = landingRows(dimensionRows(view.snapshots, view.current, "landing_sessions", "manual"), contacts);
  const eventMetrics = [
    ["WhatsApp", "contact_whatsapp"],
    ["Phone", "contact_phone"],
    ["Email", "contact_email"],
    ["Booking link", "contact_booking"],
  ] as const;
  return {
    sourceNote: SNAPSHOT_SOURCE,
    updatedAt: view.updatedAt,
    sessions,
    users,
    leads,
    conversionRate: figure(visitorToLeadRate(leads.current, users.current), visitorToLeadRate(leads.previous, users.previous), "percent"),
    engagementRate: fromPair(engagementPair(view), "percent"),
    organic: figure(organic.current, organic.previous, "count"),
    channels,
    landing,
    converting: convertingRows(landing),
    trend: trendFrom(sessions.current, sessions.previous, [], []),
    devices: ["Mobile", "Desktop", "Tablet"].map((name) => {
      const pair = pairStored(view, "device_sessions", "manual", name.toLowerCase());
      return { name, current: pair.current, previous: pair.previous, percent: pair.percent };
    }),
    newVisitors: fromPair(pairStored(view, "new_visitors", "manual", "all"), "count"),
    returningVisitors: fromPair(pairStored(view, "returning_visitors", "manual", "all"), "count"),
    countries: [],
    pages: pageRows(view),
    duration: fromPair(pairStored(view, "avg_session_duration", "ga4_export", "all"), "duration"),
    pagesPerSession: fromPair(pairStored(view, "pages_per_session", "ga4_export", "all"), "count"),
    bounceRate: fromPair(pairStored(view, "bounce_rate", "ga4_export", "all"), "percent"),
    events: eventMetrics.map(([name, metric]) => {
      const pair = pairStored(view, metric, "manual", "all");
      return { name, current: pair.current, previous: pair.previous, percent: pair.percent };
    }),
    formStarts: fromPair(pairStored(view, "form_starts", "manual", "all"), "count"),
    formSubmissions: fromPair(pairStored(view, "form_submissions", "manual", "all"), "count"),
    flows: dimensionRows(view.snapshots, view.current, "nav_flow", "manual").map((row) => ({ name: row.name, current: row.current })),
    behaviourNote: null,
  };
}

/** Google Analytics Behaviour figures for the selected window (D53). Rates are GA4 fractions. */
export interface LiveBehaviourFacts {
  engagementRate: number | null;
  averageSessionDuration: number | null;
  pagesPerSession: number | null;
  bounceRate: number | null;
  pages: Array<{ name: string; views: number; engagementSeconds: number | null; activeUsers: number | null }>;
  newVisitors: number | null;
  returningVisitors: number | null;
}

export interface LiveTrafficFacts {
  connected: boolean;
  provider: "ga4" | "wix" | null;
  sourceNote: string;
  updatedAt: Date | null;
  sessions: number | null;
  sessionsPrevious: number | null;
  users: number | null;
  usersPrevious: number | null;
  channels: Array<{ channel: string; current: number; previous: number | null }> | null;
  landing: Array<{ name: string; sessions: number }> | null;
  devices: Array<{ name: string; sessions: number }> | null;
  countries: Array<{ name: string; sessions: number }> | null;
  dailyCurrent: Array<{ date: string; value: number | null }>;
  dailyPrevious: Array<{ date: string; value: number | null }>;
  behaviour: LiveBehaviourFacts | null;
}

function availableMetric(row: { metrics: Array<{ key: string; value: number | null; state: string }> }, keys: string[]): number | null {
  for (const key of keys) {
    const found = row.metrics.find((metric) => metric.key === key && metric.state === "available" && metric.value !== null);
    if (found?.value !== null && found?.value !== undefined) return Number(found.value);
  }
  return null;
}

function reportNumberRows(report: PublishedReport | null, keys: string[]): Array<{ name: string; current: number }> {
  if (!report) return [];
  return report.rows.flatMap((row) => {
    const current = availableMetric(row, keys);
    return current === null ? [] : [{ name: row.dimensionKey || "Unknown", current }];
  });
}

function sourceNote(bundle: LiveBundle): string {
  if (bundle.conflict) return "Two traffic sources are connected. Choose one before traffic totals are shown. Leads are stored clinic enquiries.";
  if (bundle.providerStatus === "reconnect_required") return "The traffic connection needs to be reconnected. Leads are stored clinic enquiries.";
  if (bundle.provider === "ga4" && bundle.providerStatus === "connected") return "Traffic is from Google Analytics. Leads are stored clinic enquiries.";
  if (bundle.provider === "wix" && bundle.providerStatus === "connected") return "Traffic is from Wix. Leads are stored clinic enquiries.";
  return "Traffic source is not connected. Leads are stored clinic enquiries.";
}

function latestFetch(bundle: LiveBundle): Date | null {
  const dates = [bundle.sources, bundle.landing, bundle.devices, bundle.countries, bundle.engagement, bundle.pages, bundle.visitorType].flatMap((report) => (report ? [report.fetchedAt] : []));
  return dates.reduce<Date | null>((latest, date) => (!latest || date > latest ? date : latest), null);
}

function behaviourFromBundle(bundle: LiveBundle): LiveBehaviourFacts | null {
  if (!bundle.engagement && !bundle.pages && !bundle.visitorType) return null;
  const totals = bundle.engagement?.rows[0];
  const metric = (key: string) => (totals ? availableMetric(totals, [key]) : null);
  const visitors = (kind: string) => {
    const row = bundle.visitorType?.rows.find((item) => item.dimensionKey.toLowerCase() === kind);
    return row ? availableMetric(row, ["activeUsers"]) : null;
  };
  return {
    engagementRate: metric("engagementRate"),
    averageSessionDuration: metric("averageSessionDuration"),
    pagesPerSession: metric("screenPageViewsPerSession"),
    bounceRate: metric("bounceRate"),
    pages: (bundle.pages?.rows ?? []).flatMap((row) => {
      const views = availableMetric(row, ["screenPageViews"]);
      return views === null ? [] : [{
        name: row.dimensionKey || "Unknown",
        views,
        engagementSeconds: availableMetric(row, ["userEngagementDuration"]),
        activeUsers: availableMetric(row, ["activeUsers"]),
      }];
    }),
    newVisitors: visitors("new"),
    returningVisitors: visitors("returning"),
  };
}

/** Previous-window devices, pages and visitor split for the breakdown reports (D56). */
export interface PreviousDetailFacts {
  devices: Array<{ name: string; sessions: number }> | null;
  behaviour: LiveBehaviourFacts | null;
}

export function previousDetailFacts(bundle: LiveBundle, detail: { devices: PublishedReport | null; pages: PublishedReport | null; visitorType: PublishedReport | null }): PreviousDetailFacts {
  return {
    devices: detail.devices ? reportNumberRows(detail.devices, ["sessions"]).map((row) => ({ name: channelName(row.name), sessions: row.current })) : null,
    behaviour: behaviourFromBundle({ ...bundle, engagement: null, pages: detail.pages, visitorType: detail.visitorType }),
  };
}

export function liveFactsFromBundle(bundle: LiveBundle): LiveTrafficFacts {
  const connected = Boolean(bundle.provider) && bundle.providerStatus === "connected" && !bundle.conflict;
  const previousByChannel = new Map((bundle.sourcesPrevious?.rows ?? []).map((row) => [row.dimensionKey, availableMetric(row, ["sessions"])]));
  const channels = bundle.sources
    ? reportNumberRows(bundle.sources, ["sessions"]).map((row) => ({ channel: row.name, current: row.current, previous: previousByChannel.get(row.name) ?? null }))
    : null;
  return {
    connected,
    provider: bundle.provider,
    sourceNote: sourceNote(bundle),
    updatedAt: latestFetch(bundle),
    sessions: connected && bundle.sessions.state === "available" ? bundle.sessions.value : null,
    sessionsPrevious: connected ? bundle.sessionsPrevious : null,
    users: connected && bundle.users.state === "available" ? bundle.users.value : null,
    usersPrevious: connected ? bundle.usersPrevious : null,
    channels: connected ? channels : null,
    landing: connected && bundle.landing ? reportNumberRows(bundle.landing, ["sessions", "screenPageViews"]).map((row) => ({ name: row.name, sessions: row.current })) : connected ? [] : null,
    devices: connected && bundle.devices ? reportNumberRows(bundle.devices, ["sessions"]).map((row) => ({ name: channelName(row.name), sessions: row.current })) : connected ? [] : null,
    countries: connected && bundle.countries ? reportNumberRows(bundle.countries, ["sessions"]).map((row) => ({ name: row.name, sessions: row.current })) : connected ? [] : null,
    dailyCurrent: connected ? bundle.dailyCurrent : [],
    dailyPrevious: connected ? bundle.dailyPrevious : [],
    behaviour: connected && bundle.provider === "ga4" ? behaviourFromBundle(bundle) : null,
  };
}

/** A GA4 fraction as a percentage with one decimal, as the board shows rates. */
function fractionToPercent(value: number | null): number | null {
  return value === null ? null : Number((value * 100).toFixed(1));
}

const GA4_BEHAVIOUR_NOTE = "Engagement, page views and new or returning visitors are from Google Analytics; time on page is its engagement time per active user. Form starts, submissions, contact clicks, exit rate and recorded paths are from the recorded export.";
const UNCONNECTED_BEHAVIOUR_NOTE = "Behaviour figures are from the recorded export.";
const EXPORT_BEHAVIOUR_NOTE = "Behaviour figures are from the recorded export. Wix behaviour is not synced.";

/** Behaviour figures in live mode (D53). GA4 values replace the export; a missing GA4 value stays unavailable. */
function liveBehaviour(base: AnalyticsBoard, facts: LiveTrafficFacts): Partial<AnalyticsBoard> {
  if (facts.provider !== "ga4") return { behaviourNote: EXPORT_BEHAVIOUR_NOTE };
  const behaviour = facts.behaviour;
  const pages: PageRow[] = (behaviour?.pages ?? [])
    .map((row) => ({
      name: row.name,
      visits: row.views,
      time: row.engagementSeconds !== null && row.activeUsers ? Number((row.engagementSeconds / row.activeUsers).toFixed(1)) : null,
      exitRate: null,
    }))
    .sort((a, b) => (b.visits ?? -1) - (a.visits ?? -1) || a.name.localeCompare(b.name));
  return {
    behaviourNote: base.behaviourNote ?? GA4_BEHAVIOUR_NOTE,
    engagementRate: figure(fractionToPercent(behaviour?.engagementRate ?? null), null, "percent"),
    bounceRate: figure(fractionToPercent(behaviour?.bounceRate ?? null), null, "percent"),
    duration: figure(behaviour?.averageSessionDuration ?? null, null, "duration"),
    pagesPerSession: figure(behaviour?.pagesPerSession ?? null, null, "count"),
    pages,
    newVisitors: figure(behaviour?.newVisitors ?? null, null, "count"),
    returningVisitors: figure(behaviour?.returningVisitors ?? null, null, "count"),
  };
}

export function boardFromLive(base: AnalyticsBoard, facts: LiveTrafficFacts): AnalyticsBoard {
  if (!facts.connected) {
    return {
      ...base,
      sourceNote: facts.sourceNote,
      updatedAt: facts.updatedAt,
      sessions: emptyFigure("count"),
      users: emptyFigure("count"),
      organic: emptyFigure("count"),
      conversionRate: emptyFigure("percent"),
      channels: [],
      landing: [],
      converting: [],
      devices: [],
      countries: [],
      trend: trendFrom(null, null, [], []),
      behaviourNote: UNCONNECTED_BEHAVIOUR_NOTE,
    };
  }
  const channels = withShare((facts.channels ?? []).map((row) => ({
    channel: row.channel,
    name: channelName(row.channel),
    current: row.current,
    previous: row.previous,
    percent: percentChange(row.current, row.previous),
  })));
  const organic = organicFromChannels(facts.channels ?? []);
  const contactByName = new Map(base.landing.map((row) => [row.name, row.contacts]));
  const landing = facts.landing === null
    ? base.landing
    : landingRows(facts.landing.map((row) => ({ name: row.name, current: row.sessions })), new Map(
      facts.landing.flatMap((row) => {
        const contacts = contactByName.get(row.name);
        return contacts === null || contacts === undefined ? [] : [[row.name, contacts] as const];
      }),
    ));
  return {
    ...base,
    sourceNote: facts.sourceNote,
    updatedAt: facts.updatedAt,
    sessions: figure(facts.sessions, facts.sessionsPrevious, "count"),
    users: figure(facts.users, facts.usersPrevious, "count"),
    conversionRate: figure(visitorToLeadRate(base.leads.current, facts.users), visitorToLeadRate(base.leads.previous, facts.usersPrevious), "percent"),
    organic: figure(organic.current, organic.previous, "count"),
    channels,
    landing,
    converting: convertingRows(landing),
    devices: (facts.devices ?? []).map((row) => ({ name: row.name, current: row.sessions, previous: null, percent: null })),
    countries: [...(facts.countries ?? [])].sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)),
    trend: trendFrom(facts.sessions, facts.sessionsPrevious, facts.dailyCurrent, facts.dailyPrevious),
    ...liveBehaviour(base, facts),
  };
}
