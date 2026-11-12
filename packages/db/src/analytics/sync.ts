import type { Queryable } from "../client";
import { addDays, daysBetween } from "../services/dates";
import { recordAudit } from "../services/audit";
import { decryptSecret, encryptSecret } from "./crypto";
import { queryHash, safeAnalyticsPath, safeSearchQuery, type AnalyticsProvider } from "./measure";
import { checkCompatibility, ga4PropertyPath, ga4ReportBody, ga4Template, isInvalidGrant, parseGa4Report } from "./providers/ga4";
import { GSC_ROW_LIMIT, GSC_TIME_ZONE, encodeSiteUrl, gscHasAnotherPage, gscQueryBody, parseGscQuery } from "./providers/gsc";
import { parseSemanticModel, parseWixData, wixDataUrl, wixDataWindow, wixDueWindow } from "./providers/wix";

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
  code: "rate_limited" | "provider_unavailable" | "worker_deadline";
  constructor(seconds: number, code: "rate_limited" | "provider_unavailable" | "worker_deadline") {
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

interface PulledJob {
  facts?: { rows: FactRow[]; timezone: string; pages: number; quota?: Record<string, unknown> };
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

export async function enqueueJob(db: Queryable, input: {
  clientId: string;
  websiteId: string;
  connectionId: string;
  templateKey: string;
  start: string;
  end: string;
  version?: number;
}): Promise<{ id: string; reused: boolean }> {
  const hash = queryHash(input.templateKey, input.version ?? 1, { start: input.start, end: input.end });
  const existing = await db.query<{ id: string; state: string }>(
    `select id, state from analytics_jobs
     where connection_id = $1 and template_key = $2 and query_hash = $3 and start_date = $4 and end_date = $5 and state <> 'cancelled'
     order by created_at desc
     limit 1`,
    [input.connectionId, input.templateKey, hash, input.start, input.end],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].state === "succeeded") {
      await db.query(
        `update analytics_jobs
         set state = 'queued', attempts = 0, next_attempt_at = now(), safe_error_code = null,
             last_error_at = null, failed_at = null, updated_at = now()
         where id = $1 and state = 'succeeded'`,
        [existing.rows[0].id],
      );
    }
    return { id: existing.rows[0].id, reused: true };
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into analytics_jobs (client_id, website_id, connection_id, template_key, query_hash, start_date, end_date)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (connection_id, template_key, query_hash, start_date, end_date)
       where state in ('queued', 'leased')
     do nothing
     returning id`,
    [input.clientId, input.websiteId, input.connectionId, input.templateKey, hash, input.start, input.end],
  );
  if (rows[0]) return { id: rows[0].id, reused: false };
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

export async function enqueueDue(db: Queryable, now: Date, websiteId?: string): Promise<number> {
  const { rows } = await db.query<ConnectionRow>(
    `select id, client_id, website_id, provider, external_property_id, stream_or_site_ref, secret_ref, provider_timezone, status
     from analytics_connections where status = 'connected' and disconnected_at is null
       and ($1::uuid is null or website_id = $1)`,
    [websiteId ?? null],
  );
  let created = 0;
  for (const connection of rows) {
    const window = dueWindow(connection.provider, now, connection.provider_timezone);
    for (const templateKey of TEMPLATES[connection.provider]) {
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

export async function reapExpiredLeases(db: Queryable, now: Date): Promise<number> {
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
     returning id, attempts >= $2 as terminal`,
    [at, MAX_ATTEMPTS, MAX_BACKOFF_SECONDS],
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

export async function leaseNext(db: Queryable, owner: string, now: Date): Promise<JobRow | null> {
  await reapExpiredLeases(db, now);
  const { rows } = await db.query<JobRow>(
    `with next as (
       select candidate.id from analytics_jobs candidate
       where candidate.state = 'queued' and candidate.next_attempt_at <= $2
         and not exists (
           select 1 from analytics_jobs active
           where active.connection_id = candidate.connection_id and active.state = 'leased'
         )
       order by candidate.next_attempt_at, candidate.created_at, candidate.id
       for update skip locked
       limit 1
     )
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
       j.start_date::text, j.end_date::text, j.attempts, j.lease_owner`,
    [owner, now.toISOString(), LEASE_SECONDS],
  );
  return rows[0] ?? null;
}

export async function claimNextJob(db: Queryable, owner: string, now: Date): Promise<ClaimedAnalyticsJob | null> {
  const job = await leaseNext(db, owner, now);
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

export async function executeClaimedJob(
  run: <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>,
  claimed: ClaimedAnalyticsJob,
  deps: SyncDeps,
): Promise<{ result: WorkerJobResult }> {
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
  return run((db) => finalizeClaimedJob(db, claimed, pulled, original, current));
}

export async function runWorkerOnce(
  run: <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>,
  owner: string,
  deps: SyncDeps,
): Promise<{ worked: boolean; result?: WorkerJobResult }> {
  const claimed = await run((db) => claimNextJob(db, owner, deps.now));
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

async function finalizeClaimedJob(
  db: Queryable,
  claimed: ClaimedAnalyticsJob,
  pulled: PulledJob,
  original: TokenBundle,
  token: TokenBundle,
): Promise<{ result: WorkerJobResult }> {
  if (!await lockOwnedClaim(db, claimed)) return { result: "stale" };
  await saveRefreshedToken(db, claimed, original, token);
  if (pulled.capabilities) await storeCapabilities(db, claimed.connection, pulled.capabilities);
  if (pulled.facts) {
    await promote(db, {
      connection: claimed.connection,
      job: claimed.job,
      facts: pulled.facts.rows,
      completeness: pulled.facts.rows.length === 0 ? "empty" : "complete",
      timezone: pulled.facts.timezone,
      pages: pulled.facts.pages,
      quota: pulled.facts.quota ?? {},
    });
  }
  await finish(
    db,
    claimed.job.id,
    claimed.runId,
    "succeeded",
    pulled.facts?.pages ?? pulled.capabilities?.length ?? 0,
    pulled.facts?.rows.length ?? 0,
    null,
    pulled.facts?.quota ?? {},
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
  if (error instanceof ReconnectError) {
    await db.query("update analytics_connections set status = 'reconnect_required', updated_at = $2 where id = $1", [claimed.connection.id, at]);
    await db.query(
      `update analytics_jobs
       set state = 'reconnect_required', safe_error_code = 'reconnect_required', last_error_at = $2,
           failed_at = $2, lease_owner = null, lease_until = null, heartbeat_at = null, updated_at = $2
       where id = $1`,
      [claimed.job.id, at],
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
): Promise<void> {
  if (result === "succeeded") {
    await db.query(
      `update analytics_jobs
       set state = 'succeeded', lease_owner = null, lease_until = null, heartbeat_at = null,
           safe_error_code = null, last_error_at = null, failed_at = null, updated_at = now()
       where id = $1`,
      [jobId],
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

async function promote(db: Queryable, input: {
  connection: ConnectionRow;
  job: JobRow;
  facts: FactRow[];
  completeness: "complete" | "empty";
  timezone: string;
  pages: number;
  quota: Record<string, unknown>;
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
    [input.connection.client_id, input.connection.website_id, input.connection.id, input.job.template_key, input.job.query_hash, input.job.start_date, input.job.end_date, input.timezone, input.completeness, generation, JSON.stringify({ pages: input.pages, quota: input.quota })],
  );
  const partitionId = inserted.rows[0]!.id;
  for (const fact of input.facts) {
    const row = await db.query<{ id: string }>(
      `insert into analytics_report_rows (partition_id, client_id, website_id, dimension_key, dimensions) values ($1, $2, $3, $4, $5) returning id`,
      [partitionId, input.connection.client_id, input.connection.website_id, fact.dimensionKey, JSON.stringify(fact.dimensions)],
    );
    for (const metric of fact.metrics) {
      await db.query(
        `insert into analytics_metric_values (report_row_id, client_id, website_id, metric_key, value_numeric, value_state) values ($1, $2, $3, $4, $5, $6)`,
        [row.rows[0]!.id, input.connection.client_id, input.connection.website_id, metric.key, metric.value, metric.state],
      );
    }
    if (fact.sourceDate) {
      await db.query(
        `insert into analytics_coverage (client_id, website_id, connection_id, template_key, source_date, state, tracking_active, measured_through)
         values ($1, $2, $3, $4, $5, 'complete', true, $5)
         on conflict (connection_id, template_key, source_date) do update set state = 'complete', fetched_at = now(), measured_through = excluded.measured_through`,
        [input.connection.client_id, input.connection.website_id, input.connection.id, input.job.template_key, fact.sourceDate],
      );
    }
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
    return {
      facts: await pullGa4(connection, job, token, deps),
      capabilities: [{ templateKey: job.template_key, metrics: spec.metrics, dimensions: spec.dimensions, dependencies: [], status: "supported" }],
    };
  }
  if (connection.provider === "wix" && job.template_key === "wix.semantic_discover") return { capabilities: await discoverWix(token, deps) };
  if (connection.provider === "wix") return { facts: await pullWix(connection, job, token, deps) };
  return { facts: await pullGsc(connection, job, token, deps) };
}

async function pullGa4(connection: ConnectionRow, job: JobRow, token: TokenBundle, deps: SyncDeps): Promise<{ rows: FactRow[]; timezone: string; pages: number; quota?: Record<string, unknown> }> {
  const property = ga4PropertyPath(connection.external_property_id);
  const spec = ga4Template(job.template_key);
  const limit = deps.pageSize ?? 10000;
  const rows: FactRow[] = [];
  let offset = 0;
  let pages = 0;
  let quota: Record<string, unknown> | undefined;
  while (pages < 20) {
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
    const report = parseGa4Report(await response.json());
    quota = report.quota;
    for (const row of report.rows) {
      const date = row.dimensions.date ? `${row.dimensions.date.slice(0, 4)}-${row.dimensions.date.slice(4, 6)}-${row.dimensions.date.slice(6, 8)}` : undefined;
      const dimensions = date ? { ...row.dimensions, date } : row.dimensions;
      const dimensionKey = spec.dimensions.length === 0 ? "range" : spec.dimensions.map((name) => dimensions[name] ?? "").join("|");
      rows.push({
        dimensionKey: dimensionKey || "range",
        dimensions,
        sourceDate: date,
        metrics: spec.metrics.map((key) => ({ key, value: row.metrics[key] ?? null, state: row.metrics[key] === undefined ? "unavailable" : "available" })),
      });
    }
    if (report.rows.length < limit) break;
    offset += report.rows.length;
  }
  return { rows, timezone: connection.provider_timezone || "UTC", pages, quota };
}

async function pullWix(connection: ConnectionRow, job: JobRow, token: TokenBundle, deps: SyncDeps): Promise<{ rows: FactRow[]; timezone: string; pages: number }> {
  assertWorkerTime(deps);
  const today = civilDate(connection.provider_timezone || "Asia/Singapore", deps.now);
  const window = wixDataWindow(today, job.start_date, job.end_date);
  if ("error" in window) throw new Error("provider_rejected");
  const response = await deps.fetch(wixDataUrl(window.start, window.end), { headers: { Authorization: token.accessToken } });
  assertStatus(response.status, response.headers.get("retry-after"));
  const points = parseWixData(await response.json());
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

async function pullGsc(connection: ConnectionRow, job: JobRow, token: TokenBundle, deps: SyncDeps): Promise<{ rows: FactRow[]; timezone: string; pages: number }> {
  const dimensions = job.template_key === "gsc.pages" ? ["page"] : job.template_key === "gsc.queries" ? ["query"] : job.template_key === "gsc.totals" ? [] : ["date"];
  const pageSize = deps.pageSize ?? GSC_ROW_LIMIT;
  const rows: FactRow[] = [];
  let startRow = 0;
  let pages = 0;
  while (pages < 20) {
    assertWorkerTime(deps);
    pages += 1;
    if (deps.failOnPage === pages) throw new Error("page_failed");
    const response = await authorized(
      deps,
      `https://www.googleapis.com/webmasters/v3/sites/${encodeSiteUrl(connection.external_property_id)}/searchAnalytics/query`,
      token.accessToken,
      { ...gscQueryBody({ start: job.start_date, end: job.end_date, dimensions, startRow }) as Record<string, unknown>, rowLimit: pageSize },
    );
    const parsed = parseGscQuery(await response.json());
    for (const row of parsed.rows) {
      const rawKey = row.keys[0] ?? "";
      const page = dimensions[0] === "page" ? safeAnalyticsPath(rawKey) : null;
      const query = dimensions[0] === "query" ? safeSearchQuery(rawKey) : null;
      if (dimensions[0] === "page" && !page) continue;
      if (dimensions[0] === "query" && !query) continue;
      const keys = dimensions[0] === "page" ? [page!] : dimensions[0] === "query" ? [query!] : row.keys;
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
    if (!gscHasAnotherPage(parsed.rows.length) && parsed.rows.length < pageSize) break;
    if (parsed.rows.length < pageSize) break;
    startRow += parsed.rows.length;
  }
  return { rows, timezone: GSC_TIME_ZONE, pages };
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
  if (response.status === 401 || isInvalidGrant(body)) throw new ReconnectError();
  assertStatus(response.status, response.headers.get("retry-after"));
  const record = body as { access_token?: string; expires_in?: number };
  if (!record.access_token) throw new ReconnectError();
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
  if (response.status === 400 || isInvalidGrant(body)) throw new ReconnectError();
  assertStatus(response.status, response.headers.get("retry-after"));
  const record = body as { access_token?: string; expires_in?: number };
  if (!record.access_token) throw new ReconnectError();
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
  if (deps.deadlineAt !== undefined && Date.now() >= deps.deadlineAt) {
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
  if (!secret || secret.client_id !== claimed.connection.client_id) throw new ReconnectError();
  if (!tokenKeyConfigured()) throw new ConfigurationError();
  try {
    return JSON.parse(decryptSecret(secret.ciphertext, secret.nonce)) as TokenBundle;
  } catch {
    throw new ReconnectError();
  }
}

export function sealedToken(token: TokenBundle): { ciphertext: string; nonce: string } {
  const sealed = encryptSecret(JSON.stringify(token));
  return { ciphertext: sealed.ciphertext, nonce: sealed.nonce };
}

export function windowLength(start: string, end: string): number {
  return daysBetween(start, end) + 1;
}
