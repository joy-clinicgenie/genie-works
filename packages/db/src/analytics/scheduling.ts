import { addDays } from "../services/dates";
import type { AnalyticsProvider } from "./measure";
import { GSC_TIME_ZONE } from "./providers/gsc";
import { wixDueWindow } from "./providers/wix";

/**
 * Analytics Phase 2.1 planning and derivation. Everything here is pure: no database, no network.
 *
 * The page readers still ask for exact windows (D52). The planner keeps those windows available
 * while asking each provider for less. One daily-grain request can serve several windows because
 * the metrics involved are additive over days. Ratios are recomputed from their parts and never
 * summed or averaged (see `deriveGscTotals`).
 */

export const PLAN_PRESET_LENGTHS = [7, 30, 90] as const;

export interface PlannedJob {
  templateKey: string;
  start: string;
  end: string;
  /** Jobs of one class on one connection replace each other: a newer window retires an older queued one. */
  windowClass: string;
  /** Lower runs first. Priorities are spread so every connection's essentials run before anyone's extras. */
  priority: number;
}

export interface DerivedWindow {
  start: string;
  end: string;
  windowClass: string;
}

/** A bundle job fetches daily-grain rows once and writes one ordinary partition per window it derives. */
export interface BundleSpec {
  provider: AnalyticsProvider;
  /** Report whose partitions the bundle produces. Readers see an ordinary report under this key. */
  derivesTemplate: string;
  /** The dimension kept on each derived row; null for a property total. */
  dimension: string | null;
  /** Days of history the bundle fetches, ending on its end date. */
  days: number;
  /** Whether the equal-length previous windows are derived as well. */
  withPrevious: boolean;
}

export const BUNDLES: Record<string, BundleSpec> = {
  "ga4.bundle.channel": { provider: "ga4", derivesTemplate: "ga4.acquisition", dimension: "sessionDefaultChannelGroup", days: 180, withPrevious: true },
  "ga4.bundle.landing": { provider: "ga4", derivesTemplate: "ga4.landing", dimension: "landingPage", days: 90, withPrevious: false },
  "ga4.bundle.device": { provider: "ga4", derivesTemplate: "ga4.device", dimension: "deviceCategory", days: 180, withPrevious: true },
  "ga4.bundle.country": { provider: "ga4", derivesTemplate: "ga4.country", dimension: "country", days: 90, withPrevious: false },
  "gsc.bundle.daily": { provider: "gsc", derivesTemplate: "gsc.totals", dimension: null, days: 180, withPrevious: true },
};

export function isBundle(templateKey: string): boolean {
  return templateKey in BUNDLES;
}

/** Each preset length ending on `end`, with or without the equal-length window just before it. */
export function presetWindows(end: string, withPrevious: boolean): DerivedWindow[] {
  return PLAN_PRESET_LENGTHS.flatMap((length) => {
    const start = addDays(end, 1 - length);
    const current = { start, end, windowClass: `p${length}` };
    if (!withPrevious) return [current];
    const previousEnd = addDays(start, -1);
    return [current, { start: addDays(previousEnd, 1 - length), end: previousEnd, windowClass: `prev${length}` }];
  });
}

/** The windows a bundle that ends on `end` and starts on `start` can fully cover. */
export function bundleWindows(templateKey: string, start: string, end: string): DerivedWindow[] {
  const spec = BUNDLES[templateKey];
  if (!spec) return [];
  return presetWindows(end, spec.withPrevious).filter((window) => window.start >= start);
}

export function civilDateIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Thirty-day Search Console windows end three Pacific days ago: newer days are not published yet. */
export function gscLatestDay(now: Date): string {
  return addDays(civilDateIn(GSC_TIME_ZONE, now), -3);
}

/**
 * Reports that hold user counts, which cannot be added across days (D13), so they stay exact-range requests. Pages and
 * visitor type are also compared with the previous window on the analytics pages (D56), so they ask for it too.
 */
const GA4_RANGE_ONLY: ReadonlyArray<readonly [string, boolean]> = [["ga4.engagement", false], ["ga4.pages", true], ["ga4.visitor_type", true]];

/**
 * What a due run queues for one connection (version 2). Compare `dueJobs` in sync.ts, the
 * version 1 plan: with the D56 comparisons it asks for 40 GA4, 18 Search Console and 1 Wix request. This plan asks for
 * 26, 13 and 1, and the derived reports cover the same exact windows.
 */
export function planDueJobs(provider: AnalyticsProvider, now: Date, timezone: string | null): PlannedJob[] {
  if (provider === "wix") {
    const today = civilDateIn(timezone || "Asia/Singapore", now);
    return [{ templateKey: "wix.data_daily", ...wixDueWindow(today), windowClass: "wix62", priority: 10 }];
  }
  if (provider === "gsc") {
    const end = gscLatestDay(now);
    const bundle = BUNDLES["gsc.bundle.daily"]!;
    const jobs: PlannedJob[] = [{ templateKey: "gsc.bundle.daily", start: addDays(end, 1 - bundle.days), end, windowClass: "b180", priority: 10 }];
    for (const templateKey of ["gsc.pages", "gsc.queries"]) {
      for (const window of presetWindows(end, true)) jobs.push({ templateKey, ...window, priority: 30 });
    }
    return jobs;
  }
  const today = civilDateIn(timezone || "Asia/Singapore", now);
  const yesterday = addDays(civilDateIn("Asia/Singapore", now), -1);
  const jobs: PlannedJob[] = [{ templateKey: "ga4.traffic_daily", start: addDays(today, -180), end: today, windowClass: "daily180", priority: 10 }];
  // Distinct users cannot be added across days (D13), so range totals stay exact-range requests.
  for (const window of presetWindows(yesterday, true)) jobs.push({ templateKey: "ga4.traffic_range", ...window, priority: 20 });
  for (const [templateKey, spec] of Object.entries(BUNDLES)) {
    if (spec.provider !== "ga4") continue;
    jobs.push({ templateKey, start: addDays(yesterday, 1 - spec.days), end: yesterday, windowClass: `b${spec.days}`, priority: spec.days === 180 ? 30 : 40 });
  }
  for (const [templateKey, withPrevious] of GA4_RANGE_ONLY) {
    for (const window of presetWindows(yesterday, withPrevious)) jobs.push({ templateKey, ...window, priority: 50 });
  }
  return jobs;
}

