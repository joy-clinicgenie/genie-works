import type { Queryable } from "../client";
import { addDays, daysBetween } from "../services/dates";
import { recordAudit } from "../services/audit";
import { decryptSecret, encryptSecret, tokenKeyConfigured } from "./crypto";
import { queryHash, type AnalyticsProvider } from "./measure";
import { ADDITIVE_METRICS, PrivacyTally, classifyDimension } from "./privacy";
import { checkCompatibility, ga4PropertyPath, ga4ReportBody, ga4Template, isInvalidGrant, parseGa4Report } from "./providers/ga4";
import { GSC_ROW_LIMIT, GSC_TIME_ZONE, encodeSiteUrl, gscHasAnotherPage, gscQueryBody, parseGscQuery } from "./providers/gsc";
import { parseSemanticModel, parseWixData, wixDataUrl, wixDataWindow, wixDueWindow } from "./providers/wix";
import { BUNDLES, bundleWindows, deriveGscTotals, deriveSessionsByDimension, isBundle, planDueJobs, type GscDailyRow } from "./scheduling";

export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<FetchResponse>;

export interface SyncDeps {
  fetch: FetchLike;
  now: Date;
  deadlineAt?: number;
  /** Milliseconds clock for deadline checks. Defaults to Date.now. Tests and the simulation inject a virtual one. */
  clock?: () => number;
  /** Pilot only: lease, reap and run jobs of this one connection and no other. */
  onlyConnectionId?: string;
  /** Pilot only: lease only these jobs, so the connection's older backlog is not touched. */
  onlyJobIds?: string[];
  pageSize?: number;
  failOnPage?: number;
  googleClientId?: string;
  googleClientSecret?: string;
  wixAppId?: string;
  wixAppSecret?: string;
}

export interface JobRow {
  id: string;
  client_id: string;
  website_id: string;
  connection_id: string;
  template_key: string;
  query_hash: string;
  start_date: string;
  end_date: string;
  attempts: number;
  lease_owner: string;
}

export interface ConnectionRow {
  id: string;
  client_id: string;
  website_id: string;
  provider: AnalyticsProvider;
  external_property_id: string;
  stream_or_site_ref: string | null;
  secret_ref: string | null;
  provider_timezone: string | null;
  status: string;
}

export interface TokenBundle {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  instanceId?: string;
}

interface FactRow {
  dimensionKey: string;
  dimensions: Record<string, string>;
  metrics: Array<{ key: string; value: number | null; state: "available" | "unavailable" | "unsupported" }>;
  sourceDate?: string;
}

class RetryableError extends Error {
  seconds: number;
  code: "rate_limited" | "provider_unavailable" | "worker_deadline" | "invalid_response";
  constructor(seconds: number, code: "rate_limited" | "provider_unavailable" | "worker_deadline" | "invalid_response") {
    super("retry");
    this.seconds = seconds;
    this.code = code;
  }
}

/** A server setting is missing. Reconnecting cannot fix it, so the connection keeps its status. */
class ConfigurationError extends Error {
  constructor() {
    super("not_configured");
    this.name = "ConfigurationError";
  }
}

/** How long a job waits after a missing server setting before it is tried again. */
const NOT_CONFIGURED_WAIT_SECONDS = 6 * 60 * 60;

/**
 * The SERVER'S credentials do not match what the stored token or the provider expects: a token key that cannot open
 * the sealed token, an OAuth client the provider rejects, or an API the OAuth project has not enabled. The connection
 * is not at fault and reconnecting cannot fix it, so the connection keeps its status and its stored token. The job waits
 * and the fault is recorded under a safe code (connection recovery, C1). Only an explicit `invalid_grant` means the
 * grant itself was revoked or expired, and only that marks a connection `reconnect_required`.
 */
export type ServerCredentialCode = "token_unreadable" | "oauth_client_rejected" | "provider_api_disabled";

class ServerCredentialError extends Error {
  code: ServerCredentialCode;
  constructor(code: ServerCredentialCode) {
    super(code);
    this.name = "ServerCredentialError";
    this.code = code;
  }
}

/** Long enough that a run does not hammer a provider with a rejected client, short enough that a fixed setting is picked up the same day. */
const SERVER_CREDENTIAL_WAIT_SECONDS = 2 * 60 * 60;

/** The `error` code in an OAuth token-endpoint answer, lower-cased, or null. */
function oauthErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" ? error.toLowerCase() : null;
}

/** An answer that says the API is switched off for the OAuth project (a server setting), as opposed to access being withdrawn. */
function apiDisabledBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return false;
  const record = error as { message?: unknown; details?: unknown; errors?: unknown };
  const reasons = [
    ...(Array.isArray(record.details) ? record.details : []).map((d) => (d as { reason?: unknown })?.reason),
    ...(Array.isArray(record.errors) ? record.errors : []).map((d) => (d as { reason?: unknown })?.reason),
  ];
  if (reasons.some((r) => r === "SERVICE_DISABLED" || r === "accessNotConfigured" || r === "ACCESS_NOT_CONFIGURED")) return true;
  return typeof record.message === "string" && /has not been used in project|api has not been enabled|is disabled/i.test(record.message);
}

class ReconnectError extends Error {
  constructor() {
    super("reconnect");
    this.name = "ReconnectError";
  }
}

const TEMPLATES: Record<AnalyticsProvider, string[]> = {
  ga4: ["ga4.traffic_daily", "ga4.traffic_range", "ga4.acquisition", "ga4.landing", "ga4.device", "ga4.country", "ga4.engagement", "ga4.pages", "ga4.visitor_type"],
  wix: ["wix.data_daily"],
  gsc: ["gsc.totals", "gsc.pages", "gsc.queries"],
};

/** Pages one job may read from a provider. A job that stops here with more to read is marked truncated. */
export const MAX_PROVIDER_PAGES = 20;

const MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 150;
const MAX_BACKOFF_SECONDS = 30 * 60;

interface KnownCapability {
  supported_metrics: string[];
  supported_dimensions: string[];
  status: string;
}

interface SealedTokenRow {
  ciphertext: string;
  nonce: string;
  client_id: string;
}

export interface ClaimedAnalyticsJob {
  job: JobRow;
  connection: ConnectionRow;
  sealedToken: SealedTokenRow | null;
  capability: KnownCapability | null;
  runId: string;
  owner: string;
}

interface DerivedPartition {
  templateKey: string;
  start: string;
  end: string;
  rows: FactRow[];
}

interface PulledJob {
  facts?: { rows: FactRow[]; timezone: string; pages: number; quota?: Record<string, unknown>; quality?: Record<string, unknown> };
  /** A bundle job (Phase 2.1) writes ordinary partitions for the exact windows it can derive. */
  derived?: DerivedPartition[];
  stats?: { rows: number; pages: number; timezone: string; quota?: Record<string, unknown>; quality?: Record<string, unknown> };
  capabilities?: Array<{ templateKey: string; metrics: string[]; dimensions: string[]; dependencies: string[]; status: "supported" | "unsupported" }>;
}

export type WorkerJobResult = "succeeded" | "failed" | "retry" | "reconnect" | "not_configured" | "stale";

export function civilDate(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Thirty Pacific days ending three days ago. Search Console has not published the newer days. */
export function gscDueWindow(now: Date): { start: string; end: string } {
  const end = addDays(civilDate(GSC_TIME_ZONE, now), -3);
  return { start: addDays(end, -29), end };
}

export function dueWindow(provider: AnalyticsProvider, now: Date, timezone: string | null): { start: string; end: string } {
  if (provider === "gsc") return gscDueWindow(now);
  const today = civilDate(timezone || "Asia/Singapore", now);
  if (provider === "wix") return wixDueWindow(today);
  return { start: addDays(today, -29), end: today };
}

/** Rolling period lengths the analytics and SEO pages offer as presets. */
export const PRESET_LENGTHS = [7, 30, 90] as const;
/** GA4 daily history kept fresh each run: the longest preset and its previous period, both ending yesterday. */
const GA4_DAILY_DAYS = 2 * 90;
const GA4_RANGE_TEMPLATES = TEMPLATES.ga4.filter((key) => key !== "ga4.traffic_daily");
/** GA4 reports the pages also read for the previous window (D52, D56). The rest are read for the selected window only. */
const GA4_COMPARED_TEMPLATES = new Set(["ga4.traffic_range", "ga4.acquisition", "ga4.device", "ga4.pages", "ga4.visitor_type"]);

/** Each preset length ending on `end`, with or without the equal-length window just before it. */
function presetWindows(end: string, withPrevious = true): Array<{ start: string; end: string }> {
  return PRESET_LENGTHS.flatMap((length) => {
    const start = addDays(end, 1 - length);
    const previousEnd = addDays(start, -1);
    return withPrevious ? [{ start, end }, { start: addDays(previousEnd, 1 - length), end: previousEnd }] : [{ start, end }];
  });
}

/**
 * Every report and window a due run queues for one connection (D52). Range reports are read by
 * exact dates, so they follow the page presets: GA4 on the Asia/Singapore reporting calendar,
 * ending yesterday; Search Console on the Pacific days it has published.
 */
export function dueJobs(provider: AnalyticsProvider, now: Date, timezone: string | null): Array<{ templateKey: string; start: string; end: string }> {
  if (provider === "gsc") {
    const end = gscDueWindow(now).end;
    return TEMPLATES.gsc.flatMap((templateKey) => presetWindows(end).map((window) => ({ templateKey, ...window })));
  }
  if (provider === "wix") return TEMPLATES.wix.map((templateKey) => ({ templateKey, ...dueWindow("wix", now, timezone) }));
  const today = civilDate(timezone || "Asia/Singapore", now);
  const daily = { templateKey: "ga4.traffic_daily", start: addDays(today, -GA4_DAILY_DAYS), end: today };
  const reportingYesterday = addDays(civilDate("Asia/Singapore", now), -1);
  return [daily, ...GA4_RANGE_TEMPLATES.flatMap((templateKey) =>
    presetWindows(reportingYesterday, GA4_COMPARED_TEMPLATES.has(templateKey)).map((window) => ({ templateKey, ...window })))];
}

export function dateChunks(start: string, end: string, size: number): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = addDays(cursor, size - 1);
    const bounded = chunkEnd > end ? end : chunkEnd;
    chunks.push({ start: cursor, end: bounded });
    cursor = addDays(bounded, 1);
  }
  return chunks;
}

/**
 * A newer window of the same class makes an older queued one obsolete: its dates will never be
 * read again. Only queued jobs are retired. A leased job is running and is left alone, and so is
 * any finished job and every stored report. Retired jobs keep their row as `cancelled`.
 */
