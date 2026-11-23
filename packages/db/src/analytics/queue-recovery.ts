import { createHash } from "node:crypto";
import type { Queryable } from "../client";
import { dueJobs, reapExpiredLeases, windowLength } from "./sync";
import { planDueJobs } from "./scheduling";
import type { AnalyticsProvider } from "./measure";

/**
 * Analytics Phase 2.2: safe recovery of a queue left behind by the pre-2.1 plan.
 *
 * `queueRecoveryReport` only reads. `applyQueueRecovery` changes state, and only when the caller
 * presents the approval token for exactly the set the report listed. It never deletes a row and
 * never touches a published report, a failed job (its history stays for diagnosis), a leased job,
 * or a job the version 2 planner created (those retire themselves). A cancelled job keeps its row
 * with `safe_error_code = 'superseded_recovery'`.
 */

export class QueueRecoveryApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueRecoveryApprovalError";
  }
}

export interface QueueRecoveryReport {
  generatedAt: string;
  jobsByState: Record<string, number>;
  oldestQueuedAt: string | null;
  queuedLegacy: number;
  queuedPlanned: number;
  /** Leased jobs whose lease has run out. The worker's reaper requeues them, or fails them on the last attempt. */
  expiredLeases: number;
  /** Connections holding more than one leased job. Migration 0053's unique index cannot build until this is 0. */
  connectionsWithSeveralLeases: number;
  /** Failed and reconnect-required jobs by code. Listed, never changed. */
  failedByCode: Record<string, number>;
  obsolete: {
    eligible: number;
    byTemplate: Record<string, number>;
    /** Queued legacy jobs with no newer sibling, or of a length the plan never uses. Left alone. */
    needsReview: number;
    digest: string;
  };
  coolingConnections: number;
  /** What `applyQueueRecovery` must be given. It changes whenever the eligible set or the expired leases change. */
  approvalToken: string;
}

interface Candidate {
  id: string;
  template_key: string;
  provider: AnalyticsProvider;
  provider_timezone: string | null;
  start_date: string;
  end_date: string;
  length: number;
}

/** A queued job younger than this may still be on its way to a worker; it is never treated as obsolete. */
export const RECOVERY_MIN_AGE_HOURS = 36;

/**
 * A queued, unleased, class-less (version 1) job is obsolete when all of these hold:
 *   - it is at least 36 hours old;
 *   - it is not one of the windows today's plan asks for (so a previous-period window is kept);
 *   - it ends before today's plan does, so its dates have been replaced by later days;
 *   - its length is one the plans have used (7, 30, 90 days and so on), so a hand-picked range is left alone.
 * Everything else stays queued and is reported as needing review.
 */
async function legacyQueued(db: Queryable, now: Date): Promise<{ eligible: Candidate[]; legacy: number }> {
  const { rows } = await db.query<Candidate>(
    `select j.id, j.template_key, c.provider, c.provider_timezone, j.start_date::text, j.end_date::text,
       (j.end_date - j.start_date + 1)::int as length
     from analytics_jobs j join analytics_connections c on c.id = j.connection_id
     where j.state = 'queued' and j.window_class is null and j.lease_owner is null`,
  );
  const aged = await db.query<{ id: string }>(
    `select id from analytics_jobs
     where state = 'queued' and window_class is null and lease_owner is null
       and created_at < $1::timestamptz - ($2 * interval '1 hour')`,
    [now.toISOString(), RECOVERY_MIN_AGE_HOURS],
  );
  const old = new Set(aged.rows.map((row) => row.id));
  const lengths = new Set<string>();
  const probe = new Date();
  for (const provider of ["ga4", "gsc", "wix"] as const) {
    for (const job of [...dueJobs(provider, probe, null), ...planDueJobs(provider, probe, null)]) {
      lengths.add(`${provider}|${job.templateKey}|${windowLength(job.start, job.end)}`);
    }
  }
  const current = new Map<string, { windows: Set<string>; latestEnd: Map<string, string> }>();
  const planFor = (provider: AnalyticsProvider, timezone: string | null) => {
    const key = `${provider}|${timezone ?? ""}`;
    let plan = current.get(key);
    if (!plan) {
      plan = { windows: new Set(), latestEnd: new Map() };
      for (const job of dueJobs(provider, now, timezone)) {
        plan.windows.add(`${job.templateKey}|${job.start}|${job.end}`);
        const latest = plan.latestEnd.get(job.templateKey);
        if (!latest || job.end > latest) plan.latestEnd.set(job.templateKey, job.end);
      }
      current.set(key, plan);
    }
    return plan;
  };
  const eligible = rows.filter((row) => {
    if (!old.has(row.id) || !lengths.has(`${row.provider}|${row.template_key}|${row.length}`)) return false;
    const plan = planFor(row.provider, row.provider_timezone);
    if (plan.windows.has(`${row.template_key}|${row.start_date}|${row.end_date}`)) return false;
    const latest = plan.latestEnd.get(row.template_key);
    return latest !== undefined && row.end_date < latest;
  });
  return { eligible, legacy: rows.length };
}

