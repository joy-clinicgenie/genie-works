import { randomUUID } from "node:crypto";
import { REPORT_METRICS, type ReportMetricKey } from "@clinic-genie/contracts";
import type { Queryable } from "../client";
import { recordAudit } from "./audit";
import { daysBetween, isValidDate } from "./dates";
import { recordTimeline } from "./timeline";

export interface SnapshotRow {
  id: string;
  client_id: string;
  client_name: string;
  source: string;
  channel: string;
  metric: ReportMetricKey;
  dimension: string;
  period_start: string;
  period_end: string;
  value: number | null;
  unit: string;
  note: string | null;
  entered_by: string;
  entered_by_name: string;
  created_at: Date;
  supersedes_id: string | null;
  superseded_by_id: string | null;
}

export interface ReportNoteRow {
  id: string;
  client_id: string;
  period_start: string;
  period_end: string;
  observation: string;
  possible_explanations: string | null;
  author_user_id: string;
  author_name: string;
  created_at: Date;
}

export class ReportRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportRuleError";
  }
}

const SELECT = `select s.*, c.name as client_name, u.display_name as entered_by_name from report_snapshots s join clients c on c.id = s.client_id join staff_users u on u.id = s.entered_by`;

export async function listSnapshots(db: Queryable, f: { clientId?: string; source?: string; channel?: string; includeSuperseded?: boolean; limit?: number } = {}): Promise<SnapshotRow[]> {
  const { rows } = await db.query<SnapshotRow>(
    `${SELECT} where ($1::uuid is null or s.client_id = $1) and ($2::text is null or s.source = $2) and ($3::text is null or s.channel = $3)
       and ($4 or s.superseded_by_id is null)
     order by s.period_start desc, s.period_end desc, s.source, s.channel, s.metric limit $5`,
    [f.clientId ?? null, f.source ?? null, f.channel ?? null, f.includeSuperseded ?? false, f.limit ?? 1000],
  );
  return rows;
}

export interface Period {
  start: string;
  end: string;
}

export async function listPeriods(db: Queryable, clientId: string, source?: string, channel?: string): Promise<Period[]> {
  const { rows } = await db.query<{ period_start: string; period_end: string }>(
    `select distinct period_start, period_end from report_snapshots where client_id = $1 and superseded_by_id is null
       and ($2::text is null or source = $2) and ($3::text is null or channel = $3) order by period_start desc, period_end desc`,
    [clientId, source ?? null, channel ?? null],
  );
  return rows.map((r) => ({ start: r.period_start, end: r.period_end }));
}

export interface SnapshotInput {
  source: string;
  channel: string;
  metric: ReportMetricKey;
  periodStart: string;
  periodEnd: string;
  /** null = unavailable. Never substitute zero for missing data. */
  value: number | null;
  note: string | null;
}

