import { createHash } from "node:crypto";
import type { Queryable } from "../client";
import { addDays } from "../services/dates";
import { publishedReport, type PublishedReport } from "./read";
import { enqueueJob, runWorkerOnce, type FetchLike, type WorkerJobResult } from "./sync";

/**
 * Analytics Phase 2.3: provider validation.
 *
 * Runs the real synchronisation path (enqueue, lease, pull, derive, store, publish) against any
 * `FetchLike`, and compares what a bundle derived with what a direct request returned. The same code
 * validates a fictional provider in tests and a live, authorised, read-only property later.
 *
 * Evidence holds numbers and labels only. It never holds a token, a raw response, a property id or a
 * site URL: a property is identified by the first eight characters of its hash.
 */

export type Provider = "ga4" | "gsc" | "wix";

export interface RequestRecord {
  provider: Provider;
  template: string;
  period: { start: string; end: string };
  /** Wall time of the whole job: request, parse, derive, store. */
  jobMs: number;
  /** Provider round trips this job made, and the slowest of them. */
  requests: number;
  slowestRequestMs: number;
  /** HTTP status of the last provider response (0 when the request threw). */
  status: number;
  rowsReturned: number;
  pages: number;
  /** The job did not succeed on its first attempt, or was scheduled to retry. */
  retryRequired: boolean;
  result: WorkerJobResult | "not_run";
  quotaTokensConsumed?: number;
  /** Warnings the pull recorded about the data (truncation, thresholding, time zone). Labels and numbers only. */
  quality?: Record<string, unknown>;
}

/**
 * `expected_difference`: the two numbers measure different things by definition (distinct visitors against a sum of
 * daily visitors, a top-N list against a property total), so a gap is not a defect. It is still recorded in full.
 */
export type Verdict = "match" | "within_tolerance" | "differs" | "expected_difference" | "not_comparable";

export interface Comparison {
  name: string;
  window: { start: string; end: string };
  direct: number | null;
  derived: number | null;
  abs: number | null;
  pct: number | null;
  verdict: Verdict;
  note?: string;
}

export interface Evidence {
  generatedAt: string;
  mode: "fictional" | "live";
  provider: Provider;
  /** First eight hex characters of the property's hash. Enough to tell two runs apart, not to find the property. */
  propertyRef: string;
  requests: RequestRecord[];
  comparisons: Comparison[];
  observations: Record<string, unknown>;
}

/** Relative difference allowed before a comparison is called a difference. A stated assumption, not a provider guarantee. */
export const DEFAULT_TOLERANCE_PCT = 0.5;

export function propertyRef(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 8);
}

export function compareNumbers(name: string, window: { start: string; end: string }, direct: number | null, derived: number | null, tolerancePct = DEFAULT_TOLERANCE_PCT, note?: string, expectedDifference = false): Comparison {
  if (direct === null || derived === null) return { name, window, direct, derived, abs: null, pct: null, verdict: "not_comparable", note: note ?? "A value is missing, which is not the same as zero." };
  const abs = derived - direct;
  const pct = direct === 0 ? (derived === 0 ? 0 : null) : (abs / direct) * 100;
  const verdict: Verdict = abs === 0 ? "match" : pct !== null && Math.abs(pct) <= tolerancePct ? "within_tolerance" : expectedDifference ? "expected_difference" : "differs";
  return { name, window, direct, derived, abs: +abs.toFixed(6), pct: pct === null ? null : +pct.toFixed(4), verdict, note };
}

export class ValidationBudgetError extends Error {
  constructor(public readonly limit: number) {
    super(`The request budget of ${limit} was reached.`);
    this.name = "ValidationBudgetError";
  }
}

/** Counts, times and caps provider round trips. It reads no body. */
export function recordingFetch(inner: FetchLike, budget: number): { fetch: FetchLike; take(): { requests: number; slowestMs: number; status: number }; total(): number } {
  let total = 0;
  let requests = 0;
  let slowest = 0;
  let status = 0;
  const fetch: FetchLike = async (url, init) => {
    if (total >= budget) throw new ValidationBudgetError(budget);
    total += 1;
    requests += 1;
    const began = performance.now();
    try {
      const response = await inner(url, init);
      status = response.status;
      return response;
    } catch (error) {
      status = 0;
      throw error;
    } finally {
      slowest = Math.max(slowest, performance.now() - began);
    }
  };
  return {
    fetch,
    take: () => {
      const out = { requests, slowestMs: +slowest.toFixed(1), status };
      requests = 0;
      slowest = 0;
      return out;
    },
    total: () => total,
  };
}

