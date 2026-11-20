import type { Queryable } from "../client";
import { addDays } from "../services/dates";
import { executeJob, leaseNext, type FetchLike, type FetchResponse } from "../analytics/sync";

/**
 * A fictional Search Console for tests and local acceptance (D66). It answers the searchAnalytics/query call
 * with three pages and two queries per day, so totals and rows scale with the requested window.
 * The page with the most clicks is deliberately not the first row returned.
 */
export const FIXTURE_PAGES: Array<[string, number]> = [["/", 4], ["/services/consultation", 9], ["/contact", 1]];
export const FIXTURE_QUERIES: Array<[string, number]> = [["fictional clinic", 6], ["consultation price", 3]];

function respond(body: unknown): FetchResponse {
  return { status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
}

function days(start: string, end: string): string[] {
  const out: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) out.push(day);
  return out;
}

export function fakeSearchConsole(origin: string): FetchLike {
  return async (url, init) => {
    // A fictional token refresh, for fixture connections whose stored token has expired.
    if (url === "https://oauth2.googleapis.com/token") return respond({ access_token: "fixture-refreshed", expires_in: 3600 });
    const request = JSON.parse(init?.body ?? "{}") as { startDate: string; endDate: string; dimensions: string[]; startRow?: number };
    if ((request.startRow ?? 0) > 0) return respond({ rows: [] });
    const span = days(request.startDate, request.endDate);
    const dimension = request.dimensions[0];
    const row = (keys: string[], clicks: number, impressions: number) => ({ keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: 7.5 });
    if (dimension === "page") return respond({ rows: FIXTURE_PAGES.map(([path, perDay]) => row([`${origin}${path}`], perDay * span.length, perDay * 20 * span.length)) });
    if (dimension === "query") return respond({ rows: FIXTURE_QUERIES.map(([text, perDay]) => row([text], perDay * span.length, perDay * 25 * span.length)) });
    const perDay = FIXTURE_PAGES.reduce((sum, [, n]) => sum + n, 0);
    if (dimension === "date") return respond({ rows: span.map((date) => row([date], perDay, perDay * 20)) });
    // Totals: the provider's own aggregate CTR and position, not derived from rows.
    return respond({ rows: [{ keys: [], clicks: perDay * span.length, impressions: perDay * 20 * span.length, ctr: 0.05, position: 8.25 }] });
  };
}

/** Runs every queued job for one website with the fake provider. Other websites' jobs are left alone. */
export async function runQueuedSearchJobs(db: Queryable, websiteId: string, fetch: FetchLike, now = new Date()): Promise<number> {
  let ran = 0;
  for (;;) {
    const job = await leaseNext(db, "search-fixture", now);
    if (!job) return ran;
    if (job.website_id !== websiteId) throw new Error("Another website has queued jobs; run this against an isolated website.");
    await executeJob(db, job, { fetch, now, googleClientId: "fixture-client", googleClientSecret: "fixture-secret" });
    ran += 1;
  }
}
