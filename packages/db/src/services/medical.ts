import type { Queryable } from "../client";
import { recordAudit } from "./audit";
import { recordTimeline } from "./timeline";

export interface ClaimRow {
  id: string;
  client_id: string;
  client_name: string;
  claim_summary: string;
  location: string | null;
  status: string;
  current_wording_id: string | null;
  current_wording: string | null;
  current_version: number | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  withdrawn_at: Date | null;
  source_count: number;
  open_review_count: number;
}

export interface WordingRow {
  id: string;
  claim_id: string;
  version: number;
  wording: string;
  created_by: string;
  created_by_name: string;
  created_at: Date;
}

export interface ReviewRow {
  id: string;
  claim_id: string;
  wording_id: string;
  wording_version: number;
  reviewer_user_id: string;
  reviewer_name: string;
  status: "assigned" | "in_progress" | "decided" | "superseded";
  decision: string | null;
  decision_note: string | null;
  assigned_by: string;
  assigned_by_name: string;
  assigned_at: Date;
  decided_at: Date | null;
}

export interface SourceRow {
  id: string;
  claim_id: string;
  review_id: string | null;
  title: string;
  citation: string | null;
  url: string | null;
  source_type: string;
  added_by: string;
  added_by_name: string;
  created_at: Date;
}

export class MedicalRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MedicalRuleError";
  }
}

const SELECT = `
  select m.*, c.name as client_name, w.wording as current_wording, w.version as current_version,
         (select count(*)::int from medical_sources s where s.claim_id = m.id) as source_count,
         (select count(*)::int from medical_reviews r where r.claim_id = m.id and r.status in ('assigned','in_progress')) as open_review_count
  from medical_claims m join clients c on c.id = m.client_id left join claim_wordings w on w.id = m.current_wording_id`;

export async function listClaims(db: Queryable, f: { clientId?: string; status?: string; reviewerUserId?: string; limit?: number } = {}): Promise<ClaimRow[]> {
  const { rows } = await db.query<ClaimRow>(
    `${SELECT} where ($1::uuid is null or m.client_id = $1) and ($2::text is null or m.status = $2)
       and ($3::uuid is null or exists (select 1 from medical_reviews r where r.claim_id = m.id and r.reviewer_user_id = $3 and r.status in ('assigned','in_progress')))
     order by case m.status when 'under_review' then 0 when 'draft' then 1 else 2 end, m.updated_at desc limit $4`,
    [f.clientId ?? null, f.status ?? null, f.reviewerUserId ?? null, f.limit ?? 300],
  );
  return rows;
}

export async function getClaim(db: Queryable, id: string) {
  const { rows } = await db.query<ClaimRow>(`${SELECT} where m.id = $1`, [id]);
  const claim = rows[0];
  if (!claim) return null;
  const wordings = await db.query<WordingRow>("select w.*, u.display_name as created_by_name from claim_wordings w join staff_users u on u.id = w.created_by where w.claim_id = $1 order by w.version", [id]);
  const reviews = await db.query<ReviewRow>(
    `select r.*, w.version as wording_version, ru.display_name as reviewer_name, au.display_name as assigned_by_name
     from medical_reviews r join claim_wordings w on w.id = r.wording_id join staff_users ru on ru.id = r.reviewer_user_id join staff_users au on au.id = r.assigned_by
     where r.claim_id = $1 order by r.assigned_at`,
    [id],
  );
  const sources = await db.query<SourceRow>("select s.*, u.display_name as added_by_name from medical_sources s join staff_users u on u.id = s.added_by where s.claim_id = $1 order by s.created_at", [id]);
  return { ...claim, wordings: wordings.rows, reviews: reviews.rows, sources: sources.rows };
}

export async function createClaim(db: Queryable, clientId: string, input: { claimSummary: string; location: string | null; wording: string }, actorUserId: string): Promise<string> {
  if (!input.claimSummary.trim()) throw new MedicalRuleError("Summarise the claim.");
  if (!input.wording.trim()) throw new MedicalRuleError("Enter the proposed wording.");
  const { rows } = await db.query<{ id: string }>("insert into medical_claims (client_id, claim_summary, location, created_by) values ($1, $2, $3, $4) returning id", [clientId, input.claimSummary.trim(), input.location, actorUserId]);
  const id = rows[0]!.id;
  const { rows: w } = await db.query<{ id: string }>("insert into claim_wordings (claim_id, client_id, version, wording, created_by) values ($1, $2, 1, $3, $4) returning id", [id, clientId, input.wording.trim(), actorUserId]);
  await db.query("update medical_claims set current_wording_id = $2 where id = $1", [id, w[0]!.id]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "medical_claim.create", targetType: "medical_claim", targetId: id, clientId, outcome: "success" });
  return id;
}