export interface JobContext {
  db: Queryable;
  clientId: string;
  websiteId: string;
  connectionId: string;
  provider: Provider;
  fetch: FetchLike;
  recorder: ReturnType<typeof recordingFetch>;
  now: Date;
}

/** Queues exactly one job through the real queue, runs it through the real worker, and reports what happened. */
export async function runMeasuredJob(ctx: JobContext, template: string, window: { start: string; end: string }): Promise<RequestRecord> {
  const { id } = await enqueueJob(ctx.db, {
    clientId: ctx.clientId, websiteId: ctx.websiteId, connectionId: ctx.connectionId,
    templateKey: template, start: window.start, end: window.end, now: ctx.now,
  });
  ctx.recorder.take();
  const began = performance.now();
  let result: WorkerJobResult | "not_run" = "not_run";
  try {
    const step = await runWorkerOnce(async (fn) => fn(ctx.db), "validation", { fetch: ctx.recorder.fetch, now: ctx.now });
    result = step.worked ? step.result ?? "not_run" : "not_run";
  } catch (error) {
    if (!(error instanceof ValidationBudgetError)) throw error;
  }
  const jobMs = +(performance.now() - began).toFixed(1);
  const net = ctx.recorder.take();
  const job = (await ctx.db.query<{ attempts: number; state: string }>("select attempts, state from analytics_jobs where id = $1", [id])).rows[0];
  const run = (await ctx.db.query<{ pages_fetched: number; rows_fetched: number; quota_meta: { tokens?: number } | null }>(
    "select pages_fetched, rows_fetched, quota_meta from analytics_sync_runs where job_id = $1 order by started_at desc limit 1", [id])).rows[0];
  // A bundle stores its evidence on the partitions it derives, tagged with the bundle that made them.
  const quality = (await ctx.db.query<{ quality: Record<string, unknown> }>(
    `select quality from analytics_report_partitions
     where connection_id = $1 and start_date between $3::date and $4::date and end_date <= $4::date
       and (template_key = $2 or quality->'quota'->>'derivedFrom' = $2)
     order by fetched_at desc, generation desc limit 1`, [ctx.connectionId, template, window.start, window.end])).rows[0]?.quality;
  const { pages: _pages, quota, ...rest } = (quality ?? {}) as { pages?: number; quota?: { tokens?: number; derivedFrom?: string } } & Record<string, unknown>;
  void _pages;
  return {
    provider: ctx.provider, template, period: window, jobMs, requests: net.requests, slowestRequestMs: net.slowestMs, status: net.status,
    rowsReturned: Number(run?.rows_fetched ?? 0), pages: Number(run?.pages_fetched ?? 0),
    retryRequired: result === "retry" || (job?.attempts ?? 1) > 1, result,
    quotaTokensConsumed: quota?.tokens ?? run?.quota_meta?.tokens,
    quality: Object.keys(rest).length > 0 ? rest : undefined,
  };
}

export function metricValue(report: PublishedReport | null, dimensionKey: string, metric: string): number | null {
  const found = report?.rows.find((row) => row.dimensionKey === dimensionKey)?.metrics.find((m) => m.key === metric);
  return found && found.state === "available" ? found.value : null;
}

export function sumDaily(report: PublishedReport | null, metric: string, window: { start: string; end: string }): { value: number | null; days: number } {
  if (!report) return { value: null, days: 0 };
  let total = 0;
  let days = 0;
  for (const row of report.rows) {
    const date = row.dimensions.date;
    if (!date || date < window.start || date > window.end) continue;
    const m = row.metrics.find((item) => item.key === metric);
    if (m?.state === "available" && m.value !== null) {
      total += m.value;
      days += 1;
    }
  }
  return { value: days === 0 ? null : total, days };
}

// ---------------------------------------------------------------------------------------------
// Provider plans. Each is a small, fixed set of jobs, run in order.

export interface ValidationWindows {
  /** Last day every provider has finished: GA4 and Wix two days past settling, Search Console three Pacific days back. */
  end: string;
}