/** Adds an immutable snapshot. If the same key already exists, the old row is superseded and linked, never edited. */
export async function addSnapshot(db: Queryable, clientId: string, input: SnapshotInput, actorUserId: string): Promise<string> {
  if (!isValidDate(input.periodStart) || !isValidDate(input.periodEnd)) throw new ReportRuleError("Period dates must be valid.");
  if (input.periodEnd < input.periodStart) throw new ReportRuleError("The period must end on or after it starts.");
  if (input.value !== null && (!Number.isFinite(input.value) || input.value < 0)) throw new ReportRuleError("Value must be a non-negative number, or left blank when unavailable.");
  const metric = REPORT_METRICS.find((m) => m.key === input.metric);
  if (!metric) throw new ReportRuleError("Unknown metric.");
  const existing = await db.query<{ id: string }>(
    "select id from report_snapshots where client_id = $1 and source = $2 and channel = $3 and metric = $4 and dimension = '' and period_start = $5 and period_end = $6 and superseded_by_id is null",
    [clientId, input.source, input.channel, input.metric, input.periodStart, input.periodEnd],
  );
  const prior = existing.rows[0]?.id ?? null;
  const id = randomUUID();
  // Point the old row at the new one first so the partial unique index never sees two current rows.
  if (prior) await db.query("update report_snapshots set superseded_by_id = $2 where id = $1 and superseded_by_id is null", [prior, id]);
  await db.query(
    `insert into report_snapshots (id, client_id, source, channel, metric, period_start, period_end, value, unit, note, entered_by, supersedes_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, clientId, input.source, input.channel, input.metric, input.periodStart, input.periodEnd, input.value, metric.unit, input.note, actorUserId, prior],
  );
  await recordAudit(db, { actorType: "staff", actorUserId, action: prior ? "report_snapshot.supersede" : "report_snapshot.add", targetType: "report_snapshot", targetId: id, clientId, outcome: "success", metadata: { metric: input.metric, source: input.source, channel: input.channel, supersedes: prior, unavailable: input.value === null } });
  await recordTimeline(db, { clientId, eventType: "report_snapshot_added", title: `${metric.label} recorded for ${input.periodStart} to ${input.periodEnd} (${input.channel.replace(/_/g, " ")}, ${input.source.replace(/_/g, " ")})`, summary: input.value === null ? "Value unavailable" : prior ? "Corrected snapshot; earlier value preserved" : null, relatedType: "report_snapshot", relatedId: id, actorUserId, dedupeKey: `report_snapshot_added:${id}` });
  return id;
}

export interface MetricComparison {
  metric: ReportMetricKey;
  label: string;
  unit: string;
  current: number | null;
  previous: number | null;
  currentAvailable: boolean;
  previousAvailable: boolean;
  absoluteChange: number | null;
  percentChange: number | null;
  /** Why a movement is not shown, in plain words. */
  status: "ok" | "current_unavailable" | "previous_unavailable" | "both_unavailable" | "zero_baseline" | "not_recorded";
}

export interface PeriodComparison {
  current: Period;
  previous: Period;
  likeForLike: boolean;
  lengthNote: string | null;
  metrics: MetricComparison[];
}

/**
 * Compares two periods for one source and channel. Movement is shown only when both values exist;
 * a zero baseline yields no percentage. Different-length periods are flagged as not like-for-like.
 */
export async function comparePeriods(db: Queryable, clientId: string, args: { source: string; channel: string; current: Period; previous: Period }): Promise<PeriodComparison> {
  const { rows } = await db.query<{ metric: ReportMetricKey; period_start: string; period_end: string; value: number | null }>(
    `select metric, period_start, period_end, value from report_snapshots
     where client_id = $1 and source = $2 and channel = $3 and dimension = '' and superseded_by_id is null
       and ((period_start = $4 and period_end = $5) or (period_start = $6 and period_end = $7))`,
    [clientId, args.source, args.channel, args.current.start, args.current.end, args.previous.start, args.previous.end],
  );
  const curLen = daysBetween(args.current.start, args.current.end) + 1;
  const prevLen = daysBetween(args.previous.start, args.previous.end) + 1;
  const likeForLike = curLen === prevLen;
  const metrics: MetricComparison[] = REPORT_METRICS.map((m) => {
    const cur = rows.find((r) => r.metric === m.key && r.period_start === args.current.start && r.period_end === args.current.end);
    const prev = rows.find((r) => r.metric === m.key && r.period_start === args.previous.start && r.period_end === args.previous.end);
    return compareValues(m.key, m.label, m.unit, cur ? { value: cur.value } : undefined, prev ? { value: prev.value } : undefined);
  });
  return {
    current: args.current,
    previous: args.previous,
    likeForLike,
    lengthNote: likeForLike ? null : `Periods differ in length (${curLen} days against ${prevLen} days), so movements are not like-for-like.`,
    metrics,
  };
}

export function compareValues(metric: ReportMetricKey, label: string, unit: string, cur?: { value: number | null }, prev?: { value: number | null }): MetricComparison {
  const current = cur ? cur.value : null;
  const previous = prev ? prev.value : null;
  const currentAvailable = cur !== undefined && cur.value !== null;
  const previousAvailable = prev !== undefined && prev.value !== null;
  let status: MetricComparison["status"] = "ok";
  let absoluteChange: number | null = null;
  let percentChange: number | null = null;
  if (cur === undefined && prev === undefined) status = "not_recorded";
  else if (!currentAvailable && !previousAvailable) status = "both_unavailable";
  else if (!currentAvailable) status = "current_unavailable";
  else if (!previousAvailable) status = "previous_unavailable";
  else {
    absoluteChange = Number((current! - previous!).toFixed(2));
    if (previous === 0) {
      status = "zero_baseline";
    } else {
      percentChange = Number((((current! - previous!) / previous!) * 100).toFixed(1));
    }
  }
  return { metric, label, unit, current, previous, currentAvailable, previousAvailable, absoluteChange, percentChange, status };
}

export async function listReportNotes(db: Queryable, f: { clientId?: string; limit?: number } = {}): Promise<ReportNoteRow[]> {
  const { rows } = await db.query<ReportNoteRow>(
    "select n.*, u.display_name as author_name from report_notes n join staff_users u on u.id = n.author_user_id where ($1::uuid is null or n.client_id = $1) order by n.period_start desc, n.created_at desc limit $2",
    [f.clientId ?? null, f.limit ?? 200],
  );
  return rows;
}

/** Observations are what the numbers show. Possible explanations are kept separate and never stated as causes. */
export async function addReportNote(db: Queryable, clientId: string, input: { periodStart: string; periodEnd: string; observation: string; possibleExplanations: string | null }, actorUserId: string): Promise<string> {
  if (!isValidDate(input.periodStart) || !isValidDate(input.periodEnd) || input.periodEnd < input.periodStart) throw new ReportRuleError("Enter a valid period.");
  if (!input.observation.trim()) throw new ReportRuleError("Record the observation.");
  const { rows } = await db.query<{ id: string }>("insert into report_notes (client_id, period_start, period_end, observation, possible_explanations, author_user_id) values ($1, $2, $3, $4, $5, $6) returning id", [clientId, input.periodStart, input.periodEnd, input.observation.trim(), input.possibleExplanations?.trim() || null, actorUserId]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "report_note.add", targetType: "report_note", targetId: rows[0]!.id, clientId, outcome: "success" });
  await recordTimeline(db, { clientId, eventType: "report_observation_added", title: `Observation recorded for ${input.periodStart} to ${input.periodEnd}`, summary: input.observation.trim().slice(0, 300), relatedType: null, relatedId: null, actorUserId, dedupeKey: `report_note:${rows[0]!.id}` });
  return rows[0]!.id;
}