async function retireSupersededJobs(db: Queryable, input: { connectionId: string; templateKey: string; end: string; windowClass?: string }): Promise<number> {
  if (!input.windowClass) return 0;
  const { rowCount } = await db.query(
    `update analytics_jobs
     set state = 'cancelled', safe_error_code = 'superseded', lease_owner = null, lease_until = null,
         heartbeat_at = null, updated_at = now()
     where connection_id = $1 and template_key = $2 and window_class = $3
       and state = 'queued' and end_date < $4`,
    [input.connectionId, input.templateKey, input.windowClass, input.end],
  );
  return rowCount ?? 0;
}

/** Whether a window that already succeeded should be fetched again (see `refreshAfterSeconds`). */
export function succeededWindowIsStale(succeededAt: Date, refreshAfterSeconds: number | null | undefined, now: Date | undefined): boolean {
  if (refreshAfterSeconds === undefined) return true;
  if (refreshAfterSeconds === null) return false;
  return (now ?? new Date()).getTime() - new Date(succeededAt).getTime() >= refreshAfterSeconds * 1000;
}

/**
 * Seconds before a window that already succeeded is fetched again. A window that ends before the
 * provider's current day is final for that day: the next day's window replaces it, so it is never
 * fetched twice. A window that includes the current day (the GA4 daily series and the Wix 62-day
 * window) is partial; `ANALYTICS_PARTIAL_REFRESH_MINUTES` (15 to 1440) opts in to refreshing it
 * within the day. Unset means once per window.
 */
export function partialRefreshSeconds(env: Record<string, string | undefined> = process.env): number | null {
  const minutes = Number(env.ANALYTICS_PARTIAL_REFRESH_MINUTES);
  return Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440 ? minutes * 60 : null;
}

