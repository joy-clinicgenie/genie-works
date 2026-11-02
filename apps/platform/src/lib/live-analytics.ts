import {
  dailySessionSeriesWithPeriod,
  listConnections,
  publishedReport,
  type PublishedReport,
} from "@clinic-genie/db";
import type { Queryable } from "@clinic-genie/db";
import type { SiteView } from "@/lib/site-view";

export interface LiveValue {
  value: number | null;
  state: "available" | "unavailable" | "not_connected";
  note: string;
}

export interface LiveBundle {
  provider: "ga4" | "wix" | null;
  providerStatus: string | null;
  conflict: boolean;
  searchStatus: string | null;
  sessions: LiveValue;
  users: LiveValue;
  sessionsPrevious: number | null;
  usersPrevious: number | null;
  dailyCurrent: Array<{ date: string; value: number | null }>;
  dailyPrevious: Array<{ date: string; value: number | null }>;
  sources: PublishedReport | null;
  sourcesPrevious: PublishedReport | null;
  landing: PublishedReport | null;
  devices: PublishedReport | null;
  countries: PublishedReport | null;
}

function empty(note: string, state: LiveValue["state"] = "unavailable"): LiveValue {
  return { value: null, state, note };
}

function fromPeriod(period: { value: number | null; state: "available" | "unavailable"; covered: number; expected: number }, noun: string): LiveValue {
  if (period.state === "available") return { value: period.value, state: "available", note: `${period.covered} complete days` };
  return empty(`${period.covered} of ${period.expected} days recorded. ${noun} for this period is unavailable.`);
}

export async function loadLiveBundle(db: Queryable, view: SiteView): Promise<LiveBundle> {
  const start = view.current?.start;
  const end = view.current?.end;
  const connections = view.websiteId ? await listConnections(db, view.clientId) : [];
  const active = connections.filter((row) => row.website_id === view.websiteId && row.disconnected_at === null);
  const traffic = active.filter((row) => row.provider === "ga4" || row.provider === "wix");
  const search = active.find((row) => row.provider === "gsc") ?? null;
  const conflict = traffic.length > 1;
  const chosen = conflict ? null : traffic[0] ?? null;
  const provider = chosen?.provider === "ga4" || chosen?.provider === "wix" ? chosen.provider : null;
  const blank: LiveBundle = {
    provider,
    providerStatus: chosen?.status ?? null,
    conflict,
    searchStatus: search?.status ?? null,
    sessions: empty(chosen ? "Unavailable" : "Not connected", chosen ? "unavailable" : "not_connected"),
    users: empty("Unique visitors for an exact period are unavailable.", chosen ? "unavailable" : "not_connected"),
    sessionsPrevious: null,
    usersPrevious: null,
    dailyCurrent: [],
    dailyPrevious: [],
    sources: null,
    sourcesPrevious: null,
    landing: null,
    devices: null,
    countries: null,
  };
  if (!view.websiteId || !start || !end || !chosen || chosen.status !== "connected") return blank;
  const dailyKey = chosen.provider === "ga4" ? "ga4.traffic_daily" : "wix.data_daily";
  const sessionMetric = chosen.provider === "ga4" ? "sessions" : "total_sessions";
  const seriesInput = { clientId: view.clientId, websiteId: view.websiteId, templateKey: dailyKey, metric: sessionMetric };
  const currentDaily = await dailySessionSeriesWithPeriod(db, { ...seriesInput, start, end });
  const sessions = fromPeriod(currentDaily.period, "Sessions");
  const range = chosen.provider === "ga4"
    ? await publishedReport(db, { clientId: view.clientId, websiteId: view.websiteId, templateKey: "ga4.traffic_range", start, end })
    : null;
  const usersMetric = range?.rows[0]?.metrics.find((metric) => metric.key === "totalUsers");
  const users: LiveValue = usersMetric?.state === "available"
    ? { value: usersMetric.value, state: "available", note: "Exact period. Daily users are not added together." }
    : empty(chosen.provider === "wix" ? "Daily unique visitors are not added together." : "An exact-period user total has not been stored.");
  const previous = view.previous;
  const previousDaily = previous ? await dailySessionSeriesWithPeriod(db, { ...seriesInput, start: previous.start, end: previous.end }) : null;
  let sessionsPrevious: number | null = null;
  if (previousDaily) {
    sessionsPrevious = previousDaily.period.state === "available" ? previousDaily.period.value : null;
  }
  const exact = (templateKey: string, rangeStart = start, rangeEnd = end) => publishedReport(db, { clientId: view.clientId, websiteId: view.websiteId!, templateKey, start: rangeStart, end: rangeEnd });
  const priorUsers = previous && chosen.provider === "ga4"
    ? await exact("ga4.traffic_range", previous.start, previous.end)
    : null;
  const priorUsersMetric = priorUsers?.rows[0]?.metrics.find((metric) => metric.key === "totalUsers" && metric.state === "available");
  return {
    ...blank,
    sessions,
    users,
    sessionsPrevious,
    usersPrevious: priorUsersMetric?.value ?? null,
    dailyCurrent: currentDaily.series,
    dailyPrevious: previousDaily?.series ?? [],
    sources: chosen.provider === "ga4" ? await exact("ga4.acquisition") : null,
    sourcesPrevious: previous && chosen.provider === "ga4" ? await exact("ga4.acquisition", previous.start, previous.end) : null,
    landing: chosen.provider === "ga4" ? await exact("ga4.landing") : null,
    devices: chosen.provider === "ga4" ? await exact("ga4.device") : null,
    countries: chosen.provider === "ga4" ? await exact("ga4.country") : null,
  };
}
