import { createHash } from "node:crypto";
import type { Queryable } from "../client";
import { addDays } from "../services/dates";
import { recordAudit } from "../services/audit";
import { gscLatestDay } from "./scheduling";
import { wixDueWindow } from "./providers/wix";
import { civilDate, enqueueJob, probeConnectionCredentials, runWorkerOnce, type CredentialProbe, type SyncDeps } from "./sync";
import {
  DEADLINE_MARGIN_MS, closeInvocation, drainProviderJobs, registerInvocation, remainingWork, type InvocationReport,
} from "./worker-run";
import type { AnalyticsProvider } from "./measure";

/**
 * Controlled one-connection pilot (connection recovery, C2).
 *
 * Runs the existing synchronisation for ONE explicitly allow-listed connection, over one small fixed window, or only
 * proves that connection's credentials work. It uses the Phase 2 queue, lease, worker, invocation record and audit log
 * unchanged. What it adds is a fence: it queues only its own jobs, leases only those, reaps only expired leases of that
 * connection, and never reads another connection's token.
 *
 * Nothing it returns or records contains a token, a key, a property id, a site address or a client name. A connection
 * is named by an eight-character reference (a hash prefix of its id), which is also what the allow-list holds.
 */

export const PILOT_MAX_JOBS = 12;
export const PILOT_DEFAULT_BUDGET_MS = 90_000;

export type PilotRun = <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>;

export class PilotError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PilotError";
    this.status = status;
    this.code = code;
  }
}

/** Eight-character reference to a connection. The same value `npm run analytics:health` prints. */
export function connectionRef(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 8);
}

/** `ANALYTICS_PILOT_ALLOWED_CONNECTIONS`: comma-separated eight-character references. Anything else in the list is ignored. */
export function parseAllowList(raw: string | undefined): Set<string> {
  return new Set((raw ?? "").split(",").map((item) => item.trim().toLowerCase()).filter((item) => /^[0-9a-f]{8}$/.test(item)));
}

// ---------------------------------------------------------------------------------------------
// Request

export interface PilotRequest {
  connection: string;
  mode: "probe" | "run";
  templates?: string[];
  /** Last day of the window. Never later than the latest settled day for the provider. */
  end?: string;
  maxJobs: number;
  /** Make this connection's waiting pilot jobs due now and clear its pause. For retrying after a fixed server setting. */
  requeueWaiting: boolean;
}

const KEYS = new Set(["connection", "mode", "templates", "end", "maxJobs", "requeueWaiting"]);

export function parsePilotRequest(body: unknown): PilotRequest {
  const bad = (message: string) => new PilotError(400, "invalid_request", message);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("The request must be a JSON object.");
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!KEYS.has(key)) throw bad("The request has a field the pilot does not accept.");
  if (typeof record.connection !== "string" || !/^[0-9a-f]{8}$/i.test(record.connection)) throw bad("connection must be an eight-character reference.");
  if (record.mode !== "probe" && record.mode !== "run") throw bad("mode must be probe or run.");
  let templates: string[] | undefined;
  if (record.templates !== undefined) {
    if (!Array.isArray(record.templates) || record.templates.length === 0 || record.templates.length > PILOT_MAX_JOBS || !record.templates.every((t) => typeof t === "string" && /^[a-z0-9_.]{1,40}$/.test(t))) {
      throw bad("templates must be a short list of report names.");
    }
    templates = [...new Set(record.templates as string[])];
  }
  if (record.end !== undefined && (typeof record.end !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.end) || Number.isNaN(Date.parse(record.end)))) throw bad("end must be a date, YYYY-MM-DD.");
  let maxJobs = PILOT_MAX_JOBS;
  if (record.maxJobs !== undefined) {
    if (!Number.isInteger(record.maxJobs) || (record.maxJobs as number) < 1 || (record.maxJobs as number) > PILOT_MAX_JOBS) throw bad(`maxJobs must be a whole number from 1 to ${PILOT_MAX_JOBS}.`);
    maxJobs = record.maxJobs as number;
  }
  if (record.requeueWaiting !== undefined && typeof record.requeueWaiting !== "boolean") throw bad("requeueWaiting must be true or false.");
  return {
    connection: record.connection.toLowerCase(),
    mode: record.mode,
    templates,
    end: record.end as string | undefined,
    maxJobs,
    requeueWaiting: record.requeueWaiting === true,
  };
}

