import type { IssueStatus } from "@clinic-genie/contracts";
import type { Queryable } from "../client";
import { recordAudit } from "./audit";
import { relatedPair, resolveRelated } from "./related";
import { recordTimeline } from "./timeline";

export interface IssueRow {
  id: string;
  client_id: string;
  client_name: string;
  title: string;
  description: string | null;
  severity: string;
  status: IssueStatus;
  owner_user_id: string;
  owner_name: string;
  opened_by: string;
  opened_by_name: string;
  opened_at: Date;
  related_type: string | null;
  related_id: string | null;
  resolution_note: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: Date | null;
  verification_result: string | null;
  reopen_count: number;
  created_at: Date;
  updated_at: Date;
  evidence_count: number;
}

export interface EvidenceRow {
  id: string;
  client_id: string;
  issue_id: string | null;
  related_type: string | null;
  related_id: string | null;
  kind: "upload" | "link";
  label: string;
  url: string | null;
  storage_key: string | null;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  uploaded_by: string;
  uploaded_by_name: string;
  created_at: Date;
}

export class IssueRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueRuleError";
  }
}

const SELECT = `
  select i.*, c.name as client_name, o.display_name as owner_name, ob.display_name as opened_by_name,
         rb.display_name as resolved_by_name, vb.display_name as verified_by_name,
         (select count(*)::int from evidence_items e where e.issue_id = i.id and e.deleted_at is null) as evidence_count
  from issues i join clients c on c.id = i.client_id join staff_users o on o.id = i.owner_user_id join staff_users ob on ob.id = i.opened_by
  left join staff_users rb on rb.id = i.resolved_by left join staff_users vb on vb.id = i.verified_by`;

export async function listIssues(db: Queryable, f: { clientId?: string; statuses?: IssueStatus[]; severity?: string; limit?: number } = {}): Promise<IssueRow[]> {
  const { rows } = await db.query<IssueRow>(
    `${SELECT} where ($1::uuid is null or i.client_id = $1) and ($2::text[] is null or i.status = any($2)) and ($3::text is null or i.severity = $3)
     order by case i.status when 'verified_closed' then 1 else 0 end, case i.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, i.opened_at desc limit $4`,
    [f.clientId ?? null, f.statuses?.length ? f.statuses : null, f.severity ?? null, f.limit ?? 300],
  );
  return rows;
}

export async function getIssue(db: Queryable, id: string) {
  const { rows } = await db.query<IssueRow>(`${SELECT} where i.id = $1`, [id]);
  const issue = rows[0];
  if (!issue) return null;
  const history = await db.query("select h.*, u.display_name as actor_name from issue_history h join staff_users u on u.id = h.actor_user_id where h.issue_id = $1 order by h.created_at", [id]);
  const evidence = await listEvidence(db, { issueId: id });
  return { ...issue, history: history.rows, evidence };
}

export interface IssueInput {
  title: string;
  description: string | null;
  severity: string;
  ownerUserId: string;
  relatedType: string | null;
  relatedId: string | null;
}

export async function openIssue(db: Queryable, clientId: string, input: IssueInput, actorUserId: string): Promise<string> {
  if (!input.title.trim()) throw new IssueRuleError("Title is required.");
  const related = relatedPair(input.relatedType, input.relatedId);
  if (related.type && related.id) {
    const found = await resolveRelated(db, clientId, related.type, related.id);
    if (!found) throw new IssueRuleError("The related record does not belong to this client.");
  }
  const { rows } = await db.query<{ id: string }>(
    "insert into issues (client_id, title, description, severity, owner_user_id, opened_by, related_type, related_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
    [clientId, input.title.trim(), input.description, input.severity, input.ownerUserId, actorUserId, related.type, related.id],
  );
  const id = rows[0]!.id;
  await db.query("insert into issue_history (issue_id, client_id, from_status, to_status, actor_user_id, note) values ($1, $2, null, 'open', $3, 'Issue opened')", [id, clientId, actorUserId]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "issue.open", targetType: "issue", targetId: id, clientId, outcome: "success", metadata: { severity: input.severity } });
  await recordTimeline(db, { clientId, eventType: "issue_opened", title: `Issue opened: ${input.title.trim()}`, relatedType: "issue", relatedId: id, actorUserId, dedupeKey: `issue_opened:${id}` });
  return id;
}