export function validationEnd(provider: Provider, today: string): string {
  return provider === "gsc" ? addDays(today, -3) : addDays(today, -4);
}

const win = (end: string, days: number) => ({ start: addDays(end, 1 - days), end });

interface Plan {
  requests: RequestRecord[];
  comparisons: Comparison[];
  observations: Record<string, unknown>;
}

function daysIn(window: { start: string; end: string }): number {
  return Math.round((Date.parse(window.end) - Date.parse(window.start)) / 86_400_000) + 1;
}

/** Per-dimension comparison of two reports with the same rows keyed by dimension. Names are category labels, never people. */
function compareBreakdown(name: string, window: { start: string; end: string }, direct: PublishedReport | null, derived: PublishedReport | null, metric: string): Comparison[] {
  if (!direct || !derived) return [compareNumbers(name, window, null, null, undefined, "A report is missing.")];
  const keys = new Set([...direct.rows.map((r) => r.dimensionKey), ...derived.rows.map((r) => r.dimensionKey)]);
  const out: Comparison[] = [];
  let worst = 0;
  const differing: string[] = [];
  let directTotal = 0;
  let derivedTotal = 0;
  for (const key of keys) {
    const d = metricValue(direct, key, metric);
    const v = metricValue(derived, key, metric);
    directTotal += d ?? 0;
    derivedTotal += v ?? 0;
    const c = compareNumbers(key, window, d, v);
    if (c.verdict === "differs" || c.verdict === "not_comparable") differing.push(key);
    worst = Math.max(worst, Math.abs(c.abs ?? 0));
  }
  const total = compareNumbers(`${name}: total over ${keys.size} rows`, window, directTotal, derivedTotal);
  out.push({ ...total, note: `largest single-row difference ${worst}${differing.length ? `; rows that differ or are missing on one side: ${differing.slice(0, 10).join(", ")}${differing.length > 10 ? ` and ${differing.length - 10} more` : ""}` : ""}` });
  return out;
}

/**
 * GA4. Derived: the 180-day channel bundle, summed into windows. Direct: the same windows requested on their own.
 * The derived result is read before the direct job runs, because the direct job replaces the published partition.
 */
export async function validateGa4(ctx: JobContext, end: string): Promise<Plan> {
  const requests: RequestRecord[] = [];
  const comparisons: Comparison[] = [];
  const read = (templateKey: string, window: { start: string; end: string }) =>
    publishedReport(ctx.db, { clientId: ctx.clientId, websiteId: ctx.websiteId, templateKey, ...window });
  const p7 = win(end, 7);
  const p30 = win(end, 30);
  requests.push(await runMeasuredJob(ctx, "ga4.traffic_daily", win(end, 30)));
  requests.push(await runMeasuredJob(ctx, "ga4.bundle.channel", win(end, 180)));
  const derived = { p7: await read("ga4.acquisition", p7), p30: await read("ga4.acquisition", p30) };
  const daily = await read("ga4.traffic_daily", win(end, 30));
  for (const [label, window] of [["7 days", p7], ["30 days", p30]] as const) {
    requests.push(await runMeasuredJob(ctx, "ga4.traffic_range", window));
    requests.push(await runMeasuredJob(ctx, "ga4.acquisition", window));
    const range = await read("ga4.traffic_range", window);
    const summed = sumDaily(daily, "sessions", window);
    comparisons.push(compareNumbers(`sessions, ${label}: sum of daily rows against a direct range request`, window, metricValue(range, "range", "sessions"), summed.value, DEFAULT_TOLERANCE_PCT,
      summed.days === daysIn(window) ? undefined : `Only ${summed.days} of ${daysIn(window)} days had a recorded row.`));
    const direct = await read("ga4.acquisition", window);
    comparisons.push(...compareBreakdown(`sessions by channel, ${label}: bundle-derived against direct`, window, direct, label === "7 days" ? derived.p7 : derived.p30, "sessions"));
    const channelTotal = (direct?.rows ?? []).reduce((sum, row) => sum + (metricValue(direct, row.dimensionKey, "sessions") ?? 0), 0);
    comparisons.push(compareNumbers(`sessions, ${label}: channels added up against the range total`, window, metricValue(range, "range", "sessions"), channelTotal, DEFAULT_TOLERANCE_PCT));
  }
  requests.push(await runMeasuredJob(ctx, "ga4.engagement", p30));
  const engagement = await read("ga4.engagement", p30);
  const rate = metricValue(engagement, "range", "engagementRate");
  const bounce = metricValue(engagement, "range", "bounceRate");
  // GA4 defines bounce rate as the share of sessions that were not engaged, so the two should add to one.
  comparisons.push(compareNumbers("engagement rate + bounce rate = 1 (30 days)", p30, 1, rate === null || bounce === null ? null : rate + bounce, 0.1, "A definitional check, not a comparison of sources."));
  // Row volume of the landing, device and country bundles (device is 180 days, for the D56 previous windows). They are
  // the jobs most likely to need more than one page, so the live row and page counts here are the evidence for whether
  // storing daily facts would save requests.
  for (const [template, days] of [["ga4.bundle.landing", 90], ["ga4.bundle.device", 180], ["ga4.bundle.country", 90]] as const) {
    requests.push(await runMeasuredJob(ctx, template, win(end, days)));
  }
  return { requests, comparisons, observations: { windows: { p7, p30 }, bundleDays: 180 } };
}