/** Every exact report window the plan makes available, direct or derived. Used by the contract test. */
export function plannedReportWindows(jobs: PlannedJob[]): Array<{ templateKey: string; start: string; end: string }> {
  return jobs.flatMap((job) => {
    const spec = BUNDLES[job.templateKey];
    if (!spec) return [{ templateKey: job.templateKey, start: job.start, end: job.end }];
    return bundleWindows(job.templateKey, job.start, job.end).map((window) => ({ templateKey: spec.derivesTemplate, start: window.start, end: window.end }));
  });
}

// ---------------------------------------------------------------------------------------------
// Derivation

export interface DailyDimensionRow {
  date: string;
  value: string;
  sessions: number | null;
}

export interface DerivedRow {
  dimensionKey: string;
  dimensions: Record<string, string>;
  metrics: Array<{ key: string; value: number | null; state: "available" | "unavailable" }>;
}

/** Sessions by one dimension over a window: the sum of the daily rows inside it. */
export function deriveSessionsByDimension(rows: DailyDimensionRow[], dimension: string, window: { start: string; end: string }): DerivedRow[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.date < window.start || row.date > window.end || row.sessions === null) continue;
    totals.set(row.value, (totals.get(row.value) ?? 0) + row.sessions);
  }
  return [...totals.entries()].map(([value, sessions]) => ({
    dimensionKey: value || "range",
    dimensions: { [dimension]: value },
    metrics: [{ key: "sessions", value: sessions, state: "available" }],
  }));
}

export interface GscDailyRow {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * Search Console totals over a window from its daily rows. Clicks and impressions add.
 * CTR is clicks divided by impressions. Average position is weighted by impressions. Neither
 * is summed or averaged as a plain mean, and with no impressions both are unavailable.
 */
export function deriveGscTotals(rows: GscDailyRow[], window: { start: string; end: string }): DerivedRow[] {
  const inside = rows.filter((row) => row.date >= window.start && row.date <= window.end);
  if (inside.length === 0) return [];
  const clicks = inside.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = inside.reduce((sum, row) => sum + row.impressions, 0);
  const weighted = inside.reduce((sum, row) => sum + row.position * row.impressions, 0);
  const ratio = impressions > 0;
  return [{
    dimensionKey: "property",
    dimensions: {},
    metrics: [
      { key: "clicks", value: clicks, state: "available" },
      { key: "impressions", value: impressions, state: "available" },
      { key: "ctr", value: ratio ? clicks / impressions : null, state: ratio ? "available" : "unavailable" },
      { key: "position", value: ratio ? weighted / impressions : null, state: ratio ? "available" : "unavailable" },
    ],
  }];
}

// ---------------------------------------------------------------------------------------------
// Capacity budget

export interface CapacityInput {
  /** Planned requests for one connection of each provider. */
  jobsPerConnection: Record<AnalyticsProvider, number>;
  connections: Record<AnalyticsProvider, number>;
  /** Seconds one provider request takes, including storing its rows. Measured, not assumed. */
  secondsPerJob: Record<AnalyticsProvider, number>;
  /** Seconds of provider work one invocation may use. */
  invocationBudgetSeconds: number;
  /** Invocations per day. */
  invocationsPerDay: number;
}

export interface CapacityResult {
  jobsPerDay: number;
  workSecondsPerDay: number;
  invocationsNeeded: number;
  fitsDaily: boolean;
  fitsWithinOneInvocation: boolean;
  byProvider: Record<AnalyticsProvider, { jobs: number; seconds: number }>;
}

export function capacityBudget(input: CapacityInput): CapacityResult {
  const providers: AnalyticsProvider[] = ["ga4", "gsc", "wix"];
  const byProvider = {} as CapacityResult["byProvider"];
  let jobsPerDay = 0;
  let workSecondsPerDay = 0;
  for (const provider of providers) {
    const jobs = input.jobsPerConnection[provider] * input.connections[provider];
    const seconds = jobs * input.secondsPerJob[provider];
    byProvider[provider] = { jobs, seconds };
    jobsPerDay += jobs;
    workSecondsPerDay += seconds;
  }
  const invocationsNeeded = Math.ceil(workSecondsPerDay / input.invocationBudgetSeconds);
  return {
    jobsPerDay,
    workSecondsPerDay,
    invocationsNeeded,
    fitsDaily: invocationsNeeded <= input.invocationsPerDay,
    fitsWithinOneInvocation: invocationsNeeded <= 1,
    byProvider,
  };
}