export async function updateIssueDetails(db: Queryable, id: string, input: IssueInput, actorUserId: string): Promise<void> {
  const { rows } = await db.query<{ client_id: string; status: IssueStatus }>("select client_id, status from issues where id = $1", [id]);
  const cur = rows[0];
  if (!cur) throw new IssueRuleError("Issue not found.");
  if (cur.status === "verified_closed") throw new IssueRuleError("Verified closed issues cannot be edited. Reopen first.");
  if (!input.title.trim()) throw new IssueRuleError("Title is required.");
  const related = relatedPair(input.relatedType, input.relatedId);
  if (related.type && related.id) {
    const found = await resolveRelated(db, cur.client_id, related.type, related.id);
    if (!found) throw new IssueRuleError("The related record does not belong to this client.");
  }
  await db.query("update issues set title = $2, description = $3, severity = $4, owner_user_id = $5, related_type = $6, related_id = $7, updated_at = now() where id = $1", [id, input.title.trim(), input.description, input.severity, input.ownerUserId, related.type, related.id]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "issue.update", targetType: "issue", targetId: id, clientId: cur.client_id, outcome: "success" });
}

const TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  open: ["investigating", "resolved_pending_verification"],
  investigating: ["open", "resolved_pending_verification"],
  resolved_pending_verification: ["verified_closed", "reopened"],
  verified_closed: ["reopened"],
  reopened: ["investigating", "resolved_pending_verification"],
};

export interface IssueTransition {
  status: IssueStatus;
  note: string | null;
  /** Required when moving to verified_closed (passed) or from pending verification to reopened (failed). */
  verificationResult?: "passed" | "failed" | null;
}

/** Workflow: open → investigating → resolved pending verification → verified closed, with reopening. Verifier, date and result are recorded. */
export async function transitionIssue(db: Queryable, id: string, input: IssueTransition, actorUserId: string): Promise<void> {
  const { rows } = await db.query<{ status: IssueStatus; client_id: string; title: string; resolved_by: string | null }>("select status, client_id, title, resolved_by from issues where id = $1 for update", [id]);
  const cur = rows[0];
  if (!cur) throw new IssueRuleError("Issue not found.");
  if (!TRANSITIONS[cur.status].includes(input.status)) throw new IssueRuleError(`Cannot move a ${cur.status.replace(/_/g, " ")} issue to ${input.status.replace(/_/g, " ")}.`);
  const note = input.note?.trim() || null;
  let verificationResult: "passed" | "failed" | null = null;
  if (input.status === "resolved_pending_verification") {
    if (!note) throw new IssueRuleError("Describe the resolution before marking the issue resolved.");
    await db.query("update issues set status = $2, resolution_note = $3, resolved_at = now(), resolved_by = $4, verified_by = null, verified_at = null, verification_result = null, updated_at = now() where id = $1", [id, input.status, note, actorUserId]);
  } else if (input.status === "verified_closed") {
    if (input.verificationResult !== "passed") throw new IssueRuleError("Verified closure needs a passed verification result.");
    if (!note) throw new IssueRuleError("Record what was checked and the result.");
    verificationResult = "passed";
    await db.query("update issues set status = $2, verified_by = $3, verified_at = now(), verification_result = 'passed', updated_at = now() where id = $1", [id, input.status, actorUserId]);
  } else if (input.status === "reopened") {
    if (!note) throw new IssueRuleError("Say why the issue is being reopened.");
    if (cur.status === "resolved_pending_verification") {
      if (input.verificationResult !== "failed") throw new IssueRuleError("Reopening from pending verification records a failed verification.");
      verificationResult = "failed";
      await db.query("update issues set status = $2, verified_by = $3, verified_at = now(), verification_result = 'failed', reopen_count = reopen_count + 1, updated_at = now() where id = $1", [id, input.status, actorUserId]);
    } else {
      await db.query("update issues set status = $2, reopen_count = reopen_count + 1, updated_at = now() where id = $1", [id, input.status]);
    }
  } else {
    await db.query("update issues set status = $2, updated_at = now() where id = $1", [id, input.status]);
  }
  await db.query("insert into issue_history (issue_id, client_id, from_status, to_status, actor_user_id, note, verification_result) values ($1, $2, $3, $4, $5, $6, $7)", [id, cur.client_id, cur.status, input.status, actorUserId, note, verificationResult]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "issue.transition", targetType: "issue", targetId: id, clientId: cur.client_id, outcome: "success", metadata: { from: cur.status, to: input.status, verificationResult } });
  const eventType = input.status === "resolved_pending_verification" ? "issue_resolved" : input.status === "verified_closed" ? "issue_verified" : input.status === "reopened" ? "issue_reopened" : null;
  if (eventType) {
    const titles = { issue_resolved: "Issue resolved, awaiting verification", issue_verified: "Issue verified and closed", issue_reopened: "Issue reopened" } as const;
    await recordTimeline(db, { clientId: cur.client_id, eventType, title: `${titles[eventType]}: ${cur.title}`, summary: note, relatedType: "issue", relatedId: id, actorUserId, dedupeKey: `${eventType}:${id}:${new Date().toISOString().slice(0, 16)}` });
  }
}