/**
 * Adds a new wording version. Earlier reviews are preserved: decided reviews become superseded (their decision is kept),
 * open reviews stay open but staff must assign a review of the new wording. The claim returns to draft.
 */
export async function addWording(db: Queryable, claimId: string, wording: string, actorUserId: string): Promise<string> {
  if (!wording.trim()) throw new MedicalRuleError("Enter the new wording.");
  const { rows: claims } = await db.query<{ client_id: string; status: string; claim_summary: string }>("select client_id, status, claim_summary from medical_claims where id = $1 for update", [claimId]);
  const claim = claims[0];
  if (!claim) throw new MedicalRuleError("Claim not found.");
  if (claim.status === "withdrawn") throw new MedicalRuleError("Withdrawn claims cannot be changed.");
  const { rows: v } = await db.query<{ next: number }>("select coalesce(max(version), 0) + 1 as next from claim_wordings where claim_id = $1", [claimId]);
  const version = v[0]!.next;
  const { rows: w } = await db.query<{ id: string }>("insert into claim_wordings (claim_id, client_id, version, wording, created_by) values ($1, $2, $3, $4, $5) returning id", [claimId, claim.client_id, version, wording.trim(), actorUserId]);
  await db.query("update medical_reviews set status = 'superseded' where claim_id = $1 and status = 'decided'", [claimId]);
  await db.query("update medical_claims set current_wording_id = $2, status = 'draft', updated_at = now() where id = $1", [claimId, w[0]!.id]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "medical_claim.new_wording", targetType: "medical_claim", targetId: claimId, clientId: claim.client_id, outcome: "success", metadata: { version } });
  await recordTimeline(db, { clientId: claim.client_id, eventType: "claim_wording_changed", title: `Claim wording changed (v${version}): ${claim.claim_summary}`, summary: "Earlier reviews preserved and marked superseded. A new review is needed.", relatedType: "medical_claim", relatedId: claimId, actorUserId, dedupeKey: `claim_wording:${w[0]!.id}` });
  return w[0]!.id;
}

export async function assignReview(db: Queryable, claimId: string, reviewerUserId: string, actorUserId: string): Promise<string> {
  const { rows: claims } = await db.query<{ client_id: string; current_wording_id: string | null; status: string }>("select client_id, current_wording_id, status from medical_claims where id = $1 for update", [claimId]);
  const claim = claims[0];
  if (!claim || !claim.current_wording_id) throw new MedicalRuleError("Claim not found.");
  if (claim.status === "withdrawn") throw new MedicalRuleError("Withdrawn claims cannot be reviewed.");
  const reviewer = await db.query<{ platform_role: string; active: boolean }>("select platform_role, active from staff_users where id = $1", [reviewerUserId]);
  if (!reviewer.rows[0]?.active || !["reviewer", "manager", "admin"].includes(reviewer.rows[0].platform_role)) throw new MedicalRuleError("Choose an active reviewer, manager or admin.");
  const open = await db.query("select 1 from medical_reviews where claim_id = $1 and wording_id = $2 and reviewer_user_id = $3 and status in ('assigned','in_progress')", [claimId, claim.current_wording_id, reviewerUserId]);
  if (open.rows.length) throw new MedicalRuleError("This reviewer already has an open review of the current wording.");
  const { rows } = await db.query<{ id: string }>("insert into medical_reviews (claim_id, client_id, wording_id, reviewer_user_id, assigned_by) values ($1, $2, $3, $4, $5) returning id", [claimId, claim.client_id, claim.current_wording_id, reviewerUserId, actorUserId]);
  await db.query("update medical_claims set status = 'under_review', updated_at = now() where id = $1", [claimId]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "medical_review.assign", targetType: "medical_review", targetId: rows[0]!.id, clientId: claim.client_id, outcome: "success", metadata: { reviewerUserId } });
  return rows[0]!.id;
}