// ---------------------------------------------------------------------------------------------
// Plan

export interface PilotJob {
  templateKey: string;
  start: string;
  end: string;
}

/** Days GA4 and Wix take to settle before a window is fixed; the pilot never asks for a window newer than this. */
const GA4_SETTLE_DAYS = 4;

/**
 * The fixed, small reporting window for one connection, as an ordered list of jobs. The first job is the cheapest and the
 * one every dashboard figure depends on, so `maxJobs: 1` proves the whole path with one request.
 */
export function pilotPlan(provider: AnalyticsProvider, now: Date, timezone: string | null, request: Pick<PilotRequest, "templates" | "end">): PilotJob[] {
  let jobs: PilotJob[];
  if (provider === "ga4") {
    const latest = addDays(civilDate("Asia/Singapore", now), -GA4_SETTLE_DAYS);
    const end = boundedEnd(request.end, latest);
    const current = { start: addDays(end, -6), end };
    const previous = { start: addDays(end, -13), end: addDays(end, -7) };
    const daily = { start: previous.start, end };
    jobs = [
      { templateKey: "ga4.traffic_daily", ...daily },
      { templateKey: "ga4.traffic_range", ...current },
      { templateKey: "ga4.traffic_range", ...previous },
      { templateKey: "ga4.acquisition", ...current },
      { templateKey: "ga4.acquisition", ...previous },
      { templateKey: "ga4.device", ...current },
      { templateKey: "ga4.country", ...current },
      { templateKey: "ga4.engagement", ...current },
      { templateKey: "ga4.landing", ...current },
      { templateKey: "ga4.pages", ...current },
      { templateKey: "ga4.visitor_type", ...current },
    ];
  } else if (provider === "gsc") {
    const end = boundedEnd(request.end, gscLatestDay(now));
    const window = { start: addDays(end, -6), end };
    jobs = ["gsc.totals", "gsc.pages", "gsc.queries"].map((templateKey) => ({ templateKey, ...window }));
  } else {
    if (request.end) throw new PilotError(400, "invalid_request", "A Wix pilot always covers the last 62 days; end cannot be set.");
    const window = wixDueWindow(civilDate(timezone || "Asia/Singapore", now));
    jobs = [{ templateKey: "wix.data_daily", ...window }];
  }
  if (request.templates) {
    const wanted = new Set(request.templates);
    const known = new Set(jobs.map((job) => job.templateKey));
    for (const template of wanted) if (!known.has(template)) throw new PilotError(400, "invalid_request", "A requested report is not part of the pilot for this connection.");
    jobs = jobs.filter((job) => wanted.has(job.templateKey));
  }
  return jobs;
}

function boundedEnd(requested: string | undefined, latest: string): string {
  if (!requested) return latest;
  if (requested > latest) throw new PilotError(400, "invalid_request", "end is later than the latest day the provider has settled.");
  if (requested < addDays(latest, -90)) throw new PilotError(400, "invalid_request", "end is more than 90 days before the latest settled day.");
  return requested;
}

// ---------------------------------------------------------------------------------------------
// Connection

interface PilotConnection {
  id: string;
  client_id: string;
  website_id: string;
  provider: AnalyticsProvider;
  status: string;
  provider_timezone: string | null;
}

/** The generic refusal for an unlisted or unknown reference, so the route cannot be used to find which references exist. */
const NOT_ALLOWED = "This connection is not allowed for the pilot.";

