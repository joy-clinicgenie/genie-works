import type { RelatedRecordType } from "@clinic-genie/contracts";
import type { Queryable } from "../client";

const TABLES: Record<RelatedRecordType, { table: string; titleColumn: string }> = {
  task: { table: "tasks", titleColumn: "title" },
  approval: { table: "approvals", titleColumn: "title" },
  seo_page: { table: "seo_pages", titleColumn: "page_path" },
  seo_change: { table: "seo_changes", titleColumn: "reason" },
  ads_audit: { table: "ads_audits", titleColumn: "title" },
  ads_finding: { table: "ads_findings", titleColumn: "finding" },
  ads_change: { table: "ads_changes", titleColumn: "description" },
  issue: { table: "issues", titleColumn: "title" },
  evidence: { table: "evidence_items", titleColumn: "label" },
  medical_claim: { table: "medical_claims", titleColumn: "claim_summary" },
  medical_review: { table: "medical_reviews", titleColumn: "status" },
  report_snapshot: { table: "report_snapshots", titleColumn: "metric" },
  website: { table: "websites", titleColumn: "name" },
  account_reference: { table: "account_references", titleColumn: "label" },
  blog_article: { table: "blog_articles", titleColumn: "title" },
};

export function isRelatedType(v: string): v is RelatedRecordType {
  return v in TABLES;
}

/** A link is stored only when both sides are present. A type with no record stays blank. */
export function relatedPair(type: string | null | undefined, id: string | null | undefined): { type: string | null; id: string | null } {
  if (!type || !id) return { type: null, id: null };
  return { type, id };
}

/** Confirms a related record exists and belongs to the same client. Returns its display title. */
export async function resolveRelated(db: Queryable, clientId: string, type: string, id: string): Promise<{ title: string } | null> {
  if (!isRelatedType(type)) return null;
  const meta = TABLES[type];
  const { rows } = await db.query<{ title: string }>(`select ${meta.titleColumn}::text as title from ${meta.table} where id = $1 and client_id = $2`, [id, clientId]);
  return rows[0] ?? null;
}

/** Candidate records for a client-scoped selector. */
export async function listRelatedCandidates(db: Queryable, clientId: string, type: RelatedRecordType, limit = 50): Promise<Array<{ id: string; title: string }>> {
  const meta = TABLES[type];
  const { rows } = await db.query<{ id: string; title: string }>(
    `select id, left(${meta.titleColumn}::text, 120) as title from ${meta.table} where client_id = $1 order by created_at desc limit $2`,
    [clientId, limit],
  );
  return rows;
}

export function relatedHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  switch (type) {
    case "task": return `/tasks/${id}`;
    case "approval": return `/approvals/${id}`;
    case "seo_page": return `/seo/pages/${id}`;
    case "seo_change": return `/seo/pages?change=${id}`;
    case "ads_audit": return `/google-ads/audits/${id}`;
    case "ads_finding": return `/google-ads/audits?finding=${id}`;
    case "ads_change": return `/google-ads/changes/${id}`;
    case "issue": return `/issues/${id}`;
    case "evidence": return `/issues?evidence=${id}`;
    case "medical_claim": return `/medical-review/${id}`;
    case "medical_review": return `/medical-review?review=${id}`;
    case "report_snapshot": return `/reports?snapshot=${id}`;
    case "website": return `/clients?website=${id}`;
    case "account_reference": return `/clients?reference=${id}`;
    default: return null;
  }
}