// --- Evidence ---------------------------------------------------------------

export async function listEvidence(db: Queryable, f: { clientId?: string; issueId?: string; limit?: number } = {}): Promise<EvidenceRow[]> {
  const { rows } = await db.query<EvidenceRow>(
    `select e.*, u.display_name as uploaded_by_name from evidence_items e join staff_users u on u.id = e.uploaded_by
     where e.deleted_at is null and ($1::uuid is null or e.client_id = $1) and ($2::uuid is null or e.issue_id = $2) order by e.created_at desc limit $3`,
    [f.clientId ?? null, f.issueId ?? null, f.limit ?? 200],
  );
  return rows;
}

export async function getEvidence(db: Queryable, id: string): Promise<EvidenceRow | null> {
  const { rows } = await db.query<EvidenceRow>("select e.*, u.display_name as uploaded_by_name from evidence_items e join staff_users u on u.id = e.uploaded_by where e.id = $1 and e.deleted_at is null", [id]);
  return rows[0] ?? null;
}

export async function addEvidenceLink(db: Queryable, clientId: string, input: { issueId: string | null; label: string; url: string }, actorUserId: string): Promise<string> {
  if (!input.label.trim()) throw new IssueRuleError("Give the evidence a label.");
  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    throw new IssueRuleError("Enter a full https:// link.");
  }
  if (parsed.protocol !== "https:") throw new IssueRuleError("Evidence links must use https.");
  const { rows } = await db.query<{ id: string }>("insert into evidence_items (client_id, issue_id, kind, label, url, uploaded_by) values ($1, $2, 'link', $3, $4, $5) returning id", [clientId, input.issueId, input.label.trim(), parsed.toString(), actorUserId]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "evidence.add_link", targetType: "evidence", targetId: rows[0]!.id, clientId, outcome: "success", metadata: { host: parsed.host, issueId: input.issueId } });
  return rows[0]!.id;
}

export interface UploadMeta {
  issueId: string | null;
  label: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/** Records an upload that the storage adapter has already written privately. */
export async function addEvidenceUpload(db: Queryable, clientId: string, input: UploadMeta, actorUserId: string): Promise<string> {
  if (!input.label.trim()) throw new IssueRuleError("Give the evidence a label.");
  const { rows } = await db.query<{ id: string }>(
    "insert into evidence_items (client_id, issue_id, kind, label, storage_key, original_name, mime_type, size_bytes, sha256, uploaded_by) values ($1, $2, 'upload', $3, $4, $5, $6, $7, $8, $9) returning id",
    [clientId, input.issueId, input.label.trim(), input.storageKey, input.originalName, input.mimeType, input.sizeBytes, input.sha256, actorUserId],
  );
  await recordAudit(db, { actorType: "staff", actorUserId, action: "evidence.upload", targetType: "evidence", targetId: rows[0]!.id, clientId, outcome: "success", metadata: { mimeType: input.mimeType, sizeBytes: input.sizeBytes, issueId: input.issueId } });
  return rows[0]!.id;
}

export async function removeEvidence(db: Queryable, id: string, actorUserId: string): Promise<void> {
  const { rows } = await db.query<{ client_id: string }>("update evidence_items set deleted_at = now() where id = $1 and deleted_at is null returning client_id", [id]);
  if (rows[0]) await recordAudit(db, { actorType: "staff", actorUserId, action: "evidence.remove", targetType: "evidence", targetId: id, clientId: rows[0].client_id, outcome: "success" });
}