export async function enqueueJob(db: Queryable, input: {
  clientId: string;
  websiteId: string;
  connectionId: string;
  templateKey: string;
  start: string;
  end: string;
  version?: number;
  /** Phase 2.1: jobs of one class on one connection replace each other. Omitted for ad hoc jobs. */
  windowClass?: string;
  priority?: number;
  /** The worker's clock. A new job is due from this moment. Defaults to the database clock. */
  now?: Date;
  /**
   * What to do when the same window already succeeded. Omitted: queue it again (manual refresh, the
   * behaviour before Phase 2.2). `null`: never, its data is final. A number: only once the success is
   * at least that many seconds old.
   */
  refreshAfterSeconds?: number | null;
  /**
   * A window whose latest job failed gets a fresh job row (the failed one stays as history) once the
   * failure is this many seconds old. Omitted: a failed window is not queued again here.
   */
  retryFailedAfterSeconds?: number;
}): Promise<{ id: string; reused: boolean }> {
  const hash = queryHash(input.templateKey, input.version ?? 1, { start: input.start, end: input.end });
  const existing = await db.query<{ id: string; state: string; updated_at: Date }>(
    `select id, state, updated_at from analytics_jobs
     where connection_id = $1 and template_key = $2 and query_hash = $3 and start_date = $4 and end_date = $5 and state <> 'cancelled'
       and ($6::int is null or state <> 'failed' or coalesce(updated_at, now()) > $7::timestamptz - ($6::int * interval '1 second'))
     order by created_at desc
     limit 1`,
    [input.connectionId, input.templateKey, hash, input.start, input.end, input.retryFailedAfterSeconds ?? null, (input.now ?? new Date()).toISOString()],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].state === "succeeded" && succeededWindowIsStale(existing.rows[0].updated_at, input.refreshAfterSeconds, input.now)) {
      await db.query(
        `update analytics_jobs
         set state = 'queued', attempts = 0, next_attempt_at = coalesce($2::timestamptz, now()), safe_error_code = null,
             last_error_at = null, failed_at = null, updated_at = coalesce($2::timestamptz, now())
         where id = $1 and state = 'succeeded'`,
        [existing.rows[0].id, input.now ? input.now.toISOString() : null],
      );
    }
    await retireSupersededJobs(db, input);
    return { id: existing.rows[0].id, reused: true };
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into analytics_jobs (client_id, website_id, connection_id, template_key, query_hash, start_date, end_date, window_class, priority, next_attempt_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()))
     on conflict (connection_id, template_key, query_hash, start_date, end_date)
       where state in ('queued', 'leased')
     do nothing
     returning id`,
    [input.clientId, input.websiteId, input.connectionId, input.templateKey, hash, input.start, input.end, input.windowClass ?? null, input.priority ?? 50, input.now ? input.now.toISOString() : null],
  );
  if (rows[0]) {
    await retireSupersededJobs(db, input);
    return { id: rows[0].id, reused: false };
  }
  const raced = await db.query<{ id: string }>(
    `select id from analytics_jobs
     where connection_id = $1 and template_key = $2 and query_hash = $3
       and start_date = $4 and end_date = $5 and state in ('queued', 'leased')
     limit 1`,
    [input.connectionId, input.templateKey, hash, input.start, input.end],
  );
  if (!raced.rows[0]) throw new Error("analytics_job_enqueue_conflict");
  return { id: raced.rows[0].id, reused: true };
}

export type PlannerVersion = "v1" | "v2";

/** Version 2 (Phase 2.1) is the default. `ANALYTICS_PLANNER=v1` restores the D52 plan. */
export function plannerVersion(env: Record<string, string | undefined> = process.env): PlannerVersion {
  return env.ANALYTICS_PLANNER?.trim().toLowerCase() === "v1" ? "v1" : "v2";
}

export async function enqueueDue(db: Queryable, now: Date, websiteId?: string, options: { planner?: PlannerVersion; partialRefreshSeconds?: number | null } = {}): Promise<number> {
  const planner = options.planner ?? plannerVersion();
  const partialRefresh = options.partialRefreshSeconds === undefined ? partialRefreshSeconds() : options.partialRefreshSeconds;
  const { rows } = await db.query<ConnectionRow>(
    `select id, client_id, website_id, provider, external_property_id, stream_or_site_ref, secret_ref, provider_timezone, status
     from analytics_connections where status = 'connected' and disconnected_at is null
       and ($1::uuid is null or website_id = $1)
     order by id`,
    [websiteId ?? null],
  );
  if (rows.length === 0) return 0;
  const plans = rows.map((connection) => ({
    connection,
    plan: planner === "v1"
      ? dueJobs(connection.provider, now, connection.provider_timezone).map((due) => ({ ...due, windowClass: undefined, priority: undefined }))
      : planDueJobs(connection.provider, now, connection.provider_timezone),
  }));
  // One read of what already exists, instead of one per planned job: a run with nothing to add costs two queries.
  const earliest = plans.flatMap(({ plan }) => plan.map((job) => job.start)).sort()[0] ?? now.toISOString().slice(0, 10);
  const known = await db.query<{ connection_id: string; template_key: string; start_date: string; end_date: string; state: string; updated_at: Date; safe_error_code: string | null }>(
    `select connection_id, template_key, start_date::text, end_date::text, state, updated_at, safe_error_code
     from analytics_jobs
     where connection_id = any($1::uuid[]) and state in ('queued', 'leased', 'succeeded', 'failed') and start_date >= $2::date`,
    [rows.map((row) => row.id), earliest],
  );
  const seen = new Map<string, { active: boolean; succeededAt: Date | null; failedAt: Date | null; failedTransient: boolean }>();
  for (const row of known.rows) {
    const key = `${row.connection_id}|${row.template_key}|${row.start_date}|${row.end_date}`;
    const entry = seen.get(key) ?? { active: false, succeededAt: null, failedAt: null, failedTransient: false };
    if (row.state === "succeeded") {
      if (!entry.succeededAt || row.updated_at > entry.succeededAt) entry.succeededAt = row.updated_at;
    } else if (row.state === "failed") {
      if (!entry.failedAt || row.updated_at > entry.failedAt) {
        entry.failedAt = row.updated_at;
        entry.failedTransient = row.safe_error_code !== null && TRANSIENT_FAILURE_CODES.has(row.safe_error_code);
      }
    } else {
      entry.active = true;
    }
    seen.set(key, entry);
  }
  let created = 0;
  for (const { connection, plan } of plans) {
    const zone = connection.provider_timezone || (connection.provider === "gsc" ? GSC_TIME_ZONE : "Asia/Singapore");
    const today = civilDate(zone, now);
    for (const due of plan) {
      const entry = seen.get(`${connection.id}|${due.templateKey}|${due.start}|${due.end}`);
      if (entry?.active) continue;
      let retryFailed = false;
      if (entry?.failedAt && !entry.succeededAt) {
        // The window's jobs ran out of attempts. A transient cause (the provider was down) earns one fresh set of
        // attempts after a pause; a rejected request does not, because asking again cannot change the answer.
        if (!entry.failedTransient || now.getTime() - new Date(entry.failedAt).getTime() < FAILED_RETRY_SECONDS * 1000) continue;
        retryFailed = true;
      }
      const partialDay = due.end >= today;
      if (entry?.succeededAt) {
        // Already fetched. A window that includes the provider's current day is partial: once per window unless opted in.
        if (partialDay) {
          if (!succeededWindowIsStale(entry.succeededAt, partialRefresh, now)) continue;
        } else if (civilDate(zone, entry.succeededAt) === today || windowWasSettledWhenFetched(connection.provider, due.end, entry.succeededAt)) {
          // Fetched earlier today, or fetched after the provider had finished the window: the data cannot have changed.
          continue;
        }
        // Otherwise a window that came back (for example a previous-period window that equals an earlier current one)
        // was fetched before its last days had settled. Fetch it again.
      }
      const job = await enqueueJob(db, {
        clientId: connection.client_id,
        websiteId: connection.website_id,
        connectionId: connection.id,
        templateKey: due.templateKey,
        start: due.start,
        end: due.end,
        windowClass: due.windowClass,
        priority: due.priority,
        now,
        refreshAfterSeconds: partialDay ? partialRefresh : undefined,
        retryFailedAfterSeconds: retryFailed ? FAILED_RETRY_SECONDS : undefined,
      });
      if (!job.reused) created += 1;
    }
  }
  return created;
}

/** Failure codes that mean the provider or the network was unavailable, not that our request was wrong. */
export const TRANSIENT_FAILURE_CODES = new Set(["provider_unavailable", "rate_limited", "invalid_response", "lease_expired"]);
/** How long a window whose jobs all ran out of attempts waits before it earns a fresh set of attempts. */
export const FAILED_RETRY_SECONDS = 6 * 60 * 60;

/**
 * Hours after a window's last day ends before its numbers stop changing, by provider. Search Console
 * needs none: its windows end three Pacific days back and are requested with `dataState: final`. GA4
 * and Wix report a day's data for up to about two days after it ends, so a window fetched sooner is
 * not final and must be fetched again if it is ever needed again.
 */
export const SETTLE_HOURS: Record<AnalyticsProvider, number> = { gsc: 0, ga4: 48, wix: 48 };

/** True when the window had settled at the moment it was fetched. Conservative by up to 14 hours of time zone offset. */
export function windowWasSettledWhenFetched(provider: AnalyticsProvider, windowEnd: string, fetchedAt: Date): boolean {
  if (provider === "gsc") return true;
  const settledAt = Date.parse(`${windowEnd}T00:00:00Z`) + (24 + 14 + SETTLE_HOURS[provider]) * 3_600_000;
  return new Date(fetchedAt).getTime() >= settledAt;
}

export type RangeJobStatus = "ready" | "preparing" | "not_prepared" | "not_connected";

async function rangeConnection(db: Queryable, input: { clientId: string; websiteId: string }): Promise<ConnectionRow | null> {
  const { rows } = await db.query<ConnectionRow>(
    `select id, client_id, website_id, provider, external_property_id, stream_or_site_ref, secret_ref, provider_timezone, status
     from analytics_connections
     where client_id = $1 and website_id = $2 and provider = 'ga4' and status = 'connected' and disconnected_at is null
     limit 1`,
    [input.clientId, input.websiteId],
  );
  return rows[0] ?? null;
}

function previousWindow(start: string, end: string): { start: string; end: string } {
  const previousEnd = addDays(start, -1);
  return { start: addDays(previousEnd, 1 - windowLength(start, end)), end: previousEnd };
}

/** Whether GA4 range reports for an exact window are stored, queued or not yet asked for. */
export async function rangeJobStatus(db: Queryable, input: { clientId: string; websiteId: string; start: string; end: string }): Promise<RangeJobStatus> {
  const connection = await rangeConnection(db, input);
  if (!connection) return "not_connected";
  const ready = await db.query(
    `select 1 from analytics_report_partitions
     where connection_id = $1 and template_key = 'ga4.traffic_range' and start_date = $2 and end_date = $3 and published limit 1`,
    [connection.id, input.start, input.end],
  );
  if (ready.rows[0]) return "ready";
  const queued = await db.query(
    `select 1 from analytics_jobs
     where connection_id = $1 and template_key = 'ga4.traffic_range' and start_date = $2 and end_date = $3 and state in ('queued', 'leased') limit 1`,
    [connection.id, input.start, input.end],
  );
  return queued.rows[0] ? "preparing" : "not_prepared";
}

/**
 * Queues GA4 range reports for one requested window and the equal window before it (D52).
 * The website must belong to the client. Returns the number of new jobs; repeats add none.
 */
export async function enqueueRangeJobs(db: Queryable, input: { clientId: string; websiteId: string; start: string; end: string }): Promise<number> {
  const connection = await rangeConnection(db, input);
  if (!connection) return 0;
  let created = 0;
  const current = { start: input.start, end: input.end };
  for (const templateKey of GA4_RANGE_TEMPLATES) {
    const windows = GA4_COMPARED_TEMPLATES.has(templateKey) ? [current, previousWindow(input.start, input.end)] : [current];
    for (const window of windows) {
      const job = await enqueueJob(db, {
        clientId: connection.client_id,
        websiteId: connection.website_id,
        connectionId: connection.id,
        templateKey,
        start: window.start,
        end: window.end,
      });
      if (!job.reused) created += 1;
    }
  }
  return created;
}

export async function enqueueBackfill(db: Queryable, connectionId: string, oldest: string, end: string, templateKey: string): Promise<number> {
  const { rows } = await db.query<ConnectionRow>("select id, client_id, website_id, provider, external_property_id, stream_or_site_ref, secret_ref, provider_timezone, status from analytics_connections where id = $1", [connectionId]);
  const connection = rows[0];
  if (!connection || oldest > end) return 0;
  let created = 0;
  for (const chunk of dateChunks(oldest, end, 28)) {
    const job = await enqueueJob(db, {
      clientId: connection.client_id,
      websiteId: connection.website_id,
      connectionId: connection.id,
      templateKey,
      start: chunk.start,
      end: chunk.end,
    });
    if (!job.reused) created += 1;
  }
  return created;
}

export interface ConnectionSyncStatus {
  connectionId: string;
  queued: number;
  retryScheduled: number;
  leased: number;
  failed: number;
  reconnectRequired: number;
  lastSuccessAt: Date | null;
  safeError: string | null;
}

/** Queue counts and the last succeeded sync run. A connection verification time is not included. */
export interface PlatformSyncHealth {
  connections: number;
  queued: number;
  leased: number;
  stalledLeases: number;
  failed: number;
  reconnectRequired: number;
  lastSuccessAt: Date | null;
  safeError: string | null;
}

/** Counts only. No connection identifiers, property names or error text beyond a short safe code. */
export async function platformSyncHealth(db: Queryable): Promise<PlatformSyncHealth> {
  const { rows } = await db.query<{
    connections: number;
    queued: number;
    leased: number;
    stalled: number;
    failed: number;
    reconnect_required: number;
    last_success_at: Date | string | null;
    safe_error: string | null;
  }>(
    `select
       (select count(*)::int from analytics_connections where disconnected_at is null) as connections,
       (select count(*)::int from analytics_jobs where state = 'queued') as queued,
       (select count(*)::int from analytics_jobs where state = 'leased') as leased,
       (select count(*)::int from analytics_jobs where state = 'leased' and lease_until is not null and lease_until < now()) as stalled,
       (select count(*)::int from analytics_jobs where state = 'failed') as failed,
       (select count(*)::int from analytics_jobs where state = 'reconnect_required') as reconnect_required,
       (select max(finished_at) from analytics_sync_runs where result = 'succeeded') as last_success_at,
       (select safe_error_code from analytics_jobs
         where safe_error_code is not null and state in ('failed', 'reconnect_required')
         order by updated_at desc
         limit 1) as safe_error`,
  );
  const row = rows[0];
  const code = row?.safe_error ?? "";
  return {
    connections: Number(row?.connections ?? 0),
    queued: Number(row?.queued ?? 0),
    leased: Number(row?.leased ?? 0),
    stalledLeases: Number(row?.stalled ?? 0),
    failed: Number(row?.failed ?? 0),
    reconnectRequired: Number(row?.reconnect_required ?? 0),
    lastSuccessAt: row?.last_success_at ? new Date(row.last_success_at) : null,
    safeError: /^[a-z0-9_]{1,64}$/.test(code) ? code : null,
  };
}

export async function listConnectionSyncStatus(db: Queryable, clientId: string): Promise<ConnectionSyncStatus[]> {
  const { rows } = await db.query<{
    connection_id: string;
    queued: number;
    retry_scheduled: number;
    leased: number;
    failed: number;
    reconnect_required: number;
    last_success_at: Date | string | null;
    safe_error: string | null;
  }>(
    `select c.id as connection_id,
       count(j.id) filter (where j.state = 'queued' and j.next_attempt_at <= now())::int as queued,
       count(j.id) filter (where j.state = 'queued' and j.next_attempt_at > now())::int as retry_scheduled,
       count(j.id) filter (where j.state = 'leased')::int as leased,
       count(j.id) filter (where j.state = 'failed')::int as failed,
       count(j.id) filter (where j.state = 'reconnect_required')::int as reconnect_required,
       (select max(r.finished_at) from analytics_sync_runs r where r.connection_id = c.id and r.result = 'succeeded') as last_success_at,
       (select j2.safe_error_code from analytics_jobs j2
         where j2.connection_id = c.id
           and j2.safe_error_code is not null
           and j2.state in ('failed', 'reconnect_required', 'queued', 'leased')
         order by j2.updated_at desc
         limit 1) as safe_error
     from analytics_connections c
     left join analytics_jobs j on j.connection_id = c.id
     where c.client_id = $1 and c.disconnected_at is null
     group by c.id
     order by c.id`,
    [clientId],
  );
  return rows.map((row) => ({
    connectionId: row.connection_id,
    queued: Number(row.queued),
    retryScheduled: Number(row.retry_scheduled),
    leased: Number(row.leased),
    failed: Number(row.failed),
    reconnectRequired: Number(row.reconnect_required),
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null,
    safeError: row.safe_error,
  }));
}

export function retryBackoffSeconds(attempt: number, providerSeconds = 0): number {
  const exponential = Math.min(MAX_BACKOFF_SECONDS, 30 * (2 ** Math.max(0, attempt - 1)));
  return Math.max(exponential, Math.min(MAX_BACKOFF_SECONDS, Math.max(0, providerSeconds)));
}

export async function reapExpiredLeases(db: Queryable, now: Date, connectionId?: string): Promise<number> {
  const at = now.toISOString();
  const { rows } = await db.query<{ id: string; terminal: boolean }>(
    `update analytics_jobs
     set state = case when attempts >= $2 then 'failed' else 'queued' end,
         next_attempt_at = case
           when attempts >= $2 then next_attempt_at
           else $1::timestamptz + least($3, 30 * power(2, greatest(attempts - 1, 0))) * interval '1 second'
         end,
         safe_error_code = 'lease_expired',
         last_error_at = $1,
         failed_at = case when attempts >= $2 then $1 else null end,
         lease_owner = null,
         lease_until = null,
         heartbeat_at = null,
         updated_at = $1
     where state = 'leased' and lease_until is not null and lease_until < $1::timestamptz
       and ($4::uuid is null or connection_id = $4)
     returning id, attempts >= $2 as terminal`,
    [at, MAX_ATTEMPTS, MAX_BACKOFF_SECONDS, connectionId ?? null],
  );
  if (rows.length > 0) {
    await db.query(
      `update analytics_sync_runs
       set finished_at = $2, result = 'failed', safe_error_code = 'lease_expired'
       where finished_at is null and job_id = any($1::uuid[])`,
      [rows.map((row) => row.id), at],
    );
  }
  return rows.length;
}

/**
 * Provider breaker (Phase 2.2). When this many connections of one provider are failing at once, the
 * fault is the provider's, not one property's. Connections that are still healthy are held back; the
 * failing ones keep retrying on their own backoff and act as probes. The first success clears its
 * failure count, the failing set drops below the threshold and everything resumes. A failure older
 * than two hours past its cooldown no longer counts, so a stale record cannot hold a provider.
 */
export const PROVIDER_BREAKER_THRESHOLD = 3;

/** Which fault a connection's next attempt waits out. The job's own retry time is separate. */
const CONNECTION_COOLDOWN_MAX_SECONDS = MAX_BACKOFF_SECONDS;

/**
 * Takes the next due job fairly. Order: priority first, so every connection's essential reports
 * run before anyone's extras; then the connection served longest ago, so no provider or client
 * can keep the worker to itself; then the newest reporting window (D52). A connection waiting
 * out a provider fault is skipped, so it cannot spend the run on retries. The database allows
 * one leased job per connection, so two workers can never process the same connection together.
 */
export interface LeaseScope {
  /** Lease only jobs of this connection. */
  connectionId?: string;
  /** Lease only these jobs. */
  jobIds?: string[];
}

export async function leaseNext(db: Queryable, owner: string, now: Date, scope: LeaseScope = {}): Promise<JobRow | null> {
  await reapExpiredLeases(db, now, scope.connectionId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await db.query("savepoint analytics_lease");
    try {
      const { rows } = await db.query<JobRow>(
        `with tripped as (
           select provider from analytics_connections
           where status = 'connected' and disconnected_at is null and consecutive_failures >= 1
             and cooldown_until > $2::timestamptz - interval '2 hours'
           group by provider having count(*) >= $4
         ), next as (
           select candidate.id, candidate.connection_id from analytics_jobs candidate
           join analytics_connections conn on conn.id = candidate.connection_id
           where candidate.state = 'queued' and candidate.next_attempt_at <= $2
             and conn.status = 'connected' and conn.disconnected_at is null
             and (conn.cooldown_until is null or conn.cooldown_until <= $2)
             and not (conn.consecutive_failures = 0 and conn.provider in (select provider from tripped))
             and ($5::uuid is null or candidate.connection_id = $5)
             and ($6::uuid[] is null or candidate.id = any($6::uuid[]))
             and not exists (
               select 1 from analytics_jobs active
               where active.connection_id = candidate.connection_id and active.state = 'leased'
             )
           order by candidate.priority, conn.last_served_at asc nulls first,
             candidate.end_date desc, candidate.next_attempt_at, candidate.created_at, candidate.id
           for update of candidate skip locked
           limit 1
         ), leased as (
           update analytics_jobs j
           set state = 'leased',
               lease_owner = $1,
               lease_until = $2::timestamptz + ($3 * interval '1 second'),
               heartbeat_at = $2,
               attempts = attempts + 1,
               failed_at = null,
               updated_at = $2
           from next where j.id = next.id
           returning j.id, j.client_id, j.website_id, j.connection_id, j.template_key, j.query_hash,
             j.start_date::text, j.end_date::text, j.attempts, j.lease_owner
         ), served as (
           update analytics_connections c set last_served_at = $2
           from leased where c.id = leased.connection_id
           returning c.id
         )
         select * from leased`,
        [owner, now.toISOString(), LEASE_SECONDS, PROVIDER_BREAKER_THRESHOLD, scope.connectionId ?? null, scope.jobIds ?? null],
      );
      await db.query("release savepoint analytics_lease");
      return rows[0] ?? null;
    } catch (error) {
      await db.query("rollback to savepoint analytics_lease");
      // Another worker leased a job of the same connection first. Try the next connection.
      if ((error as { code?: string }).code === "23505") continue;
      throw error;
    }
  }
  return null;
}

export async function claimNextJob(db: Queryable, owner: string, now: Date, scope: LeaseScope = {}): Promise<ClaimedAnalyticsJob | null> {
  const job = await leaseNext(db, owner, now, scope);
  if (!job) return null;
  const connection = await loadConnection(db, job.connection_id, job.client_id);
  const sealedToken = await loadSealedToken(db, connection);
  const capability = await loadCapability(db, connection.id, job.template_key);
  const run = await db.query<{ id: string }>(
    `insert into analytics_sync_runs (job_id, client_id, website_id, connection_id, result) values ($1, $2, $3, $4, 'running') returning id`,
    [job.id, job.client_id, job.website_id, job.connection_id],
  );
  return { job, connection, sealedToken, capability, runId: run.rows[0]!.id, owner };
}

/** A network fault or timeout the provider may recover from. Anything else is our own error and is not retried. */
export function isTransientFetchError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, code, message } = error as { name?: string; code?: string; message?: string };
  if (name === "TimeoutError" || name === "AbortError") return true;
  if (typeof code === "string" && /^(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR_[A-Z_]+)$/.test(code)) return true;
  return name === "TypeError" && message === "fetch failed";
}

/**
 * Maps what a provider call can throw onto the worker's retry rules (Phase 2.1). A timeout or
 * dropped connection is retried with backoff instead of failing the job for good. A body that is
 * not valid JSON is a bad response, retried and never stored.
 */
export function resilientFetch(inner: FetchLike): FetchLike {
  return async (url, init) => {
    let response: FetchResponse;
    try {
      response = await inner(url, init);
    } catch (error) {
      if (isTransientFetchError(error)) throw new RetryableError(30, "provider_unavailable");
      throw error;
    }
    return {
      status: response.status,
      headers: response.headers,
      json: async () => {
        try {
          return await response.json();
        } catch (error) {
          if (isTransientFetchError(error)) throw new RetryableError(30, "provider_unavailable");
          throw new RetryableError(60, "invalid_response");
        }
      },
      text: () => response.text(),
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A GA4 report carries a rows array or names its metrics, even for a day with no rows. A body with neither is not a report. */
function validGa4Body(body: unknown): unknown {
  if (!isRecord(body) || (!Array.isArray(body.rows) && !Array.isArray(body.metricHeaders)) || (body.rows !== undefined && !Array.isArray(body.rows))) {
    throw new RetryableError(60, "invalid_response");
  }
  return body;
}

function validGscBody(body: unknown): unknown {
  if (!isRecord(body) || (body.rows !== undefined && !Array.isArray(body.rows))) throw new RetryableError(60, "invalid_response");
  return body;
}

function validWixBody(body: unknown): unknown {
  if (!isRecord(body) || (body.data !== undefined && !Array.isArray(body.data))) throw new RetryableError(60, "invalid_response");
  return body;
}

export async function executeClaimedJob(
  run: <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>,
  claimed: ClaimedAnalyticsJob,
  rawDeps: SyncDeps,
): Promise<{ result: WorkerJobResult }> {
  const deps: SyncDeps = { ...rawDeps, fetch: resilientFetch(rawDeps.fetch) };
  let original: TokenBundle | undefined;
  let current: TokenBundle | undefined;
  let pulled: PulledJob;
  try {
    original = decodeClaimedToken(claimed);
    current = await ensureAccessToken(claimed.connection, original, deps);
    pulled = await pullTemplate(claimed.connection, claimed.job, current, claimed.capability, deps);
  } catch (error) {
    return run((db) => failClaimedJob(db, claimed, error, original, current, deps.now));
  }
  return run((db) => finalizeClaimedJob(db, claimed, pulled, original, current, deps.now));
}

export async function runWorkerOnce(
  run: <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>,
  owner: string,
  deps: SyncDeps,
): Promise<{ worked: boolean; result?: WorkerJobResult }> {
  const claimed = await run((db) => claimNextJob(db, owner, deps.now, { connectionId: deps.onlyConnectionId, jobIds: deps.onlyJobIds }));
  if (!claimed) return { worked: false };
  const outcome = await executeClaimedJob(run, claimed, deps);
  return { worked: true, result: outcome.result };
}

/** Compatibility helper for focused DB tests. Production workers use executeClaimedJob with separate transactions. */
export async function executeJob(db: Queryable, job: JobRow, deps: SyncDeps): Promise<{ result: WorkerJobResult }> {
  const connection = await loadConnection(db, job.connection_id, job.client_id);
  const sealedToken = await loadSealedToken(db, connection);
  const capability = await loadCapability(db, connection.id, job.template_key);
  const run = await db.query<{ id: string }>(
    `insert into analytics_sync_runs (job_id, client_id, website_id, connection_id, result) values ($1, $2, $3, $4, 'running') returning id`,
    [job.id, job.client_id, job.website_id, job.connection_id],
  );
  return executeClaimedJob(async (fn) => fn(db), {
    job,
    connection,
    sealedToken,
    capability,
    runId: run.rows[0]!.id,
    owner: job.lease_owner,
  }, deps);
}

async function lockOwnedClaim(db: Queryable, claimed: ClaimedAnalyticsJob): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `select id from analytics_jobs
     where id = $1 and state = 'leased' and lease_owner = $2
     for update`,
    [claimed.job.id, claimed.owner],
  );
  return Boolean(rows[0]);
}

async function saveRefreshedToken(
  db: Queryable,
  claimed: ClaimedAnalyticsJob,
  original: TokenBundle | undefined,
  token: TokenBundle | undefined,
): Promise<void> {
  if (!original || !token || token === original || !claimed.connection.secret_ref) return;
  const sealed = encryptSecret(JSON.stringify(token));
  await db.query(
    "update analytics_secrets set ciphertext = $2, nonce = $3 where id = $1 and connection_id = $4",
    [claimed.connection.secret_ref, sealed.ciphertext, sealed.nonce, claimed.connection.id],
  );
}

/** GA4 and Wix report the current day while it is still changing; Search Console only returns final days. */
function partialFromDate(connection: ConnectionRow, now: Date): string | undefined {
  if (connection.provider === "gsc") return undefined;
  return civilDate(connection.provider_timezone || "Asia/Singapore", now);
}

async function finalizeClaimedJob(
  db: Queryable,
  claimed: ClaimedAnalyticsJob,
  pulled: PulledJob,
  original: TokenBundle,
  token: TokenBundle,
  now: Date,
): Promise<{ result: WorkerJobResult }> {
  if (!await lockOwnedClaim(db, claimed)) return { result: "stale" };
  await saveRefreshedToken(db, claimed, original, token);
  if (pulled.capabilities) await storeCapabilities(db, claimed.connection, pulled.capabilities);
  const partialFrom = partialFromDate(claimed.connection, now);
  if (pulled.facts) {
    await promote(db, {
      connection: claimed.connection,
      job: claimed.job,
      facts: pulled.facts.rows,
      completeness: pulled.facts.rows.length === 0 ? "empty" : "complete",
      timezone: pulled.facts.timezone,
      pages: pulled.facts.pages,
      quota: pulled.facts.quota ?? {},
      quality: pulled.facts.quality,
      partialFrom,
    });
  }
  for (const part of pulled.derived ?? []) {
    await promote(db, {
      connection: claimed.connection,
      job: {
        ...claimed.job,
        template_key: part.templateKey,
        query_hash: queryHash(part.templateKey, 1, { start: part.start, end: part.end }),
        start_date: part.start,
        end_date: part.end,
      },
      facts: part.rows,
      completeness: part.rows.length === 0 ? "empty" : "complete",
      timezone: pulled.stats?.timezone ?? "UTC",
      pages: pulled.stats?.pages ?? 0,
      quota: { ...(pulled.stats?.quota ?? {}), derivedFrom: claimed.job.template_key },
      quality: pulled.stats?.quality,
      partialFrom,
    });
  }
  await finish(
    db,
    claimed.job.id,
    claimed.runId,
    "succeeded",
    pulled.facts?.pages ?? pulled.stats?.pages ?? pulled.capabilities?.length ?? 0,
    pulled.facts?.rows.length ?? pulled.stats?.rows ?? 0,
    null,
    pulled.facts?.quota ?? pulled.stats?.quota ?? {},
    now,
  );
  await db.query(
    `update analytics_connections set consecutive_failures = 0, cooldown_until = null
     where id = $1 and (consecutive_failures <> 0 or cooldown_until is not null)`,
    [claimed.connection.id],
  );
  return { result: "succeeded" };
}

async function failClaimedJob(
  db: Queryable,
  claimed: ClaimedAnalyticsJob,
  error: unknown,
  original: TokenBundle | undefined,
  token: TokenBundle | undefined,
  now: Date,
): Promise<{ result: WorkerJobResult }> {
  if (!await lockOwnedClaim(db, claimed)) return { result: "stale" };
  await saveRefreshedToken(db, claimed, original, token);
  const at = now.toISOString();
  if (error instanceof RetryableError) {
    const exhausted = claimed.job.attempts >= MAX_ATTEMPTS;
    const delay = retryBackoffSeconds(claimed.job.attempts, error.seconds);
    await db.query(
      `update analytics_jobs
       set state = $2,
           next_attempt_at = $3,
           safe_error_code = $4,
           last_error_at = $5,
           failed_at = case when $2 = 'failed' then $5::timestamptz else null end,
           lease_owner = null,
           lease_until = null,
           heartbeat_at = null,
           updated_at = $5
       where id = $1`,
      [claimed.job.id, exhausted ? "failed" : "queued", new Date(now.getTime() + delay * 1000).toISOString(), error.code, at],
    );
    await finish(db, claimed.job.id, claimed.runId, "failed", 0, 0, error.code);
    // A provider fault pauses the whole connection, so its other jobs do not each spend a
    // lease and an attempt. Running out of worker time is our limit, not the provider's.
    if (error.code !== "worker_deadline") {
      await db.query(
        `update analytics_connections
         set cooldown_until = $2::timestamptz + least($3, greatest($4, 30 * power(2, least(consecutive_failures, 6)))) * interval '1 second',
             consecutive_failures = consecutive_failures + 1
         where id = $1`,
        [claimed.connection.id, at, CONNECTION_COOLDOWN_MAX_SECONDS, Math.max(0, error.seconds)],
      );
    }
    return { result: exhausted ? "failed" : "retry" };
  }
  if (error instanceof ConfigurationError) {
    // The lease counted an attempt; a missing server setting must not use up the retry budget.
    await db.query(
      `update analytics_jobs
       set state = 'queued', attempts = greatest(attempts - 1, 0), next_attempt_at = $2,
           safe_error_code = 'not_configured', last_error_at = $3, failed_at = null,
           lease_owner = null, lease_until = null, heartbeat_at = null, updated_at = $3
       where id = $1`,
      [claimed.job.id, new Date(now.getTime() + NOT_CONFIGURED_WAIT_SECONDS * 1000).toISOString(), at],
    );
    await finish(db, claimed.job.id, claimed.runId, "failed", 0, 0, "not_configured");
    return { result: "not_configured" };
  }
  if (error instanceof ServerCredentialError) {
    // The connection and its stored token are left exactly as they are. The job waits without using an attempt, and the
    // connection is paused for the same time, so one run makes one rejected request per connection, not one per job.
    const wait = new Date(now.getTime() + SERVER_CREDENTIAL_WAIT_SECONDS * 1000).toISOString();
    await db.query(
      `update analytics_jobs
       set state = 'queued', attempts = greatest(attempts - 1, 0), next_attempt_at = $2,
           safe_error_code = $4, last_error_at = $3, failed_at = null,
           lease_owner = null, lease_until = null, heartbeat_at = null, updated_at = $3
       where id = $1`,
      [claimed.job.id, wait, at, error.code],
    );
    await db.query(
      "update analytics_connections set cooldown_until = $2, consecutive_failures = consecutive_failures + 1 where id = $1",
      [claimed.connection.id, wait],
    );
    await finish(db, claimed.job.id, claimed.runId, "failed", 0, 0, error.code);
    return { result: "not_configured" };
  }
  if (error instanceof ReconnectError) {
    await db.query("update analytics_connections set status = 'reconnect_required', updated_at = $2 where id = $1", [claimed.connection.id, at]);
    await db.query(
      `update analytics_jobs
       set state = 'reconnect_required', safe_error_code = 'reconnect_required', last_error_at = $2,
           failed_at = $2, lease_owner = null, lease_until = null, heartbeat_at = null, updated_at = $2
       where id = $1`,
      [claimed.job.id, at],
    );
    // The connection's other waiting jobs cannot succeed either. They end the same way, now and without a rejected provider
    // request each, instead of being worked one by one (and the worker no longer leases jobs of a connection that is not connected).
    await db.query(
      `update analytics_jobs
       set state = 'reconnect_required', safe_error_code = 'reconnect_required', last_error_at = $2, failed_at = $2,
           lease_owner = null, lease_until = null, heartbeat_at = null, updated_at = $2
       where connection_id = $1 and state = 'queued' and id <> $3`,
      [claimed.connection.id, at, claimed.job.id],
    );
    await finish(db, claimed.job.id, claimed.runId, "reconnect_required", 0, 0, "reconnect_required");
    return { result: "reconnect" };
  }
  const code = error instanceof Error && (error.message === "page_failed" || error.message === "unsupported")
    ? error.message
    : "provider_rejected";
  await db.query(
    `update analytics_jobs
     set state = 'failed', safe_error_code = $2, last_error_at = $3, failed_at = $3,
         lease_owner = null, lease_until = null, heartbeat_at = null, updated_at = $3
     where id = $1`,
    [claimed.job.id, code, at],
  );
  await finish(db, claimed.job.id, claimed.runId, "failed", 0, 0, code);
  return { result: "failed" };
}

async function finish(
  db: Queryable,
  jobId: string,
  runId: string,
  result: string,
  pages: number,
  rows: number,
  code: string | null,
  quota: Record<string, unknown> = {},
  at?: Date,
): Promise<void> {
  if (result === "succeeded") {
    // The success time comes from the worker's clock, so the refresh policy and the simulation agree about it.
    await db.query(
      `update analytics_jobs
       set state = 'succeeded', lease_owner = null, lease_until = null, heartbeat_at = null,
           safe_error_code = null, last_error_at = null, failed_at = null, updated_at = coalesce($2::timestamptz, now())
       where id = $1`,
      [jobId, at ? at.toISOString() : null],
    );
  }
  await db.query(
    `update analytics_sync_runs
     set finished_at = now(), result = $2, pages_fetched = $3, rows_fetched = $4,
         safe_error_code = $5, quota_meta = $6
     where id = $1`,
    [runId, result, pages, rows, code, JSON.stringify(quota)],
  );
}

/** Rows stored per statement. */
const PROMOTE_BATCH = 500;

async function promote(db: Queryable, input: {
  connection: ConnectionRow;
  job: JobRow;
  facts: FactRow[];
  completeness: "complete" | "empty";
  timezone: string;
  pages: number;
  quota: Record<string, unknown>;
  /** Evidence about the pull itself (truncation, rows withheld, provider warnings). Stored beside the quota; changes no number. */
  quality?: Record<string, unknown>;
  /** First provider date that may still change. From this date coverage is `partial`, never `complete`. */
  partialFrom?: string;
}): Promise<void> {
  const generationRow = await db.query<{ generation: number }>(
    `select coalesce(max(generation), 0)::int as generation from analytics_report_partitions where connection_id = $1 and query_hash = $2`,
    [input.connection.id, input.job.query_hash],
  );
  const generation = Number(generationRow.rows[0]?.generation ?? 0) + 1;
  const inserted = await db.query<{ id: string }>(
    `insert into analytics_report_partitions
      (client_id, website_id, connection_id, template_key, query_hash, start_date, end_date, source_timezone, provenance, completeness, generation, published, quality)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'api', $9, $10, false, $11) returning id`,
    [input.connection.client_id, input.connection.website_id, input.connection.id, input.job.template_key, input.job.query_hash, input.job.start_date, input.job.end_date, input.timezone, input.completeness, generation, JSON.stringify({ pages: input.pages, quota: input.quota, ...(input.quality ?? {}) })],
  );
  const partitionId = inserted.rows[0]!.id;
  // Rows and values go in batches: one statement per few hundred rows instead of one per row and
  // per metric. A 5,000-row report took 25,016 statements before; the stored result is the same.
  for (let offset = 0; offset < input.facts.length; offset += PROMOTE_BATCH) {
    const batch = input.facts.slice(offset, offset + PROMOTE_BATCH);
    const stored = await db.query<{ id: string; dimension_key: string }>(
      `insert into analytics_report_rows (partition_id, client_id, website_id, dimension_key, dimensions)
       select $1, $2, $3, t.key, t.dims::jsonb from unnest($4::text[], $5::text[]) as t(key, dims)
       returning id, dimension_key`,
      [partitionId, input.connection.client_id, input.connection.website_id, batch.map((fact) => fact.dimensionKey), batch.map((fact) => JSON.stringify(fact.dimensions))],
    );
    const idByKey = new Map(stored.rows.map((row) => [row.dimension_key, row.id]));
    const rowIds: string[] = [];
    const keys: string[] = [];
    const values: Array<number | null> = [];
    const states: string[] = [];
    for (const fact of batch) {
      for (const metric of fact.metrics) {
        rowIds.push(idByKey.get(fact.dimensionKey)!);
        keys.push(metric.key);
        values.push(metric.value);
        states.push(metric.state);
      }
    }
    if (rowIds.length > 0) {
      await db.query(
        `insert into analytics_metric_values (report_row_id, client_id, website_id, metric_key, value_numeric, value_state)
         select t.row_id, $1, $2, t.key, t.value, t.state from unnest($3::uuid[], $4::text[], $5::numeric[], $6::text[]) as t(row_id, key, value, state)`,
        [input.connection.client_id, input.connection.website_id, rowIds, keys, values, states],
      );
    }
  }
  const dated = [...new Set(input.facts.flatMap((fact) => (fact.sourceDate ? [fact.sourceDate] : [])))];
  for (let offset = 0; offset < dated.length; offset += PROMOTE_BATCH) {
    const days = dated.slice(offset, offset + PROMOTE_BATCH);
    await db.query(
      `insert into analytics_coverage (client_id, website_id, connection_id, template_key, source_date, state, tracking_active, measured_through)
       select $1, $2, $3, $4, d.day, case when $5::date is not null and d.day >= $5::date then 'partial' else 'complete' end, true, d.day
       from unnest($6::date[]) as d(day)
       on conflict (connection_id, template_key, source_date) do update set state = excluded.state, fetched_at = now(), measured_through = excluded.measured_through`,
      [input.connection.client_id, input.connection.website_id, input.connection.id, input.job.template_key, input.partialFrom ?? null, days],
    );
  }
  await db.query(
    `update analytics_report_partitions set published = false where connection_id = $1 and query_hash = $2 and published and id <> $3`,
    [input.connection.id, input.job.query_hash, partitionId],
  );
  await db.query("update analytics_report_partitions set published = true where id = $1", [partitionId]);
}

async function pullTemplate(
  connection: ConnectionRow,
  job: JobRow,
  token: TokenBundle,
  known: KnownCapability | null,
  deps: SyncDeps,
): Promise<PulledJob> {
  if (connection.provider === "ga4") {
    const spec = ga4Template(job.template_key);
    const decision = checkCompatibility(spec, known ? {
      metrics: known.supported_metrics ?? [],
      dimensions: known.supported_dimensions ?? [],
      status: known.status,
    } : null);
    if (decision === "unsupported") throw new Error("unsupported");
    const facts = await pullGa4(connection, job, token, deps);
    return {
      ...(isBundle(job.template_key) ? deriveBundle(job, facts) : { facts }),
      capabilities: [{ templateKey: job.template_key, metrics: spec.metrics, dimensions: spec.dimensions, dependencies: [], status: "supported" }],
    };
  }
  if (connection.provider === "wix" && job.template_key === "wix.semantic_discover") return { capabilities: await discoverWix(token, deps) };
  if (connection.provider === "wix") return { facts: await pullWix(connection, job, token, deps) };
  const gsc = await pullGsc(connection, job, token, deps);
  return isBundle(job.template_key) ? deriveBundle(job, gsc) : { facts: gsc };
}

/**
 * Turns one daily-grain pull into the exact-window reports readers ask for. Only windows the
 * pull fully covers are produced. A window the provider returned nothing for is stored as an
 * empty report, the same as a direct request would have been.
 */
function deriveBundle(job: JobRow, pulled: { rows: FactRow[]; timezone: string; pages: number; quota?: Record<string, unknown>; quality?: Record<string, unknown> }): PulledJob {
  const spec = BUNDLES[job.template_key]!;
  const derived = bundleWindows(job.template_key, job.start_date, job.end_date).map((window) => {
    const rows = spec.provider === "gsc"
      ? deriveGscTotals(pulled.rows.flatMap(toGscDaily), window)
      : deriveSessionsByDimension(pulled.rows.flatMap((row) => toDailyDimension(row, spec.dimension!)), spec.dimension!, window);
    return { templateKey: spec.derivesTemplate, start: window.start, end: window.end, rows: rows as FactRow[] };
  });
  return { derived, stats: { rows: pulled.rows.length, pages: pulled.pages, timezone: pulled.timezone, quota: pulled.quota, quality: pulled.quality } };
}

function toDailyDimension(row: FactRow, dimension: string): Array<{ date: string; value: string; sessions: number | null }> {
  const date = row.dimensions.date;
  const metric = row.metrics.find((item) => item.key === "sessions");
  if (!date || !metric) return [];
  return [{ date, value: row.dimensions[dimension] ?? "", sessions: metric.state === "available" ? metric.value : null }];
}

function toGscDaily(row: FactRow): GscDailyRow[] {
  const date = row.dimensions.date;
  const value = (key: string) => row.metrics.find((item) => item.key === key)?.value ?? 0;
  return date ? [{ date, clicks: value("clicks"), impressions: value("impressions"), ctr: value("ctr"), position: value("position") }] : [];
}

type WithheldReasonLabel = Parameters<PrivacyTally["withhold"]>[0];

/**
 * Rows that end up with the same key (two page URLs that differ only by a removed query string) would violate the
 * report's one-row-per-key rule and fail the whole job. They are combined: counts add, CTR is clicks over impressions,
 * position is weighted by impressions, and anything else that cannot be added (users, rates) becomes unavailable.
 */
export function mergeDuplicateRows(input: FactRow[]): { rows: FactRow[]; merged: number } {
  const byKey = new Map<string, FactRow>();
  let merged = 0;
  const value = (list: FactRow["metrics"], key: string) => {
    const m = list.find((item) => item.key === key);
    return m && m.state === "available" ? m.value : null;
  };
  for (const row of input) {
    const existing = byKey.get(row.dimensionKey);
    if (!existing) {
      byKey.set(row.dimensionKey, { ...row, metrics: row.metrics.map((m) => ({ ...m })) });
      continue;
    }
    merged += 1;
    const a = existing.metrics;
    const b = row.metrics;
    const impA = value(a, "impressions");
    const impB = value(b, "impressions");
    const posA = value(a, "position");
    const posB = value(b, "position");
    existing.metrics = a.map((m): FactRow["metrics"][number] => {
      const other = b.find((item) => item.key === m.key);
      if (ADDITIVE_METRICS.has(m.key) && other && m.state === "available" && other.state === "available") {
        return { key: m.key, value: (m.value ?? 0) + (other.value ?? 0), state: "available" };
      }
      if (m.key === "ctr" || m.key === "position") return m;
      return { key: m.key, value: null, state: "unavailable" };
    });
    const clicks = value(existing.metrics, "clicks");
    const impressions = value(existing.metrics, "impressions");
    existing.metrics = existing.metrics.map((m): FactRow["metrics"][number] => {
      if (m.key === "ctr") return clicks !== null && impressions ? { key: "ctr", value: clicks / impressions, state: "available" } : { key: "ctr", value: null, state: "unavailable" };
      if (m.key === "position") {
        const ok = posA !== null && posB !== null && impA !== null && impB !== null && impA + impB > 0;
        return ok ? { key: "position", value: (posA * impA + posB * impB) / (impA + impB), state: "available" } : { key: "position", value: null, state: "unavailable" };
      }
      return m;
    });
  }
  return { rows: [...byKey.values()], merged };
}

async function pullGa4(connection: ConnectionRow, job: JobRow, token: TokenBundle, deps: SyncDeps): Promise<{ rows: FactRow[]; timezone: string; pages: number; quota?: Record<string, unknown>; quality: Record<string, unknown> }> {
  const property = ga4PropertyPath(connection.external_property_id);
  const spec = ga4Template(job.template_key);
  const limit = deps.pageSize ?? 10000;
  const rows: FactRow[] = [];
  let offset = 0;
  let pages = 0;
  let quota: Record<string, unknown> | undefined;
  let finished = false;
  let providerRowCount: number | undefined;
  let invalidValues = 0;
  const privacy = new PrivacyTally();
  const warnings: { timeZone?: string; dataLossFromOtherRow?: boolean; subjectToThresholding?: boolean; sampledShare?: number; emptyReason?: string } = {};
  while (pages < MAX_PROVIDER_PAGES) {
    assertWorkerTime(deps);
    pages += 1;
    if (deps.failOnPage === pages) throw new Error("page_failed");
    const response = await authorized(deps, `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, token.accessToken, ga4ReportBody({
      start: job.start_date,
      end: job.end_date,
      metrics: spec.metrics,
      dimensions: spec.dimensions,
      limit,
      offset,
    }));
    const report = parseGa4Report(validGa4Body(await response.json()));
    quota = report.quota ?? quota;
    providerRowCount = report.rowCount ?? providerRowCount;
    invalidValues += report.invalidValues;
    warnings.timeZone = report.meta.timeZone ?? warnings.timeZone;
    warnings.dataLossFromOtherRow = report.meta.dataLossFromOtherRow || warnings.dataLossFromOtherRow;
    warnings.subjectToThresholding = report.meta.subjectToThresholding || warnings.subjectToThresholding;
    warnings.emptyReason = report.meta.emptyReason ?? warnings.emptyReason;
    if (report.meta.sampledShare !== undefined) warnings.sampledShare = Math.min(report.meta.sampledShare, warnings.sampledShare ?? 1);
    for (const row of report.rows) {
      const date = row.dimensions.date ? `${row.dimensions.date.slice(0, 4)}-${row.dimensions.date.slice(4, 6)}-${row.dimensions.date.slice(6, 8)}` : undefined;
      const dimensions: Record<string, string> = date ? { ...row.dimensions, date } : { ...row.dimensions };
      const metrics: FactRow["metrics"] = spec.metrics.map((key) => ({ key, value: row.metrics[key] ?? null, state: row.metrics[key] === undefined ? "unavailable" : "available" }));
      // Every non-date dimension is checked for identifiers. A page path loses its query string; a row that carries an
      // identifier or credential is withheld and counted (Phase 2.3A). GA4 dimensions were stored unchecked before.
      let withheld: WithheldReasonLabel | null = null;
      for (const name of spec.dimensions) {
        if (name === "date" || dimensions[name] === undefined) continue;
        const decision = classifyDimension(name, dimensions[name]!);
        privacy.note(decision);
        if (decision.value === null) {
          withheld = decision.reason ?? "opaque_identifier";
          break;
        }
        dimensions[name] = decision.value;
      }
      if (withheld) {
        privacy.withhold(withheld, Object.fromEntries(metrics.map((m) => [m.key, m.value])));
        continue;
      }
      const dimensionKey = spec.dimensions.length === 0 ? "range" : spec.dimensions.map((name) => dimensions[name] ?? "").join("|");
      rows.push({ dimensionKey: dimensionKey || "range", dimensions, sourceDate: date, metrics });
    }
    // GA4 says how many rows the whole result has. A short page is the end only if that agrees.
    const moreByCount = providerRowCount !== undefined && offset + report.rows.length < providerRowCount && report.rows.length > 0;
    if (report.rows.length < limit && !moreByCount) {
      finished = true;
      break;
    }
    if (report.rows.length === 0) {
      finished = true;
      break;
    }
    offset += report.rows.length;
  }
  // Every row GA4 returned is either kept, withheld by the privacy filter, or merged into another with the same key.
  const returned = rows.length + privacy.withheldRows;
  const combined = mergeDuplicateRows(rows);
  const quality: Record<string, unknown> = { rowsReturned: combined.rows.length, ...privacy.toQuality() };
  if (combined.merged > 0) quality.duplicateRowsMerged = combined.merged;
  if (providerRowCount !== undefined) quality.providerRowCount = providerRowCount;
  // Stopped at the page cap with more to read: the report is incomplete and says so.
  if (!finished) quality.truncated = true;
  if (providerRowCount !== undefined && finished && returned !== providerRowCount) quality.rowCountMismatch = { returned, providerRowCount };
  if (invalidValues > 0) quality.invalidValues = invalidValues;
  if (warnings.dataLossFromOtherRow) quality.otherRowRolledUp = true;
  if (warnings.subjectToThresholding) quality.subjectToThresholding = true;
  if (warnings.sampledShare !== undefined && warnings.sampledShare < 1) quality.sampledShare = warnings.sampledShare;
  if (warnings.emptyReason) quality.emptyReason = warnings.emptyReason;
  if (warnings.timeZone) {
    quality.providerTimeZone = warnings.timeZone;
    // Dates in the report follow the property's time zone. If our setting differs, a "day" is not the day we think.
    if (connection.provider_timezone && connection.provider_timezone !== warnings.timeZone) {
      quality.timezoneMismatch = { property: warnings.timeZone, configured: connection.provider_timezone };
    }
  }
  return { rows: combined.rows, timezone: connection.provider_timezone || "UTC", pages, quota, quality };
}