/**
 * Records the reviewer's decision. Approval requires at least one recorded source; unsupported claims are never approved.
 * A decision is a workflow outcome, not regulatory certification.
 */
export async function decideReview(db: Queryable, reviewId: string, input: { decision: "approved" | "rejected" | "changes_required"; note: string }, actorUserId: string, actorIsGlobal: boolean): Promise<void> {
  const { rows } = await db.query<{ claim_id: string; client_id: string; reviewer_user_id: string; status: string; wording_id: string }>("select claim_id, client_id, reviewer_user_id, status, wording_id from medical_reviews where id = $1 for update", [reviewId]);
  const r = rows[0];
  if (!r) throw new MedicalRuleError("Review not found.");
  if (r.status === "decided" || r.status === "superseded") throw new MedicalRuleError("This review has already been decided.");
  if (r.reviewer_user_id !== actorUserId && !actorIsGlobal) throw new MedicalRuleError("Only the assigned reviewer can decide this review.");
  if (!input.note.trim()) throw new MedicalRuleError("Record the reasoning for the decision.");
  const claim = await db.query<{ current_wording_id: string; claim_summary: string }>("select current_wording_id, claim_summary from medical_claims where id = $1 for update", [r.claim_id]);
  if (claim.rows[0]?.current_wording_id !== r.wording_id) throw new MedicalRuleError("The wording changed since this review was assigned. Assign a new review of the current wording.");
  if (input.decision === "approved") {
    const sources = await db.query<{ n: number }>("select count(*)::int as n from medical_sources where claim_id = $1", [r.claim_id]);
    if ((sources.rows[0]?.n ?? 0) === 0) throw new MedicalRuleError("A claim cannot be approved without at least one recorded source.");
  }
  await db.query("update medical_reviews set status = 'decided', decision = $2, decision_note = $3, decided_at = now() where id = $1", [reviewId, input.decision, input.note.trim()]);
  const claimStatus = input.decision === "approved" ? "approved" : input.decision === "rejected" ? "rejected" : "draft";
  await db.query("update medical_claims set status = $2, updated_at = now() where id = $1", [r.claim_id, claimStatus]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "medical_review.decide", targetType: "medical_review", targetId: reviewId, clientId: r.client_id, outcome: "success", metadata: { decision: input.decision } });
  await recordTimeline(db, { clientId: r.client_id, eventType: "medical_review_decided", title: `HCSA ${input.decision.replace("_", " ")}: ${claim.rows[0]!.claim_summary}`, summary: input.note.trim(), relatedType: "medical_claim", relatedId: r.claim_id, actorUserId, dedupeKey: `medical_review_decided:${reviewId}` });
}

export async function addSource(db: Queryable, claimId: string, input: { title: string; citation: string | null; url: string | null; sourceType: string; reviewId: string | null }, actorUserId: string): Promise<string> {
  if (!input.title.trim()) throw new MedicalRuleError("Give the source a title.");
  if (input.url && !/^https?:\/\//.test(input.url)) throw new MedicalRuleError("Source links must start with http:// or https://.");
  const { rows: claims } = await db.query<{ client_id: string }>("select client_id from medical_claims where id = $1", [claimId]);
  const claim = claims[0];
  if (!claim) throw new MedicalRuleError("Claim not found.");
  const { rows } = await db.query<{ id: string }>("insert into medical_sources (claim_id, client_id, review_id, title, citation, url, source_type, added_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id", [claimId, claim.client_id, input.reviewId || null, input.title.trim(), input.citation, input.url || null, input.sourceType, actorUserId]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "medical_source.add", targetType: "medical_source", targetId: rows[0]!.id, clientId: claim.client_id, outcome: "success", metadata: { sourceType: input.sourceType } });
  return rows[0]!.id;
}

export async function withdrawClaim(db: Queryable, claimId: string, actorUserId: string): Promise<void> {
  const { rows } = await db.query<{ client_id: string }>("update medical_claims set status = 'withdrawn', withdrawn_at = now(), updated_at = now() where id = $1 and status <> 'withdrawn' returning client_id", [claimId]);
  if (!rows[0]) throw new MedicalRuleError("Claim not found or already withdrawn.");
  await recordAudit(db, { actorType: "staff", actorUserId, action: "medical_claim.withdraw", targetType: "medical_claim", targetId: claimId, clientId: rows[0].client_id, outcome: "success" });
}
