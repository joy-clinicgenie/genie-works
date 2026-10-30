import {
  additivePeriod,
  dailySessionSeries,
  dailySessionsForWeekday,
  listConnections,
  percentChange,
  publishedReport,
  type PublishedReport,
} from "@clinic-genie/db";
import type { Queryable } from "@clinic-genie/db";
import { pairMetric } from "@/lib/site-metrics";
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
  contacts: LiveValue;
  forms: LiveValue;
  enquiries: { current: number | null; previous: number | null };
  sessionsPrevious: number | null;
  usersPrevious: number | null;
  weekdays: Array<{ weekday: string; average: number | null; covered: number }>;
  dailyCurrent: Array<{ date: string; value: number | null }>;
  dailyPrevious: Array<{ date: string; value: number | null }>;
  sources: PublishedReport | null;
  sourcesPrevious: PublishedReport | null;
  landing: PublishedReport | null;
  devices: PublishedReport | null;
  countries: PublishedReport | null;
  search: PublishedReport | null;
  searchPages: PublishedReport | null;
  searchQueries: PublishedReport | null;
  comparison: string | null;
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
    contacts: empty(chosen ? "Not tracked" : "Not connected", chosen ? "unavailable" : "not_connected"),
    forms: empty(chosen ? "Not tracked" : "Not connected", chosen ? "unavailable" : "not_connected"),
    enquiries: enquiryPair(view),
    sessionsPrevious: null,
    usersPrevious: null,
    weekdays: [],
    dailyCurrent: [],
    dailyPrevious: [],
    sources: null,
    sourcesPrevious: null,
    landing: null,
    devices: null,
    countries: null,
    search: null,
    searchPages: null,
    searchQueries: null,
    comparison: null,
  };
  if (!view.websiteId || !start || !end || !chosen || chosen.status !== "connected") return blank;
  const dailyKey = chosen.provider === "ga4" ? "ga4.traffic_daily" : "wix.data_daily";
  const sessionMetric = chosen.provider === "ga4" ? "sessions" : "total_sessions";
  const sessions = fromPeriod(await additivePeriod(db, { clientId: view.clientId, websiteId: view.websiteId, templateKey: dailyKey, metric: sessionMetric, start, end }), "Sessions");
  const contacts = chosen.provider === "wix"
    ? fromPeriod(await additivePeriod(db, { clientId: view.clientId, websiteId: view.websiteId, templateKey: dailyKey, metric: "clicks_to_contact", start, end }), "Contact clicks")
    : empty("Contact clicks are not on this traffic source.");
  const forms = chosen.provider === "wix"
    ? fromPeriod(await additivePeriod(db, { clientId: view.clientId, websiteId: view.websiteId, templateKey: dailyKey, metric: "total_forms_submitted", start, end }), "Form events")
    : empty("Tracked form events are not on this traffic source.");
  const range = chosen.provider === "ga4"
    ? await publishedReport(db, { clientId: view.clientId, websiteId: view.websiteId, templateKey: "ga4.traffic_range", start, end })
    : null;
  const usersMetric = range?.rows[0]?.metrics.find((metric) => metric.key === "totalUsers");
  const users: LiveValue = usersMetric?.state === "available"
    ? { value: usersMetric.value, state: "available", note: "Exact period. Daily users are not added together." }
    : empty(chosen.provider === "wix" ? "Daily unique visitors are not added together." : "An exact-period user total has not been stored.");
  const previous = view.previous;
  let comparison: string | null = null;
  let sessionsPrevious: number | null = null;
  if (previous) {
    const prior = await additivePeriod(db, { clientId: view.clientId, websiteId: view.websiteId, templateKey: dailyKey, metric: sessionMetric, start: previous.start, end: previous.end });
    sessionsPrevious = prior.state === "available" ? prior.value : null;
    const change = percentChange(sessions.state === "available" ? sessions.value : null, sessionsPrevious);
    comparison = change.kind === "percent"
      ? `${change.value > 0 ? "+" : ""}${change.value}% vs previous period`
      : change.kind === "no_change"
        ? "No change vs previous period"
        : change.kind === "new_activity"
          ? "New activity vs an empty previous period"
          : "Period comparison is unavailable until both ranges are complete.";
  }
  const exact = (templateKey: string, rangeStart = start, rangeEnd = end) => publishedReport(db, { clientId: view.clientId, websiteId: view.websiteId!, templateKey, start: rangeStart, end: rangeEnd });
  const priorUsers = previous && chosen.provider === "ga4"
    ? await exact("ga4.traffic_range", previous.start, previous.end)
    : null;
  const priorUsersMetric = priorUsers?.rows[0]?.metrics.find((metric) => metric.key === "totalUsers" && metric.state === "available");
  const seriesInput = { clientId: view.clientId, websiteId: view.websiteId, templateKey: dailyKey, metric: sessionMetric };
  return {
    ...blank,
    sessions,
    users,
    sessionsPrevious,
    usersPrevious: priorUsersMetric?.value ?? null,
    contacts,
    forms,
    weekdays: await dailySessionsForWeekday(db, { clientId: view.clientId, websiteId: view.websiteId, templateKey: dailyKey, start, end }),
    dailyCurrent: await dailySessionSeries(db, { ...seriesInput, start, end }),
    dailyPrevious: previous ? await dailySessionSeries(db, { ...seriesInput, start: previous.start, end: previous.end }) : [],
    sources: chosen.provider === "ga4" ? await exact("ga4.acquisition") : null,
    sourcesPrevious: previous && chosen.provider === "ga4" ? await exact("ga4.acquisition", previous.start, previous.end) : null,
    landing: chosen.provider === "ga4" ? await exact("ga4.landing") : null,
    devices: chosen.provider === "ga4" ? await exact("ga4.device") : null,
    countries: chosen.provider === "ga4" ? await exact("ga4.country") : null,
    search: search?.status === "connected" ? await exact("gsc.totals") : null,
    searchPages: search?.status === "connected" ? await exact("gsc.pages") : null,
    searchQueries: search?.status === "connected" ? await exact("gsc.queries") : null,
    comparison,
  };
}

function enquiryPair(view: SiteView) {
  const pair = pairMetric(view.snapshots, { current: view.current, previous: view.previous }, "enquiries", "clinic_records", "all");
  return { current: pair.current, previous: pair.previous };
}