async function pullWix(connection: ConnectionRow, job: JobRow, token: TokenBundle, deps: SyncDeps): Promise<{ rows: FactRow[]; timezone: string; pages: number; quality?: Record<string, unknown> }> {
  assertWorkerTime(deps);
  const today = civilDate(connection.provider_timezone || "Asia/Singapore", deps.now);
  const window = wixDataWindow(today, job.start_date, job.end_date);
  if ("error" in window) throw new Error("provider_rejected");
  const response = await deps.fetch(wixDataUrl(window.start, window.end), { headers: { Authorization: token.accessToken } });
  assertStatus(response.status, response.headers.get("retry-after"));
  const points = parseWixData(validWixBody(await response.json()));
  const byDate = new Map<string, FactRow>();
  for (const point of points) {
    const current = byDate.get(point.date) ?? { dimensionKey: point.date, dimensions: { date: point.date }, sourceDate: point.date, metrics: [] };
    current.metrics.push({ key: point.measure.toLowerCase(), value: point.value, state: "available" });
    byDate.set(point.date, current);
  }
  return { rows: [...byDate.values()], timezone: connection.provider_timezone || "Asia/Singapore", pages: 1 };
}

async function discoverWix(token: TokenBundle, deps: SyncDeps): Promise<Array<{ templateKey: string; metrics: string[]; dimensions: string[]; dependencies: string[]; status: "supported" | "unsupported" }>> {
  const response = await deps.fetch("https://www.wixapis.com/analytics/semantic-model/v3/semantic-models", { headers: { Authorization: token.accessToken } });
  if (response.status === 404 || response.status === 403) return [{ templateKey: "wix.semantic", metrics: [], dimensions: [], dependencies: [], status: "unsupported" }];
  assertStatus(response.status, response.headers.get("retry-after"));
  const body = await response.json() as { semanticModels?: Array<{ id?: string }> };
  const models = body.semanticModels ?? [];
  const found = [];
  for (const model of models.slice(0, 20)) {
    if (!model.id) continue;
    const detail = await deps.fetch(`https://www.wixapis.com/analytics/semantic-model/v3/semantic-models/${model.id}`, { headers: { Authorization: token.accessToken } });
    assertStatus(detail.status, detail.headers.get("retry-after"));
    const parsed = parseSemanticModel(await detail.json());
    if (!parsed) continue;
    found.push({
      templateKey: `wix.semantic.${parsed.slug || parsed.id}`,
      metrics: parsed.fields.filter((field) => field.kind === "measure").map((field) => field.name),
      dimensions: parsed.fields.filter((field) => field.kind === "dimension").map((field) => field.name),
      dependencies: parsed.fields.flatMap((field) => field.dependencies),
      status: "supported" as const,
    });
  }
  return found;
}

