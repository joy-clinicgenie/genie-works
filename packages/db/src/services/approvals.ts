import type { ApprovalStatus } from "@clinic-genie/contracts";
import type { Queryable } from "../client";
import { recordAudit } from "./audit";
import { relatedPair, resolveRelated } from "./related";
import { recordTimeline } from "./timeline";

export interface ApprovalRow {
  id: string;
  client_id: string;
  client_name: string;
  title: string;
  summary: string | null;
  request_type: string;
  related_type: string | null;
  related_id: string | null;
  status: ApprovalStatus;
  requested_by: string;
  requester_name: string;
  submitted_at: Date | null;
  withdrawn_at: Date | null;
  current_decision_id: string | null;
  current_outcome: string | null;
  current_decided_by_name: string | null;
  current_decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DecisionRow {
  id: string;
  approval_id: string;
  outcome: "approved" | "changes_requested";
  note: string | null;
  decided_by: string;
  decider_name: string;
  decided_at: Date;
  supersedes_decision_id: string | null;
  superseded_at: Date | null;
}

export class ApprovalRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalRuleError";
  }
}

const SELECT = `
  select a.*, c.name as client_name, r.display_name as requester_name,
         d.outcome as current_outcome, du.display_name as current_decided_by_name, d.decided_at as current_decided_at
  from approvals a join clients c on c.id = a.client_id join staff_users r on r.id = a.requested_by
  left join approval_decisions d on d.id = a.current_decision_id left join staff_users du on du.id = d.decided_by`;

export async function listApprovals(db: Queryable, f: { clientId?: string; statuses?: ApprovalStatus[]; limit?: number } = {}): Promise<ApprovalRow[]> {
  const { rows } = await db.query<ApprovalRow>(
    `${SELECT} where ($1::uuid is null or a.client_id = $1) and ($2::text[] is null or a.status = any($2))
     order by case a.status when 'submitted' then 0 when 'changes_requested' then 1 when 'draft' then 2 else 3 end, a.updated_at desc limit $3`,
    [f.clientId ?? null, f.statuses?.length ? f.statuses : null, f.limit ?? 300],
  );
  return rows;
}

export async function getApproval(db: Queryable, id: string): Promise<(ApprovalRow & { decisions: DecisionRow[] }) | null> {
  const { rows } = await db.query<ApprovalRow>(`${SELECT} where a.id = $1`, [id]);
  const approval = rows[0];
  if (!approval) return null;
  const decisions = await db.query<DecisionRow>(
    "select d.*, u.display_name as decider_name from approval_decisions d join staff_users u on u.id = d.decided_by where d.approval_id = $1 order by d.decided_at",
    [id],
  );
  return { ...approval, decisions: decisions.rows };
}

export interface ApprovalInput {
  clientId: string;
  title: string;
  summary: string | null;
  requestType: string;
  relatedType: string | null;
  relatedId: string | null;
}

