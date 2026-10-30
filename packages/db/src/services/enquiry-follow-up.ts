import type pg from "pg";
import type { Queryable } from "../client";

const STATUSES = ["new", "acknowledged", "closed"] as const;
export type EnquiryFollowUpStatus = (typeof STATUSES)[number];

export class EnquiryStatusRuleError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "EnquiryStatusRuleError";
    this.field = field;
  }
}

export interface EnquiryStatusEvent {
  id: string;
  enquiry_id: string;
  client_id: string;
  clinic_slug: string;
  website_key: string | null;
  from_status: EnquiryFollowUpStatus;
  to_status: EnquiryFollowUpStatus;
  note: string | null;
  actor_user_id: string;
  actor_name: string;
  occurred_at: Date;
}

function status(value: string): EnquiryFollowUpStatus | null {
  return STATUSES.find((item) => item === value) ?? null;
}

/** Updates follow-up status on the clinic-website enquiry. A stale expected status changes nothing. */
export async function setEnquiryFollowUp(
  query: Pick<pg.Pool | pg.PoolClient, "query">,
  input: { id: string; fromStatus: string; toStatus: string; scope: string[] | null },
): Promise<{ id: string; clinicId: string; websiteKey: string | null; reference: string } | null> {
  if (!/^[0-9a-f-]{36}$/.test(input.id)) return null;
  const fromStatus = status(input.fromStatus);
  const toStatus = status(input.toStatus);
  if (!fromStatus || !toStatus || fromStatus === toStatus) return null;
  const result = await query.query<{ id: string; clinic_id: string; website_key: string | null; public_reference: string }>(
    `update enquiries
     set status = $1
     where id = $2
       and status = $3
       and ($4::text[] is null or clinic_id = any($4))
     returning id, clinic_id, website_key, public_reference`,
    [toStatus, input.id, fromStatus, input.scope],
  );
  const row = result.rows[0];
  return row ? { id: row.id, clinicId: row.clinic_id, websiteKey: row.website_key, reference: row.public_reference } : null;
}

/** True when the website database exposes a form-configuration table. Null means the check could not run. */
export async function websiteFormConfigPresent(query: Pick<pg.Pool | pg.PoolClient, "query">): Promise<boolean | null> {
  try {
    const result = await query.query<{ name: string | null }>("select to_regclass('public.website_form_config')::text as name");
    return Boolean(result.rows[0]?.name);
  } catch {
    return null;
  }
}

export async function listEnquiryStatusEvents(db: Queryable, enquiryId: string): Promise<EnquiryStatusEvent[]> {
  if (!/^[0-9a-f-]{36}$/.test(enquiryId)) return [];
  const { rows } = await db.query<EnquiryStatusEvent>(
    `select e.id, e.enquiry_id, e.client_id, e.clinic_slug, e.website_key, e.from_status, e.to_status, e.note,
            e.actor_user_id, u.display_name as actor_name, e.occurred_at
     from enquiry_status_events e
     join staff_users u on u.id = e.actor_user_id
     where e.enquiry_id = $1
     order by e.occurred_at desc, e.id desc`,
    [enquiryId],
  );
  return rows;
}

/** Records who changed follow-up status. The note is staff text. Patient enquiry content is not stored here. */
export async function recordEnquiryStatusEvent(
  db: Queryable,
  input: {
    enquiryId: string;
    clinicSlug: string;
    websiteKey: string | null;
    fromStatus: string;
    toStatus: string;
    note: string | null;
    actorUserId: string;
  },
): Promise<{ id: string; clientId: string }> {
  if (!/^[0-9a-f-]{36}$/.test(input.enquiryId)) throw new EnquiryStatusRuleError("That enquiry is not available.");
  const fromStatus = status(input.fromStatus);
  const toStatus = status(input.toStatus);
  if (!fromStatus || !toStatus) throw new EnquiryStatusRuleError("Choose a follow-up status.", "status");
  const note = input.note?.trim() || null;
  if (note && note.length > 1000) throw new EnquiryStatusRuleError("The note must be 1000 characters or fewer.", "note");
  if (fromStatus === toStatus && !note) throw new EnquiryStatusRuleError("Choose a different status, or add a note.", "status");
  const client = await db.query<{ id: string; slug: string }>("select id, slug from clients where slug = $1", [input.clinicSlug]);
  const row = client.rows[0];
  if (!row) throw new EnquiryStatusRuleError("That enquiry is not available.");
  const websiteKey = input.websiteKey && /^[a-z0-9-]{1,64}$/.test(input.websiteKey) ? input.websiteKey : null;
  const inserted = await db.query<{ id: string }>(
    `insert into enquiry_status_events (
       enquiry_id, client_id, clinic_slug, website_key, from_status, to_status, note, actor_user_id
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [input.enquiryId, row.id, row.slug, websiteKey, fromStatus, toStatus, note, input.actorUserId],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new EnquiryStatusRuleError("The follow-up history could not be saved.");
  return { id, clientId: row.id };
}