async function pullGsc(connection: ConnectionRow, job: JobRow, token: TokenBundle, deps: SyncDeps): Promise<{ rows: FactRow[]; timezone: string; pages: number; quality: Record<string, unknown> }> {
  const dimensions = job.template_key === "gsc.pages" ? ["page"] : job.template_key === "gsc.queries" ? ["query"] : job.template_key === "gsc.totals" ? [] : ["date"];
  const pageSize = deps.pageSize ?? GSC_ROW_LIMIT;
  const rows: FactRow[] = [];
  let startRow = 0;
  let pages = 0;
  let finished = false;
  let invalidRows = 0;
  const privacy = new PrivacyTally();
  while (pages < MAX_PROVIDER_PAGES) {
    assertWorkerTime(deps);
    pages += 1;
    if (deps.failOnPage === pages) throw new Error("page_failed");
    const response = await authorized(
      deps,
      `https://www.googleapis.com/webmasters/v3/sites/${encodeSiteUrl(connection.external_property_id)}/searchAnalytics/query`,
      token.accessToken,
      { ...gscQueryBody({ start: job.start_date, end: job.end_date, dimensions, startRow }) as Record<string, unknown>, rowLimit: pageSize },
    );
    const parsed = parseGscQuery(validGscBody(await response.json()));
    invalidRows += parsed.invalidRows;
    for (const row of parsed.rows) {
      let keys = row.keys;
      if (dimensions[0] === "page" || dimensions[0] === "query") {
        const decision = classifyDimension(dimensions[0], row.keys[0] ?? "");
        privacy.note(decision);
        if (decision.value === null) {
          // Withheld for carrying an identifier or credential. Counted, with the clicks and impressions it held.
          privacy.withhold(decision.reason ?? "opaque_identifier", { clicks: row.clicks, impressions: row.impressions });
          continue;
        }
        keys = [decision.value];
      }
      const key = keys.join("|") || "property";
      rows.push({
        dimensionKey: key.slice(0, 400),
        dimensions: Object.fromEntries(dimensions.map((name, index) => [name, keys[index] ?? ""])),
        sourceDate: dimensions[0] === "date" ? keys[0] : undefined,
        metrics: [
          { key: "clicks", value: row.clicks, state: "available" },
          { key: "impressions", value: row.impressions, state: "available" },
          { key: "ctr", value: row.ctr, state: "available" },
          { key: "position", value: row.position, state: "available" },
        ],
      });
    }
    if (!gscHasAnotherPage(parsed.rows.length) && parsed.rows.length < pageSize) {
      finished = true;
      break;
    }
    if (parsed.rows.length < pageSize) {
      finished = true;
      break;
    }
    startRow += parsed.rows.length;
  }
  const combined = mergeDuplicateRows(rows);
  const quality: Record<string, unknown> = { rowsReturned: combined.rows.length, ...privacy.toQuality() };
  if (combined.merged > 0) quality.duplicateRowsMerged = combined.merged;
  // Google "does not guarantee to return all data rows but rather top ones", and exposes at most 50,000 rows a day per
  // search type. Stopping at our own page cap with a full last page is a further, visible truncation.
  if (!finished) quality.truncated = true;
  if (invalidRows > 0) quality.invalidRows = invalidRows;
  return { rows: combined.rows, timezone: GSC_TIME_ZONE, pages, quality };
}