/**
 * Search Console. Derived: the 180-day daily bundle, with CTR and position recomputed. Direct: the property total for
 * the same dates and scope. Pages and queries are compared with that total to measure what the row lists leave out.
 */
export async function validateGsc(ctx: JobContext, end: string): Promise<Plan> {
  const requests: RequestRecord[] = [];
  const comparisons: Comparison[] = [];
  const read = (templateKey: string, window: { start: string; end: string }) =>
    publishedReport(ctx.db, { clientId: ctx.clientId, websiteId: ctx.websiteId, templateKey, ...window });
  const p7 = win(end, 7);
  const p30 = win(end, 30);
  requests.push(await runMeasuredJob(ctx, "gsc.bundle.daily", win(end, 180)));
  const derived = { p7: await read("gsc.totals", p7), p30: await read("gsc.totals", p30) };
  for (const [label, window, derivedReport] of [["7 days", p7, derived.p7], ["30 days", p30, derived.p30]] as const) {
    requests.push(await runMeasuredJob(ctx, "gsc.totals", window));
    const direct = await read("gsc.totals", window);
    for (const metric of ["clicks", "impressions", "ctr", "position"]) {
      comparisons.push(compareNumbers(`${metric}, ${label}: derived from daily rows against the property total`, window,
        metricValue(direct, "property", metric), metricValue(derivedReport, "property", metric),
        metric === "ctr" || metric === "position" ? 0.1 : DEFAULT_TOLERANCE_PCT,
        metric === "position" ? "Position is recomputed as an impression-weighted average of daily positions." : undefined));
    }
  }
  for (const [template, dimension] of [["gsc.pages", "pages"], ["gsc.queries", "queries"]] as const) {
    requests.push(await runMeasuredJob(ctx, template, p7));
    const list = await read(template, p7);
    const total = await read("gsc.totals", p7);
    for (const metric of ["clicks", "impressions"]) {
      const listed = list ? list.rows.reduce((sum, row) => sum + (metricValue(list, row.dimensionKey, metric) ?? 0), 0) : null;
      comparisons.push(compareNumbers(`${metric}, 7 days: sum of ${dimension} rows against the property total`, p7, metricValue(total, "property", metric), listed, 0,
        `A shortfall is expected: ${dimension === "queries" ? "anonymised queries are not listed, " : ""}rows are limited to the top results, and rows withheld by the privacy filter are left out (see the partition's quality record).`, true));
    }
  }
  return { requests, comparisons, observations: { windows: { p7, p30 }, bundleDays: 180 } };
}