function digest(ids: string[]): string {
  return createHash("sha256").update([...ids].sort().join(",")).digest("hex").slice(0, 12);
}

/** Read-only. Safe to run against any database the caller is allowed to read. */
export async function queueRecoveryReport(db: Queryable, now: Date): Promise<QueueRecoveryReport> {
  const states = await db.query<{ state: string; n: string }>("select state, count(*)::text as n from analytics_jobs group by state");
  const jobsByState = Object.fromEntries(states.rows.map((row) => [row.state, Number(row.n)]));
  const oldest = await db.query<{ at: Date | null; planned: string; expired: string }>(
    `select min(created_at) filter (where state = 'queued') as at,
       count(*) filter (where state = 'queued' and window_class is not null)::text as planned,
       count(*) filter (where state = 'leased' and lease_until < $1)::text as expired
     from analytics_jobs`,
    [now.toISOString()],
  );
  const several = await db.query<{ n: string }>(
    "select count(*)::text as n from (select connection_id from analytics_jobs where state = 'leased' group by 1 having count(*) > 1) s",
  );
  const failed = await db.query<{ code: string | null; n: string }>(
    "select coalesce(safe_error_code, 'none') as code, count(*)::text as n from analytics_jobs where state in ('failed', 'reconnect_required') group by 1",
  );
  const cooling = await db.query<{ n: string }>(
    "select count(*)::text as n from analytics_connections where cooldown_until is not null and cooldown_until > $1",
    [now.toISOString()],
  );
  const { eligible, legacy } = await legacyQueued(db, now);
  const byTemplate: Record<string, number> = {};
  for (const row of eligible) byTemplate[row.template_key] = (byTemplate[row.template_key] ?? 0) + 1;
  const expiredLeases = Number(oldest.rows[0]!.expired);
  const setDigest = digest(eligible.map((row) => row.id));
  return {
    generatedAt: now.toISOString(),
    jobsByState,
    oldestQueuedAt: oldest.rows[0]!.at ? new Date(oldest.rows[0]!.at).toISOString() : null,
    queuedLegacy: legacy,
    queuedPlanned: Number(oldest.rows[0]!.planned),
    expiredLeases,
    connectionsWithSeveralLeases: Number(several.rows[0]!.n),
    failedByCode: Object.fromEntries(failed.rows.map((row) => [row.code ?? "none", Number(row.n)])),
    obsolete: { eligible: eligible.length, byTemplate, needsReview: legacy - eligible.length, digest: setDigest },
    coolingConnections: Number(cooling.rows[0]!.n),
    approvalToken: `recover:${eligible.length}:${expiredLeases}:${setDigest}`,
  };
}

/**
 * Cancels the obsolete queued jobs the report listed and requeues expired leases (what the worker
 * does on its next run anyway). The token must match a fresh report, so approving a count that was
 * reviewed earlier cannot cancel anything that was not in it.
 */
export async function applyQueueRecovery(db: Queryable, now: Date, approvalToken: string): Promise<{ cancelled: number; leasesRecovered: number }> {
  const report = await queueRecoveryReport(db, now);
  if (!approvalToken || approvalToken !== report.approvalToken) {
    throw new QueueRecoveryApprovalError("The approval does not match the current queue. Run the dry run again and approve what it lists.");
  }
  const { eligible } = await legacyQueued(db, now);
  let cancelled = 0;
  if (eligible.length > 0) {
    const result = await db.query(
      `update analytics_jobs
       set state = 'cancelled', safe_error_code = 'superseded_recovery', lease_owner = null, lease_until = null,
           heartbeat_at = null, updated_at = $2
       where id = any($1::uuid[]) and state = 'queued' and lease_owner is null`,
      [eligible.map((row) => row.id), now.toISOString()],
    );
    cancelled = result.rowCount ?? 0;
  }
  const leasesRecovered = await reapExpiredLeases(db, now);
  return { cancelled, leasesRecovered };
}