export async function createApproval(db: Queryable, input: ApprovalInput, actorUserId: string, submit: boolean): Promise<string> {
  if (!input.title.trim()) throw new ApprovalRuleError("Title is required.");
  const related = relatedPair(input.relatedType, input.relatedId);
  if (related.type && related.id) {
    const found = await resolveRelated(db, input.clientId, related.type, related.id);
    if (!found) throw new ApprovalRuleError("The related record does not belong to this client.");
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into approvals (client_id, title, summary, request_type, related_type, related_id, requested_by, status, submitted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, case when $8 = 'submitted' then now() else null end) returning id`,
    [input.clientId, input.title.trim(), input.summary, input.requestType, related.type, related.id, actorUserId, submit ? "submitted" : "draft"],
  );
  const id = rows[0]!.id;
  await recordAudit(db, { actorType: "staff", actorUserId, action: submit ? "approval.submit" : "approval.draft", targetType: "approval", targetId: id, clientId: input.clientId, outcome: "success" });
  if (submit) {
    await recordTimeline(db, { clientId: input.clientId, eventType: "approval_submitted", title: `Approval requested: ${input.title.trim()}`, relatedType: "approval", relatedId: id, actorUserId, dedupeKey: `approval_submitted:${id}:1` });
  }
  return id;
}

export async function updateDraft(db: Queryable, id: string, input: Omit<ApprovalInput, "clientId">, actorUserId: string): Promise<void> {
  const current = await getApproval(db, id);
  if (!current) throw new ApprovalRuleError("Approval not found.");
  if (current.status !== "draft" && current.status !== "changes_requested") throw new ApprovalRuleError("Only drafts or requests with changes requested can be edited.");
  const related = relatedPair(input.relatedType, input.relatedId);
  if (related.type && related.id) {
    const found = await resolveRelated(db, current.client_id, related.type, related.id);
    if (!found) throw new ApprovalRuleError("The related record does not belong to this client.");
  }
  await db.query("update approvals set title = $2, summary = $3, request_type = $4, related_type = $5, related_id = $6, updated_at = now() where id = $1", [id, input.title.trim(), input.summary, input.requestType, related.type, related.id]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "approval.update", targetType: "approval", targetId: id, clientId: current.client_id, outcome: "success" });
}

export async function submitApproval(db: Queryable, id: string, actorUserId: string): Promise<void> {
  const { rows } = await db.query<{ status: ApprovalStatus; client_id: string; title: string; n: number }>(
    "select status, client_id, title, (select count(*)::int from approval_decisions d where d.approval_id = approvals.id) as n from approvals where id = $1 for update",
    [id],
  );
  const a = rows[0];
  if (!a) throw new ApprovalRuleError("Approval not found.");
  if (a.status !== "draft" && a.status !== "changes_requested") throw new ApprovalRuleError("Only drafts or requests with changes requested can be submitted.");
  await db.query("update approvals set status = 'submitted', submitted_at = now(), updated_at = now() where id = $1", [id]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "approval.submit", targetType: "approval", targetId: id, clientId: a.client_id, outcome: "success" });
  await recordTimeline(db, { clientId: a.client_id, eventType: "approval_submitted", title: `Approval ${a.n > 0 ? "resubmitted" : "requested"}: ${a.title}`, relatedType: "approval", relatedId: id, actorUserId, dedupeKey: `approval_submitted:${id}:${a.n + 1}` });
}

export async function withdrawApproval(db: Queryable, id: string, actorUserId: string): Promise<void> {
  const { rows } = await db.query<{ status: ApprovalStatus; client_id: string }>("select status, client_id from approvals where id = $1 for update", [id]);
  const a = rows[0];
  if (!a) throw new ApprovalRuleError("Approval not found.");
  if (a.status === "approved" || a.status === "withdrawn") throw new ApprovalRuleError("Approved or withdrawn requests cannot be withdrawn.");
  await db.query("update approvals set status = 'withdrawn', withdrawn_at = now(), updated_at = now() where id = $1", [id]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "approval.withdraw", targetType: "approval", targetId: id, clientId: a.client_id, outcome: "success" });
}

/**
 * Records an authorised decision. Decisions are append-only. If a current decision exists it is marked
 * superseded and linked from the new one; history is never edited.
 */
export async function decideApproval(db: Queryable, id: string, input: { outcome: "approved" | "changes_requested"; note: string | null }, actorUserId: string): Promise<string> {
  const { rows } = await db.query<{ status: ApprovalStatus; client_id: string; title: string; current_decision_id: string | null; requested_by: string }>(
    "select status, client_id, title, current_decision_id, requested_by from approvals where id = $1 for update",
    [id],
  );
  const a = rows[0];
  if (!a) throw new ApprovalRuleError("Approval not found.");
  const revising = a.status === "approved" || a.status === "changes_requested";
  if (a.status !== "submitted" && !revising) throw new ApprovalRuleError("Only submitted requests (or earlier decisions) can be decided.");
  if (a.requested_by === actorUserId) throw new ApprovalRuleError("The person who requested the approval cannot decide it.");
  if (input.outcome === "changes_requested" && !input.note?.trim()) throw new ApprovalRuleError("Say what changes are needed.");
  const { rows: ins } = await db.query<{ id: string }>(
    "insert into approval_decisions (approval_id, client_id, outcome, note, decided_by, supersedes_decision_id) values ($1, $2, $3, $4, $5, $6) returning id",
    [id, a.client_id, input.outcome, input.note?.trim() || null, actorUserId, revising ? a.current_decision_id : null],
  );
  const decisionId = ins[0]!.id;
  if (revising && a.current_decision_id) {
    await db.query("update approval_decisions set superseded_at = now() where id = $1 and superseded_at is null", [a.current_decision_id]);
  }
  await db.query("update approvals set status = $2, current_decision_id = $3, updated_at = now() where id = $1", [id, input.outcome, decisionId]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: revising ? "approval.decision_superseded" : "approval.decide", targetType: "approval", targetId: id, clientId: a.client_id, outcome: "success", metadata: { outcome: input.outcome, decisionId, supersedes: revising ? a.current_decision_id : null } });
  await recordTimeline(db, {
    clientId: a.client_id,
    eventType: revising ? "approval_superseded" : "approval_decided",
    title: `${revising ? "Decision revised" : "Decision"}: ${a.title} ${input.outcome === "approved" ? "approved" : "needs changes"}`,
    summary: input.note?.trim() || null,
    relatedType: "approval",
    relatedId: id,
    actorUserId,
    dedupeKey: `approval_decision:${decisionId}`,
  });
  return decisionId;
}