async function audit(run: PilotRun, input: { action: string; outcome: "success" | "denied" | "failure"; connection?: PilotConnection; metadata: Record<string, unknown> }): Promise<void> {
  await run((db) => recordAudit(db, {
    actorType: "service",
    action: input.action,
    targetType: "analytics_connection",
    targetId: input.connection?.id ?? null,
    clientId: input.connection?.client_id ?? null,
    outcome: input.outcome,
    metadata: input.metadata,
  }));
}

async function resolveConnection(run: PilotRun, request: PilotRequest, allowList: Set<string>): Promise<PilotConnection> {
  const refuse = async (reason: string, status: number, message: string, connection?: PilotConnection): Promise<never> => {
    await audit(run, { action: "analytics.pilot.refused", outcome: "denied", connection, metadata: { connection: request.connection, mode: request.mode, reason } });
    throw new PilotError(status, reason, message);
  };
  if (!allowList.has(request.connection)) return refuse("not_allowed", 403, NOT_ALLOWED);
  const rows = await run((db) => db.query<PilotConnection>(
    `select id, client_id, website_id, provider, status, provider_timezone from analytics_connections
     where left(encode(sha256(id::text::bytea), 'hex'), 8) = $1 and disconnected_at is null`,
    [request.connection],
  ).then((result) => result.rows));
  if (rows.length === 0) return refuse("not_allowed", 403, NOT_ALLOWED);
  if (rows.length > 1) return refuse("ambiguous_reference", 409, "That reference matches more than one connection. Nothing was run.");
  const connection = rows[0]!;
  if (connection.status !== "connected") return refuse("not_connected", 409, "The connection is not in the connected state. Nothing was run.", connection);
  return connection;
}

// ---------------------------------------------------------------------------------------------
// Probe

export interface PilotProbeResult extends CredentialProbe {
  mode: "probe";
  connection: string;
  provider: AnalyticsProvider;
  /** The server can open the stored token and the provider accepted a refresh made with the server's OAuth client. */
  ready: boolean;
  /** Always false. The probe runs in a read-only transaction; only an audit entry is recorded. */
  changedConnection: false;
}

export interface PilotProbeOptions {
  allowList: Set<string>;
  /**
   * Runs the probe's own reads in a transaction in which the database refuses every write. Required, not optional: the
   * route supplies `withReadOnlyContext`, so the probe cannot change anything whatever it does. The audit entry is written
   * afterwards through the ordinary runner.
   */
  runReadOnly: PilotRun;
}

export async function runPilotProbe(run: PilotRun, request: PilotRequest, deps: SyncDeps, options: PilotProbeOptions): Promise<PilotProbeResult> {
  const connection = await resolveConnection(run, request, options.allowList);
  const probe = await options.runReadOnly((db) => probeConnectionCredentials(db, connection.id, deps));
  const ready = probe.decrypt === "ok" && probe.refresh === "ok";
  await audit(run, {
    action: "analytics.pilot.probe",
    outcome: ready ? "success" : "failure",
    connection,
    metadata: { connection: request.connection, provider: connection.provider, decrypt: probe.decrypt, refresh: probe.refresh, hasRefreshToken: probe.hasRefreshToken, oauthClientConfigured: probe.oauthClientConfigured },
  });
  return { mode: "probe", connection: request.connection, provider: connection.provider, ...probe, ready, changedConnection: false };
}

// ---------------------------------------------------------------------------------------------
// Run

export interface PilotRunResult {
  mode: "run";
  connection: string;
  provider: AnalyticsProvider;
  window: { start: string; end: string };
  plannedTotal: number;
  queuedNow: number;
  alreadyQueuedOrDone: number;
  jobs: number;
  succeeded: number;
  failed: number;
  retryScheduled: number;
  reconnectRequired: number;
  /** Server-side credential or configuration problems. The connection was left as it was. */
  credentialOrConfigWaiting: number;
  stale: number;
  stopped: "empty" | "limit" | "deadline" | "overlap";
  jobStates: Record<string, number>;
  rowsStored: number;
  reports: Array<{ template: string; start: string; end: string; completeness: string; rows: number }>;
  connectionStatusChanged: boolean;
  durationMs: number;
}

