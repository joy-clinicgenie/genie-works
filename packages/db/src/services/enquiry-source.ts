import type { Queryable } from "../client";
import { recordAudit } from "./audit";

/**
 * D85. Enquiry sources read outside the platform database. The Supabase contact form
 * (`contact_submissions` on the Clinic Genie website) is read live; only follow-up
 * status and the website it maps to are stored here.
 */

const STATUSES = ["new", "acknowledged", "closed"] as const;
export type ExternalFollowUpStatus = (typeof STATUSES)[number];

export const WEBSITE_ENQUIRY_SOURCES = ["database", "supabase"] as const;
export type WebsiteEnquirySource = (typeof WEBSITE_ENQUIRY_SOURCES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class EnquirySourceRuleError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "EnquirySourceRuleError";
    this.field = field;
  }
}

export interface SupabaseEnquiryWebsite {
  websiteId: string;
  clientId: string;
  clientSlug: string;
  clientName: string;
  websiteName: string;
  enquiryKey: string | null;
}

function status(value: string): ExternalFollowUpStatus | null {
  return STATUSES.find((item) => item === value) ?? null;
}

/** The one active website that reads the Supabase contact form, if the caller may see it. */
export async function getSupabaseEnquiryWebsite(db: Queryable, scope: string[] | null): Promise<SupabaseEnquiryWebsite | null> {
  const { rows } = await db.query<{
    website_id: string;
    client_id: string;
    client_slug: string;
    client_name: string;
    website_name: string;
    enquiry_key: string | null;
  }>(
    `select w.id as website_id, w.client_id, c.slug as client_slug, c.name as client_name,
            w.name as website_name, w.enquiry_key
     from websites w
     join clients c on c.id = w.client_id
     where w.status = 'active'
       and w.enquiry_source = 'supabase'
       and ($1::text[] is null or c.slug = any($1))
     limit 1`,
    [scope],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    websiteId: row.website_id,
    clientId: row.client_id,
    clientSlug: row.client_slug,
    clientName: row.client_name,
    websiteName: row.website_name,
    enquiryKey: row.enquiry_key,
  };
}

export async function listExternalFollowUpStatuses(
  db: Queryable,
  externalIds: string[],
): Promise<Array<{ externalId: string; status: ExternalFollowUpStatus }>> {
  const ids = externalIds.map((id) => id.toLowerCase()).filter((id) => UUID.test(id));
  if (ids.length === 0) return [];
  const { rows } = await db.query<{ external_id: string; status: ExternalFollowUpStatus }>(
    "select external_id, status from enquiry_follow_ups where external_id = any($1::uuid[])",
    [ids],
  );
  return rows.map((row) => ({ externalId: row.external_id, status: row.status }));
}

/**
 * Saves follow-up for a Supabase contact-form row. A missing row means New.
 * The expected status must still match. The row in Supabase is not changed.
 */
export async function setSupabaseEnquiryFollowUp(
  db: Queryable,
  input: { externalId: string; fromStatus: string; toStatus: string; scope: string[] | null },
): Promise<{ id: string; clinicId: string; websiteKey: string | null } | null> {
  const externalId = input.externalId.toLowerCase();
  const fromStatus = status(input.fromStatus);
  const toStatus = status(input.toStatus);
  if (!UUID.test(externalId) || !fromStatus || !toStatus || fromStatus === toStatus) return null;
  const website = await getSupabaseEnquiryWebsite(db, input.scope);
  if (!website) return null;
  const result = { id: externalId, clinicId: website.clientSlug, websiteKey: website.enquiryKey };
  const updated = await db.query(
    `update enquiry_follow_ups
     set status = $4, updated_at = now()
     where website_id = $1 and external_id = $2 and client_id = $3 and status = $5
     returning external_id`,
    [website.websiteId, externalId, website.clientId, toStatus, fromStatus],
  );
  if (updated.rows[0]) return result;
  if (fromStatus !== "new") return null;
  const inserted = await db.query(
    `insert into enquiry_follow_ups (website_id, client_id, external_id, status)
     values ($1, $2, $3, $4)
     on conflict (website_id, external_id) do nothing
     returning external_id`,
    [website.websiteId, website.clientId, externalId, toStatus],
  );
  return inserted.rows[0] ? result : null;
}

/**
 * Sets where a website's enquiries are read from. Administrators only (enforced by the
 * websites_wix_binding_admin_trg trigger). Any old Wix identifiers on the website are cleared.
 */
export async function setWebsiteEnquirySource(
  db: Queryable,
  input: { clientId: string; websiteId: string; source: string },
  actorUserId: string,
): Promise<void> {
  const source = WEBSITE_ENQUIRY_SOURCES.find((item) => item === input.source);
  if (!source) throw new EnquirySourceRuleError("Choose where this website's enquiries come from.", "enquirySource");
  try {
    const { rowCount } = await db.query(
      `update websites
       set enquiry_source = $3, wix_instance_id = null, wix_form_id = null,
           wix_form_namespace = null, wix_form_key = null, wix_counts_in_totals = false
       where id = $1 and client_id = $2 and status = 'active'`,
      [input.websiteId, input.clientId, source],
    );
    if (!rowCount) throw new EnquirySourceRuleError("That website is not available for this client.", "websiteId");
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new EnquirySourceRuleError("Another website already reads the Supabase contact form. Change that website first.", "enquirySource");
    }
    throw err;
  }
  await recordAudit(db, {
    actorType: "staff",
    actorUserId,
    action: "enquiry_source.set",
    targetType: "website",
    targetId: input.websiteId,
    clientId: input.clientId,
    outcome: "success",
    metadata: { source },
  });
}
