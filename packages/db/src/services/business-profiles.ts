import type { Queryable } from "../client";
import type { SeoBusinessProfileRow } from "./seo-soft-launch";

/* SEO-06.1 Branch List and SEO-06.2 Branch Profile Details (D64). */

export type BranchMapping = "location" | "public_link" | "unmapped";
export type ReviewField = "name" | "address" | "phone" | "hours";
export const REVIEW_FIELDS: readonly ReviewField[] = ["name", "address", "phone", "hours"];

export class BranchReviewRuleError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "BranchReviewRuleError";
    this.field = field;
  }
}

/** The documented Business Profile resource name: locations/{locationId}. */
export function isLocationName(value: string | null | undefined): boolean {
  return typeof value === "string" && /^locations\/\d{1,30}$/.test(value.trim());
}

/** A location ID wins over a public link; a legacy identifier in another form does not count as a mapping. */
export function branchMapping(branch: Pick<SeoBusinessProfileRow, "external_identifier" | "profile_url">): BranchMapping {
  if (isLocationName(branch.external_identifier)) return "location";
  if (branch.profile_url) return "public_link";
  return "unmapped";
}

export interface BranchDiscrepancy {
  field: ReviewField;
  saved: string | null;
  observed: string;
  note: string | null;
}

export interface BranchReview {
  id: string;
  method: BranchMapping;
  reviewedOn: string;
  fieldsReviewed: ReviewField[];
  discrepancies: BranchDiscrepancy[];
  reviewedBy: string;
  reviewedByName: string | null;
  createdAt: Date;
}

export interface BranchRow extends SeoBusinessProfileRow {
  mapping: BranchMapping;
  /** A stored identifier that is not a documented location name. */
  unrecognisedIdentifier: boolean;
  lastReview: Pick<BranchReview, "reviewedOn" | "reviewedByName"> & { discrepancyCount: number } | null;
}

const BRANCH_SELECT = `select p.*, c.name as client_name from seo_business_profiles p join clients c on c.id = p.client_id`;

function toBranch(row: SeoBusinessProfileRow, last: { reviewed_on: string; reviewed_by_name: string | null; discrepancies: number } | undefined): BranchRow {
  return {
    ...row,
    mapping: branchMapping(row),
    unrecognisedIdentifier: Boolean(row.external_identifier) && !isLocationName(row.external_identifier),
    lastReview: last ? { reviewedOn: last.reviewed_on, reviewedByName: last.reviewed_by_name, discrepancyCount: last.discrepancies } : null,
  };
}

/** Branches of one organisation, each with its mapping method and latest review. */
export async function listBranches(db: Queryable, clientId: string): Promise<BranchRow[]> {
  const { rows } = await db.query<SeoBusinessProfileRow>(`${BRANCH_SELECT} where p.client_id = $1 order by p.branch_name`, [clientId]);
  const last = await db.query<{ branch_id: string; reviewed_on: string; reviewed_by_name: string | null; discrepancies: number }>(
    `select distinct on (r.branch_id) r.branch_id, r.reviewed_on::text, u.display_name as reviewed_by_name, jsonb_array_length(r.discrepancies) as discrepancies
     from seo_branch_reviews r left join staff_users u on u.id = r.reviewed_by
     where r.client_id = $1 order by r.branch_id, r.created_at desc`,
    [clientId],
  );
  const byBranch = new Map(last.rows.map((row) => [row.branch_id, row]));
  return rows.map((row) => toBranch(row, byBranch.get(row.id)));
}

/** One branch, only when it belongs to the given organisation. */
export async function getBranch(db: Queryable, clientId: string, branchId: string): Promise<BranchRow | null> {
  const { rows } = await db.query<SeoBusinessProfileRow>(`${BRANCH_SELECT} where p.id = $1 and p.client_id = $2`, [branchId, clientId]);
  return rows[0] ? (await listBranches(db, clientId)).find((branch) => branch.id === branchId) ?? null : null;
}

export async function listBranchReviews(db: Queryable, clientId: string, branchId: string): Promise<BranchReview[]> {
  const { rows } = await db.query<{ id: string; method: BranchMapping; reviewed_on: string; fields_reviewed: ReviewField[]; discrepancies: BranchDiscrepancy[]; reviewed_by: string; reviewed_by_name: string | null; created_at: Date }>(
    `select r.id, r.method, r.reviewed_on::text, r.fields_reviewed, r.discrepancies, r.reviewed_by, u.display_name as reviewed_by_name, r.created_at
     from seo_branch_reviews r left join staff_users u on u.id = r.reviewed_by
     where r.client_id = $1 and r.branch_id = $2 order by r.created_at desc`,
    [clientId, branchId],
  );
  return rows.map((row) => ({
    id: row.id, method: row.method, reviewedOn: row.reviewed_on, fieldsReviewed: row.fields_reviewed, discrepancies: row.discrepancies,
    reviewedBy: row.reviewed_by, reviewedByName: row.reviewed_by_name, createdAt: row.created_at,
  }));
}

function savedValue(branch: SeoBusinessProfileRow, field: ReviewField): string | null {
  if (field === "name") return branch.branch_name;
  if (field === "address") return branch.address;
  if (field === "phone") return branch.phone;
  return branch.opening_hours;
}

/**
 * Records a staff review of the public listing (append-only). The branch must belong to the organisation; a
 * discrepancy can only be for a reviewed field, and the saved value is copied so later edits do not rewrite it.
 */
export async function recordBranchReview(db: Queryable, input: {
  clientId: string;
  branchId: string;
  reviewedOn: string;
  fieldsReviewed: ReviewField[];
  discrepancies: Array<{ field: ReviewField; observed: string; note?: string | null }>;
  actorUserId: string;
}): Promise<string> {
  const branch = await getBranch(db, input.clientId, input.branchId);
  if (!branch) throw new BranchReviewRuleError("That branch is not part of this organisation.");
  const fields = [...new Set(input.fieldsReviewed)].filter((field) => REVIEW_FIELDS.includes(field));
  if (!fields.length) throw new BranchReviewRuleError("Choose at least one field you reviewed.", "fieldsReviewed");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reviewedOn)) throw new BranchReviewRuleError("Enter the review date.", "reviewedOn");
  const discrepancies: BranchDiscrepancy[] = [];
  for (const item of input.discrepancies) {
    if (!fields.includes(item.field)) throw new BranchReviewRuleError("A discrepancy must be for a field you reviewed.", item.field);
    const observed = item.observed.trim();
    if (!observed || observed.length > 300) throw new BranchReviewRuleError("Enter what the listing shows, up to 300 characters.", item.field);
    discrepancies.push({ field: item.field, saved: savedValue(branch, item.field), observed, note: item.note?.trim().slice(0, 300) || null });
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into seo_branch_reviews (client_id, branch_id, method, reviewed_on, fields_reviewed, discrepancies, reviewed_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [input.clientId, input.branchId, branch.mapping, input.reviewedOn, fields, JSON.stringify(discrepancies), input.actorUserId],
  );
  return rows[0]!.id;
}