async function storeCapabilities(db: Queryable, connection: ConnectionRow, capabilities: Array<{ templateKey: string; metrics: string[]; dimensions: string[]; dependencies: string[]; status: "supported" | "unsupported" }>): Promise<void> {
  for (const capability of capabilities) {
    const schema = queryHash(capability.templateKey, 1, { metrics: capability.metrics, dimensions: capability.dimensions });
    await db.query(
      `insert into analytics_capabilities
        (connection_id, client_id, website_id, template_key, schema_hash, supported_metrics, supported_dimensions, dependencies, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (connection_id, template_key, schema_hash) do update set checked_at = now(), status = excluded.status`,
      [connection.id, connection.client_id, connection.website_id, capability.templateKey, schema, JSON.stringify(capability.metrics), JSON.stringify(capability.dimensions), JSON.stringify(capability.dependencies), capability.status],
    );
  }
}

async function ensureAccessToken(connection: ConnectionRow, token: TokenBundle, deps: SyncDeps): Promise<TokenBundle> {
  if (!token.expiresAt || new Date(token.expiresAt).getTime() > deps.now.getTime() + 60_000) return token;
  assertWorkerTime(deps);
  return connection.provider === "wix" ? refreshWix(connection, token, deps) : refreshGoogle(token, deps);
}