/** Wix. The adapter keeps Wix's own definitions; this checks internal consistency and the day boundary, and never compares with GA4. */
export async function validateWix(ctx: JobContext, today: string, input: { accessToken: string; timezone: string }): Promise<Plan> {
  const requests: RequestRecord[] = [];
  const comparisons: Comparison[] = [];
  const window = win(addDays(today, -1), 30);
  requests.push(await runMeasuredJob(ctx, "wix.data_daily", window));
  const daily = await publishedReport(ctx.db, { clientId: ctx.clientId, websiteId: ctx.websiteId, templateKey: "wix.data_daily", ...window });
  const raw = async (extra: string) => {
    const params = new URLSearchParams();
    params.set("dateRange.startDate", window.start);
    params.set("dateRange.endDate", addDays(window.end, 1));
    for (const m of ["TOTAL_SESSIONS", "TOTAL_UNIQUE_VISITORS", "CLICKS_TO_CONTACT", "TOTAL_FORMS_SUBMITTED"]) params.append("measurementTypes", m);
    if (extra) params.set("timeZone", extra);
    const began = performance.now();
    const response = await ctx.recorder.fetch(`https://www.wixapis.com/analytics/v2/site-analytics/data?${params}`, { headers: { Authorization: input.accessToken } });
    const body = (await response.json()) as { data?: Array<{ type?: string; total?: number; values?: Array<{ date?: string; value?: number }> }> };
    const net = ctx.recorder.take();
    requests.push({
      provider: "wix", template: extra ? "wix.data_daily (with timeZone)" : "wix.data_daily (raw totals)", period: window, jobMs: +(performance.now() - began).toFixed(1),
      requests: net.requests, slowestRequestMs: net.slowestMs, status: net.status, rowsReturned: (body.data ?? []).reduce((n, item) => n + (item.values?.length ?? 0), 0),
      pages: 1, retryRequired: false, result: "succeeded",
    });
    return body;
  };
  const base = await raw("");
  for (const item of base.data ?? []) {
    const metric = (item.type ?? "").toLowerCase();
    const summed = sumDaily(daily, metric, window);
    const additive = item.type !== "TOTAL_UNIQUE_VISITORS";
    comparisons.push(compareNumbers(`${metric}: sum of daily values against the API's own total`, window, item.total ?? null, summed.value, additive ? DEFAULT_TOLERANCE_PCT : 0,
      additive ? undefined : "Distinct visitors are not additive across days; a difference is expected and Wix visitors are never summed or compared with GA4 users.", !additive));
  }
  const zoned = await raw(input.timezone);
  const sessions = (body: typeof base) => new Map((body.data?.find((item) => item.type === "TOTAL_SESSIONS")?.values ?? []).map((v) => [v.date ?? "", Number(v.value ?? 0)]));
  const a = sessions(base);
  const b = sessions(zoned);
  let differingDays = 0;
  for (const [date, value] of a) if ((b.get(date) ?? 0) !== value) differingDays += 1;
  comparisons.push(compareNumbers(`sessions, days whose value changes when timeZone=${input.timezone} is sent`, window, 0, differingDays, 0,
    "Zero means the default day boundary already matches the connection's time zone."));
  return { requests, comparisons, observations: { window, daysReturned: a.size, timeZoneSent: input.timezone } };
}

export function assembleEvidence(input: { mode: Evidence["mode"]; provider: Provider; propertyId: string; plan: Plan }): Evidence {
  return { generatedAt: new Date().toISOString(), mode: input.mode, provider: input.provider, propertyRef: propertyRef(input.propertyId), requests: input.plan.requests, comparisons: input.plan.comparisons, observations: input.plan.observations };
}

export function summariseLatency(requests: RequestRecord[]): Record<string, { jobs: number; requests: number; jobMsMean: number; jobMsMax: number; slowestRequestMs: number }> {
  const by: Record<string, RequestRecord[]> = {};
  for (const r of requests) (by[r.template] ??= []).push(r);
  return Object.fromEntries(Object.entries(by).map(([template, list]) => [template, {
    jobs: list.length, requests: list.reduce((n, r) => n + r.requests, 0),
    jobMsMean: +(list.reduce((n, r) => n + r.jobMs, 0) / list.length).toFixed(1), jobMsMax: Math.max(...list.map((r) => r.jobMs)),
    slowestRequestMs: Math.max(...list.map((r) => r.slowestRequestMs)),
  }]));
}

// ---------------------------------------------------------------------------------------------
// Property association (read only)

export interface AssociationFinding {
  kind:
    | "property_bound_to_other_client"
    | "property_shared_within_client"
    | "client_website_mismatch"
    | "secret_scope_mismatch"
    | "gsc_site_does_not_match_website"
    | "missing_time_zone"
    | "connected_without_secret";
  /** `action`: something that can put one client's data under another. `review`: probably fine, worth a look. */
  severity: "action" | "review";
  provider: Provider;
  /** Counts and categories only. The property itself is shown as a short hash. */
  propertyRef: string;
  detail: string;
}