export interface PilotRunOptions {
  allowList: Set<string>;
  clock?: () => number;
  budgetMs?: number;
  maxConcurrent?: number;
  /** False skips the invocation table (rollback of migration 0054). The audit log is always written. */
  record?: boolean;
}

export async function runPilotSync(run: PilotRun, request: PilotRequest, deps: SyncDeps, options: PilotRunOptions): Promise<PilotRunResult> {
  const connection = await resolveConnection(run, request, options.allowList);
  const clock = options.clock ?? Date.now;
  const budgetMs = options.budgetMs ?? PILOT_DEFAULT_BUDGET_MS;
  const startedMs = clock();
  const started = new Date(startedMs);
  const owner = `pilot:${request.connection}`;
  const planned = pilotPlan(connection.provider, started, connection.provider_timezone, request);
  const chosen = planned.slice(0, request.maxJobs);
  const window = { start: chosen.reduce((min, job) => (job.start < min ? job.start : min), chosen[0]!.start), end: chosen.reduce((max, job) => (job.end > max ? job.end : max), chosen[0]!.end) };
  const empty = (stopped: PilotRunResult["stopped"]): PilotRunResult => ({
    mode: "run", connection: request.connection, provider: connection.provider, window, plannedTotal: planned.length, queuedNow: 0, alreadyQueuedOrDone: 0,
    jobs: 0, succeeded: 0, failed: 0, retryScheduled: 0, reconnectRequired: 0, credentialOrConfigWaiting: 0, stale: 0, stopped, jobStates: {}, rowsStored: 0, reports: [],
    connectionStatusChanged: false, durationMs: clock() - startedMs,
  });

  const record = options.record ?? true;
  let invocationId: string | null = null;
  if (record) {
    const registered = await run((db) => registerInvocation(db, {
      owner, trigger: "manual", now: started, budgetMs, jobLimit: request.maxJobs, maxConcurrent: options.maxConcurrent ?? 2, staleAfterMs: budgetMs + 120_000,
    }));
    invocationId = registered.id;
    if (registered.overlapped) {
      await audit(run, { action: "analytics.pilot.run", outcome: "failure", connection, metadata: { connection: request.connection, provider: connection.provider, stopped: "overlap" } });
      return empty("overlap");
    }
  }

  let result: PilotRunResult | null = null;
  try {
    // Queue exactly the chosen jobs. A job that already exists (queued, running or finished) is reused, never duplicated.
    const queued = await run(async (db) => {
      const ids: string[] = [];
      let created = 0;
      for (const job of chosen) {
        const made = await enqueueJob(db, {
          clientId: connection.client_id, websiteId: connection.website_id, connectionId: connection.id,
          templateKey: job.templateKey, start: job.start, end: job.end, now: started, refreshAfterSeconds: null,
        });
        ids.push(made.id);
        if (!made.reused) created += 1;
      }
      if (request.requeueWaiting) {
        await db.query(
          `update analytics_jobs set next_attempt_at = $2, updated_at = $2
           where connection_id = $1 and id = any($3::uuid[]) and state = 'queued' and next_attempt_at > $2`,
          [connection.id, started.toISOString(), ids],
        );
        await db.query("update analytics_connections set cooldown_until = null, consecutive_failures = 0 where id = $1", [connection.id]);
      }
      return { ids, created };
    });

    const deadlineAt = startedMs + budgetMs - DEADLINE_MARGIN_MS;
    const drained = await drainProviderJobs(
      () => runWorkerOnce(run, owner, { ...deps, now: new Date(clock()), deadlineAt, clock, onlyConnectionId: connection.id, onlyJobIds: queued.ids }),
      { limit: request.maxJobs, deadlineAt, now: clock },
    );

    const summary = await run(async (db) => {
      const states = await db.query<{ state: string; n: number }>("select state, count(*)::int as n from analytics_jobs where id = any($1::uuid[]) group by 1", [queued.ids]);
      const status = (await db.query<{ status: string }>("select status from analytics_connections where id = $1", [connection.id])).rows[0]!.status;
      const reports = await db.query<{ template_key: string; start_date: string; end_date: string; completeness: string; rows: number }>(
        `select p.template_key, p.start_date::text, p.end_date::text, p.completeness,
                (select count(*)::int from analytics_report_rows r where r.partition_id = p.id) as rows
         from analytics_report_partitions p
         where p.connection_id = $1 and p.published and p.fetched_at >= $2::timestamptz - interval '1 minute'
           and p.template_key = any($3::text[]) order by p.template_key, p.start_date`,
        [connection.id, started.toISOString(), chosen.map((job) => job.templateKey)],
      );
      return { states: Object.fromEntries(states.rows.map((row) => [row.state, row.n])), status, reports: reports.rows };
    });

    result = {
      mode: "run", connection: request.connection, provider: connection.provider, window, plannedTotal: planned.length,
      queuedNow: queued.created, alreadyQueuedOrDone: queued.ids.length - queued.created,
      jobs: drained.jobs, succeeded: drained.succeeded, failed: drained.failed, retryScheduled: drained.retryScheduled,
      reconnectRequired: drained.reconnectRequired, credentialOrConfigWaiting: drained.notConfigured, stale: drained.stale,
      stopped: drained.stopped, jobStates: summary.states,
      rowsStored: summary.reports.reduce((sum, report) => sum + report.rows, 0),
      reports: summary.reports.map((report) => ({ template: report.template_key, start: report.start_date, end: report.end_date, completeness: report.completeness, rows: report.rows })),
      connectionStatusChanged: summary.status !== connection.status,
      durationMs: clock() - startedMs,
    };
    const clean = result.failed === 0 && result.reconnectRequired === 0 && result.credentialOrConfigWaiting === 0 && result.retryScheduled === 0 && result.stale === 0;
    await audit(run, {
      action: "analytics.pilot.run",
      outcome: clean ? "success" : "failure",
      connection,
      metadata: {
        connection: request.connection, provider: connection.provider, window, planned: planned.length, queuedNow: queued.created, jobs: result.jobs,
        succeeded: result.succeeded, failed: result.failed, retryScheduled: result.retryScheduled, reconnectRequired: result.reconnectRequired,
        credentialOrConfigWaiting: result.credentialOrConfigWaiting, stopped: result.stopped, requeueWaiting: request.requeueWaiting, connectionStatusChanged: result.connectionStatusChanged,
      },
    });
    return result;
  } catch (error) {
    await audit(run, { action: "analytics.pilot.run", outcome: "failure", connection, metadata: { connection: request.connection, provider: connection.provider, stopped: "error" } }).catch(() => undefined);
    throw error;
  } finally {
    if (record && invocationId) {
      const remaining = await run((db) => remainingWork(db, new Date(clock()), connection.id)).catch(() => ({ due: 0, waiting: 0, leased: 0, dueByProvider: {} }));
      const report: InvocationReport = {
        invocationId, stopped: result?.stopped === "overlap" ? "empty" : (result?.stopped ?? "empty"), enqueued: result?.queuedNow ?? 0, jobs: result?.jobs ?? 0, succeeded: result?.succeeded ?? 0,
        failed: result?.failed ?? 0, retryScheduled: result?.retryScheduled ?? 0, reconnectRequired: result?.reconnectRequired ?? 0,
        notConfigured: result?.credentialOrConfigWaiting ?? 0, stale: result?.stale ?? 0, remaining, durationMs: clock() - startedMs,
      };
      await run((db) => closeInvocation(db, invocationId!, report, new Date(clock()), false, result ? null : "worker_error")).catch(() => undefined);
    }
  }
}