async function refreshWix(connection: ConnectionRow, token: TokenBundle, deps: SyncDeps): Promise<TokenBundle> {
  if (!deps.wixAppId || !deps.wixAppSecret) throw new ConfigurationError();
  if (!connection.stream_or_site_ref) throw new ReconnectError();
  const response = await deps.fetch("https://www.wixapis.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: deps.wixAppId, client_secret: deps.wixAppSecret, instance_id: connection.stream_or_site_ref }),
  });
  const body = await response.json();
  if (isInvalidGrant(body)) throw new ReconnectError();
  // Wix answers 400, 401 or 403 both for wrong app credentials and for an app that was removed from the site, and the
  // body does not say which. Neither is allowed to disconnect a site automatically; the credential probe tells them apart.
  if (response.status === 400 || response.status === 401 || response.status === 403) throw new ServerCredentialError("oauth_client_rejected");
  assertStatus(response.status, response.headers.get("retry-after"));
  const record = body as { access_token?: string; expires_in?: number };
  if (!record.access_token) throw new RetryableError(60, "invalid_response");
  return { ...token, accessToken: record.access_token, expiresAt: new Date(deps.now.getTime() + (record.expires_in ?? 3600) * 1000).toISOString() };
}

async function refreshGoogle(token: TokenBundle, deps: SyncDeps): Promise<TokenBundle> {
  if (!deps.googleClientId || !deps.googleClientSecret) throw new ConfigurationError();
  if (!token.refreshToken) throw new ReconnectError();
  const response = await deps.fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refreshToken, client_id: deps.googleClientId, client_secret: deps.googleClientSecret }).toString(),
  });
  const body = await response.json();
  // Only an explicit invalid_grant means the grant was revoked or has expired. Everything else the token endpoint
  // refuses (invalid_client, unauthorized_client, invalid_request, a 401) is about the server's OAuth client.
  if (oauthErrorCode(body) === "invalid_grant") throw new ReconnectError();
  if (response.status === 400 || response.status === 401 || response.status === 403) throw new ServerCredentialError("oauth_client_rejected");
  assertStatus(response.status, response.headers.get("retry-after"));
  const record = body as { access_token?: string; expires_in?: number };
  if (!record.access_token) throw new RetryableError(60, "invalid_response");
  return { ...token, accessToken: record.access_token, expiresAt: new Date(deps.now.getTime() + (record.expires_in ?? 3600) * 1000).toISOString() };
}