export interface AssociationAudit {
  checked: number;
  findings: AssociationFinding[];
  /** Findings by kind, so a large estate reads at a glance. */
  summary: Record<string, number>;
}

/** Hostname of a website URL, without a leading "www.". */
function hostOf(url: string | null): string | null {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Host a Search Console property covers: `sc-domain:example.com` or a URL-prefix property such as `https://www.example.com/`. */
export function gscPropertyHost(property: string): string | null {
  if (property.startsWith("sc-domain:")) return property.slice("sc-domain:".length).toLowerCase() || null;
  return hostOf(property);
}

/**
 * Read-only audit of how connections are tied to properties, websites and clients. It never changes a row, prints no
 * property id or client name, and can run against a restore point of production.
 *
 * The database already refuses a connection whose website belongs to another client (a composite foreign key), so
 * `client_website_mismatch` and `secret_scope_mismatch` should always be empty. They are checked anyway: an empty result
 * from the check is the evidence.
 */
export async function associationAudit(db: Queryable): Promise<AssociationAudit> {
  const { rows } = await db.query<{
    id: string; provider: Provider; external_property_id: string; provider_timezone: string | null; url: string | null;
    has_secret: boolean; other_clients: number; same_client_websites: number; website_client_ok: boolean; secret_scope_ok: boolean;
  }>(
    `select c.id, c.provider, c.external_property_id, c.provider_timezone, w.url,
       (c.secret_ref is not null) as has_secret,
       (select count(distinct o.client_id)::int from analytics_connections o
         where o.provider = c.provider and o.id <> c.id and o.client_id <> c.client_id
           and lower(rtrim(o.external_property_id, '/')) = lower(rtrim(c.external_property_id, '/'))
           and o.status <> 'disconnected' and o.disconnected_at is null) as other_clients,
       (select count(distinct o.website_id)::int from analytics_connections o
         where o.provider = c.provider and o.id <> c.id and o.client_id = c.client_id and o.website_id <> c.website_id
           and lower(rtrim(o.external_property_id, '/')) = lower(rtrim(c.external_property_id, '/'))
           and o.status <> 'disconnected' and o.disconnected_at is null) as same_client_websites,
       (w.client_id = c.client_id) as website_client_ok,
       coalesce((select s.client_id = c.client_id and s.website_id = c.website_id from analytics_secrets s where s.id = c.secret_ref), true) as secret_scope_ok
     from analytics_connections c join websites w on w.id = c.website_id
     where c.status <> 'disconnected' and c.disconnected_at is null`,
  );
  const findings: AssociationFinding[] = [];
  const add = (row: (typeof rows)[number], kind: AssociationFinding["kind"], severity: AssociationFinding["severity"], detail: string) =>
    findings.push({ kind, severity, provider: row.provider, propertyRef: propertyRef(row.external_property_id), detail });
  for (const row of rows) {
    if (row.other_clients > 0) add(row, "property_bound_to_other_client", "action", `The same ${row.provider} property is connected under ${row.other_clients} other client(s).`);
    if (row.same_client_websites > 0) add(row, "property_shared_within_client", "review", `The same ${row.provider} property is connected to ${row.same_client_websites} other website(s) of this client, for example a staging and a live site.`);
    if (!row.website_client_ok) add(row, "client_website_mismatch", "action", "The connection's client is not the client that owns its website.");
    if (!row.secret_scope_ok) add(row, "secret_scope_mismatch", "action", "The stored token belongs to a different client or website than the connection.");
    if (!row.provider_timezone) add(row, "missing_time_zone", "review", "No time zone is stored for this connection.");
    if (!row.has_secret) add(row, "connected_without_secret", "action", "The connection is marked connected but has no stored token.");
    if (row.provider === "gsc") {
      const property = gscPropertyHost(row.external_property_id);
      const site = hostOf(row.url);
      const related = property && site && (site === property || site.endsWith(`.${property}`) || property.endsWith(`.${site}`));
      if (!related) add(row, "gsc_site_does_not_match_website", "review", "The Search Console property's host is not the website's host or a parent or subdomain of it.");
    }
  }
  const summary: Record<string, number> = {};
  for (const f of findings) summary[f.kind] = (summary[f.kind] ?? 0) + 1;
  return { checked: rows.length, findings, summary };
}
