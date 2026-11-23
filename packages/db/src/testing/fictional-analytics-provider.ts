import { addDays } from "../services/dates";
import type { FetchLike, FetchResponse } from "../analytics/sync";

// Fictional provider. Deterministic, local, and it counts every request.

export type Call = { provider: "ga4" | "gsc" | "wix"; url: string; body: Record<string, unknown> };

export const CHANNELS = ["Organic Search", "Direct"];
export const DIM_VALUES: Record<string, string[]> = {
  sessionDefaultChannelGroup: CHANNELS,
  landingPage: ["/", "/services"],
  deviceCategory: ["mobile", "desktop"],
  country: ["Singapore", "Malaysia"],
  pagePath: ["/", "/services"],
  newVsReturning: ["new", "returning"],
};

export function response(status: number, body: unknown, headers: Record<string, string> = {}): FetchResponse {
  return { status, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) };
}

export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Sessions for value index i on any day: i + 1. So a 30-day window gives 30 * (i + 1). */
export function ga4Body(body: Record<string, unknown>): unknown {
  const range = (body.dateRanges as Array<{ startDate: string; endDate: string }>)[0]!;
  const dims = (body.dimensions as Array<{ name: string }>).map((d) => d.name);
  const metrics = (body.metrics as Array<{ name: string }>).map((m) => m.name);
  const other = dims.filter((d) => d !== "date");
  let combos: string[][] = [[]];
  for (const dim of other) combos = combos.flatMap((prefix) => (DIM_VALUES[dim] ?? ["x"]).map((value) => [...prefix, value]));
  const days = dims.includes("date") ? eachDay(range.startDate, range.endDate) : [null];
  const rows = days.flatMap((day) => combos.map((combo, index) => ({
    dimensionValues: dims.map((name) => ({ value: name === "date" ? day!.replaceAll("-", "") : combo[other.indexOf(name)]! })),
    // Without a date dimension GA4 returns the total over the range, so sessions add up the days.
    metricValues: metrics.map((name) => ({ value: String(
      // GA4 reports the two rates as fractions that add to one; everything else counts up by row.
      name === "engagementRate" ? 0.6 : name === "bounceRate" ? 0.4
        // Every breakdown has two values worth 1 and 2 sessions a day, so a request with no breakdown reports their sum, 3.
        : (name === "sessions" && other.length === 0 ? 3 : index + 1) * (name === "sessions" && !dims.includes("date") ? eachDay(range.startDate, range.endDate).length : 1)) })),
  })));
  return { dimensionHeaders: dims.map((name) => ({ name })), metricHeaders: metrics.map((name) => ({ name })), rows };
}

/** Values depend only on the date, so any two requests that include a day agree about it. */
function dayNumber(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

function gscDay(day: string): { clicks: number; impressions: number; position: number } {
  const n = dayNumber(day);
  return { clicks: 2, impressions: 10 + (n % 2) * 10, position: 4 + (n % 3) };
}

export function gscBody(body: Record<string, unknown>): unknown {
  const dims = body.dimensions as string[];
  const start = body.startDate as string;
  const end = body.endDate as string;
  if (dims[0] === "date") {
    return { rows: eachDay(start, end).map((day) => {
      const d = gscDay(day);
      return { keys: [day], clicks: d.clicks, impressions: d.impressions, ctr: d.clicks / d.impressions, position: d.position };
    }) };
  }
  if (dims[0] === "page") return { rows: [{ keys: ["https://fixture.example.invalid/a"], clicks: 3, impressions: 30, ctr: 0.1, position: 5 }] };
  if (dims[0] === "query") return { rows: [{ keys: ["fixture query"], clicks: 1, impressions: 9, ctr: 0.11, position: 7 }] };
  // A property total over the range, as Search Console computes it from the same days.
  const days = eachDay(start, end).map(gscDay);
  const clicks = days.reduce((sum, d) => sum + d.clicks, 0);
  const impressions = days.reduce((sum, d) => sum + d.impressions, 0);
  const position = days.reduce((sum, d) => sum + d.position * d.impressions, 0) / impressions;
  return { rows: [{ keys: [], clicks, impressions, ctr: clicks / impressions, position }] };
}

export function wixBody(url: string): unknown {
  const params = new URL(url).searchParams;
  const start = params.get("dateRange.startDate")!;
  const end = addDays(params.get("dateRange.endDate")!, -1);
  const days = eachDay(start, end);
  return { data: ["TOTAL_SESSIONS", "TOTAL_UNIQUE_VISITORS", "CLICKS_TO_CONTACT", "TOTAL_FORMS_SUBMITTED"].map((type, i) => ({
    type, values: days.map((date) => ({ date, value: i + 1 })),
    // Distinct visitors are not additive: the same person returns on other days, so the period total is lower than the sum.
    total: type === "TOTAL_UNIQUE_VISITORS" ? Math.round(days.length * (i + 1) * 0.7) : days.length * (i + 1),
  })) };
}

export function fictionalProviders(): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = init?.body && init.method === "POST" && !url.includes("oauth2") ? JSON.parse(init.body) as Record<string, unknown> : {};
    if (url.includes("analyticsdata.googleapis.com")) {
      calls.push({ provider: "ga4", url, body });
      return response(200, ga4Body(body));
    }
    if (url.includes("searchAnalytics/query")) {
      calls.push({ provider: "gsc", url, body });
      return response(200, gscBody(body));
    }
    if (url.includes("wixapis.com/analytics/v2/site-analytics/data")) {
      calls.push({ provider: "wix", url, body });
      return response(200, wixBody(url));
    }
    throw new Error(`unexpected provider url ${url}`);
  };
  return { fetch, calls };
}