async function authorized(deps: SyncDeps, url: string, accessToken: string, body: unknown): Promise<FetchResponse> {
  const response = await deps.fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = response.status >= 400 ? await response.json().catch(() => ({})) : null;
  if (payload && isInvalidGrant(payload)) throw new ReconnectError();
  // "API not enabled for this project" is the server's OAuth project, not the clinic's access.
  if (payload && (response.status === 403 || response.status === 400) && apiDisabledBody(payload)) throw new ServerCredentialError("provider_api_disabled");
  assertStatus(response.status, response.headers.get("retry-after"));
  if (payload) {
    return { status: response.status, headers: response.headers, json: async () => payload, text: async () => JSON.stringify(payload) };
  }
  return response;
}

function assertStatus(status: number, retryAfter: string | null): void {
  if (status === 429) throw new RetryableError(Number(retryAfter) || 30, "rate_limited");
  if (status >= 500) throw new RetryableError(Number(retryAfter) || 30, "provider_unavailable");
  if (status === 401 || status === 403) throw new ReconnectError();
  if (status >= 400) throw new Error("provider_rejected");
}

function assertWorkerTime(deps: SyncDeps): void {
  if (deps.deadlineAt !== undefined && (deps.clock ?? Date.now)() >= deps.deadlineAt) {
    throw new RetryableError(30, "worker_deadline");
  }
}

async function loadCapability(db: Queryable, connectionId: string, templateKey: string): Promise<KnownCapability | null> {
  const { rows } = await db.query<KnownCapability>(
    `select supported_metrics, supported_dimensions, status
     from analytics_capabilities
     where connection_id = $1 and template_key = $2
     order by checked_at desc
     limit 1`,
    [connectionId, templateKey],
  );
  return rows[0] ?? null;
}

async function loadConnection(db: Queryable, id: string, clientId: string): Promise<ConnectionRow> {
  const { rows } = await db.query<ConnectionRow>(
    `select id, client_id, website_id, provider, external_property_id, stream_or_site_ref, secret_ref, provider_timezone, status
     from analytics_connections where id = $1 and client_id = $2`,
    [id, clientId],
  );
  const row = rows[0];
  if (!row) throw new Error("provider_rejected");
  return row;
}

export async function retryFailedAnalyticsJobs(
  db: Queryable,
  input: { connectionId: string; actorUserId: string; now?: Date },
): Promise<number> {
  const now = input.now ?? new Date();
  const actor = await db.query<{ allowed: boolean }>(
    `select exists (
       select 1 from staff_users where id = $1 and active and platform_role = 'admin'
     ) as allowed`,
    [input.actorUserId],
  );
  if (!actor.rows[0]?.allowed) return 0;
  const connection = await db.query<{ id: string; client_id: string; status: string }>(
    `select id, client_id, status
     from analytics_connections
     where id = $1 and disconnected_at is null
     for update`,
    [input.connectionId],
  );
  const row = connection.rows[0];
  if (!row || row.status !== "connected") return 0;
  const retried = await db.query<{ id: string }>(
    `update analytics_jobs
     set state = 'queued',
         attempts = 0,
         next_attempt_at = $2,
         lease_owner = null,
         lease_until = null,
         heartbeat_at = null,
         safe_error_code = null,
         last_error_at = null,
         failed_at = null,
         manual_retry_count = manual_retry_count + 1,
         updated_at = $2
     where connection_id = $1 and state = 'failed'
     returning id`,
    [input.connectionId, now.toISOString()],
  );
  if (retried.rows.length > 0) {
    await recordAudit(db, {
      actorType: "staff",
      actorUserId: input.actorUserId,
      action: "analytics_jobs.retry",
      targetType: "analytics_connection",
      targetId: input.connectionId,
      clientId: row.client_id,
      outcome: "success",
      metadata: { count: retried.rows.length },
    });
  }
  return retried.rows.length;
}

async function loadSealedToken(db: Queryable, connection: ConnectionRow): Promise<SealedTokenRow | null> {
  const { rows } = await db.query<SealedTokenRow>(
    "select ciphertext, nonce, client_id from analytics_secrets where id = $1 and connection_id = $2",
    [connection.secret_ref, connection.id],
  );
  return rows[0] ?? null;
}

function decodeClaimedToken(claimed: ClaimedAnalyticsJob): TokenBundle {
  const secret = claimed.sealedToken;
  // Nothing stored for this connection: it genuinely has to be connected.
  if (!secret) throw new ReconnectError();
  // A token that belongs to another client is never used. That is a data fault, not a reason to disconnect.
  if (secret.client_id !== claimed.connection.client_id) throw new ServerCredentialError("token_unreadable");
  if (!tokenKeyConfigured()) throw new ConfigurationError();
  try {
    return JSON.parse(decryptSecret(secret.ciphertext, secret.nonce)) as TokenBundle;
  } catch {
    // The server's key cannot open it. The key is the more likely thing to be wrong, and the token is untouched.
    throw new ServerCredentialError("token_unreadable");
  }
}

export function sealedToken(token: TokenBundle): { ciphertext: string; nonce: string } {
  const sealed = encryptSecret(JSON.stringify(token));
  return { ciphertext: sealed.ciphertext, nonce: sealed.nonce };
}

export function windowLength(start: string, end: string): number {
  return daysBetween(start, end) + 1;
}

/**
 * A fresh provider token for a direct read outside a sync job (D60). A Wix token is always re-issued for the
 * stored instance, and a Google token with a refresh token is always refreshed, so the stored grant is tested.
 */
export async function freshProviderToken(connection: ConnectionRow, token: TokenBundle, deps: SyncDeps): Promise<TokenBundle> {
  if (connection.provider === "wix") return refreshWix(connection, token, deps);
  if (token.refreshToken) return refreshGoogle(token, deps);
  return ensureAccessToken(connection, token, deps);
}

export type ProviderFailureCode = "reconnect_required" | "not_configured" | "rate_limited" | "provider_unavailable" | "provider_rejected";

/** The safe code for an error thrown by a provider token refresh. */
export function providerFailureCode(error: unknown): ProviderFailureCode {
  if (error instanceof ReconnectError) return "reconnect_required";
  if (error instanceof ConfigurationError) return "not_configured";
  // The provider refused our OAuth client or the token request (recovery C1). It may be a server credential or an app
  // removed from the site, and the answer does not say which, so the check leaves the status as it is.
  if (error instanceof ServerCredentialError) return "provider_rejected";
  if (error instanceof RetryableError) return error.code === "rate_limited" ? "rate_limited" : "provider_unavailable";
  // assertStatus throws this for a 4xx answer. Anything else means the request did not complete.
  if (error instanceof Error && error.message === "provider_rejected") return "provider_rejected";
  return "provider_unavailable";
}

// ---------------------------------------------------------------------------------------------
// Credential probe (connection recovery, C2). Answers "would the worker be able to authenticate this connection?"
// without doing any of the worker's work.

export type ProbeRefresh =
  | "ok"
  | "invalid_grant"
  | "oauth_client_rejected"
  | "config_missing"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_response"
  | "unexpected"
  | "skipped";

export interface CredentialProbe {
  decrypt: "ok" | "unreadable" | "key_missing" | "no_secret" | "wrong_client";
  hasRefreshToken: boolean;
  hasSiteReference: boolean;
  /** Minutes until the stored access token expires; negative when it already has. Null when unknown. */
  accessTokenMinutes: number | null;
  oauthClientConfigured: boolean;
  /** What the provider's token endpoint said to a refresh made with the server's credentials. */
  refresh: ProbeRefresh;
}

/**
 * Opens the stored token with the server's key and, if that works, asks the provider's TOKEN endpoint (and only that) for a
 * fresh access token with the server's OAuth client. It reads the connection and its sealed token and nothing else. It
 * writes nothing, saves nothing, and returns the outcome as a category: the refreshed token is discarded, and no token,
 * key or secret is ever part of the result. The caller should run it in a read-only transaction.
 *
 * A failure here is exactly the failure the worker would meet. Since C1 the worker no longer disconnects a connection for
 * the server-side ones, but the probe is the way to find out before any job is queued.
 */
export async function probeConnectionCredentials(db: Queryable, connectionId: string, deps: SyncDeps): Promise<CredentialProbe> {
  const { rows } = await db.query<ConnectionRow>(
    `select id, client_id, website_id, provider, external_property_id, stream_or_site_ref, secret_ref, provider_timezone, status
     from analytics_connections where id = $1`,
    [connectionId],
  );
  const connection = rows[0];
  if (!connection) throw new Error("connection_missing");
  const configured = connection.provider === "wix"
    ? Boolean(deps.wixAppId && deps.wixAppSecret)
    : Boolean(deps.googleClientId && deps.googleClientSecret);
  const base = { hasRefreshToken: false, hasSiteReference: Boolean(connection.stream_or_site_ref), accessTokenMinutes: null as number | null, oauthClientConfigured: configured };
  const sealed = await loadSealedToken(db, connection);
  if (!sealed) return { ...base, decrypt: "no_secret", refresh: "skipped" };
  if (sealed.client_id !== connection.client_id) return { ...base, decrypt: "wrong_client", refresh: "skipped" };
  if (!tokenKeyConfigured()) return { ...base, decrypt: "key_missing", refresh: "skipped" };
  let token: TokenBundle;
  try {
    token = JSON.parse(decryptSecret(sealed.ciphertext, sealed.nonce)) as TokenBundle;
  } catch {
    return { ...base, decrypt: "unreadable", refresh: "skipped" };
  }
  const expires = token.expiresAt ? Date.parse(token.expiresAt) : NaN;
  const known = {
    ...base,
    decrypt: "ok" as const,
    hasRefreshToken: Boolean(token.refreshToken),
    accessTokenMinutes: Number.isFinite(expires) ? Math.round((expires - deps.now.getTime()) / 60_000) : null,
  };
  if (!configured) return { ...known, refresh: "config_missing" };
  // Nothing to refresh with: the probe cannot test the OAuth client, and says so rather than guessing.
  if (connection.provider === "wix" ? !connection.stream_or_site_ref : !token.refreshToken) return { ...known, refresh: "skipped" };
  const probeDeps: SyncDeps = { ...deps, fetch: resilientFetch(deps.fetch) };
  try {
    if (connection.provider === "wix") await refreshWix(connection, token, probeDeps);
    else await refreshGoogle(token, probeDeps);
    return { ...known, refresh: "ok" };
  } catch (error) {
    if (error instanceof ReconnectError) return { ...known, refresh: "invalid_grant" };
    if (error instanceof ServerCredentialError) return { ...known, refresh: "oauth_client_rejected" };
    if (error instanceof ConfigurationError) return { ...known, refresh: "config_missing" };
    if (error instanceof RetryableError) {
      return { ...known, refresh: error.code === "rate_limited" ? "rate_limited" : error.code === "invalid_response" ? "invalid_response" : "provider_unavailable" };
    }
    return { ...known, refresh: "unexpected" };
  }
}
