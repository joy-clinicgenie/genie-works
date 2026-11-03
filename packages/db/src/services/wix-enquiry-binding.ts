import type { Queryable } from "../client";
import { recordAudit } from "./audit";

const STATUSES = ["new", "acknowledged", "closed"] as const;
export type WixFollowUpStatus = (typeof STATUSES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FORM_KEY = /^[a-z0-9-]{1,64}$/;
export const WIX_FORM_NAMESPACE = "wix.form_app.form";

export class WixBindingRuleError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "WixBindingRuleError";
    this.field = field;
  }
}

export interface WixEnquiryBinding {
  websiteId: string;
  clientId: string;
  clientSlug: string;
  clientName: string;
  websiteName: string;
  websiteUrl: string | null;
  environment: string;
  enquiryKey: string;
  formKey: string;
  instanceId: string;
  formId: string;
  namespace: string;
  countsInTotals: boolean;
}

function status(value: string): WixFollowUpStatus | null {
  return STATUSES.find((item) => item === value) ?? null;
}

/** Websites the caller may read. The instance id stays on the server. */
export async function listWixEnquiryBindings(db: Queryable, scope: string[] | null): Promise<WixEnquiryBinding[]> {
  const { rows } = await db.query<{
    website_id: string;
    client_id: string;
    client_slug: string;
    client_name: string;
    website_name: string;
    website_url: string | null;
    environment: string;
    enquiry_key: string;
    form_key: string;
    instance_id: string;
    form_id: string;
    namespace: string;
    counts_in_totals: boolean;
  }>(
    `select w.id as website_id, w.client_id, c.slug as client_slug, c.name as client_name,
            w.name as website_name, w.url as website_url, w.environment,
            w.enquiry_key, f.form_key,
            w.wix_instance_id as instance_id, f.provider_form_id as form_id,
            f.provider_namespace as namespace, f.counts_in_totals
     from website_enquiry_forms f
     join websites w on w.id = f.website_id
     join clients c on c.id = w.client_id
     where w.status = 'active'
       and w.enquiry_source = 'wix'
       and ($1::text[] is null or c.slug = any($1))
     order by c.name, w.name, f.form_key`,
    [scope],
  );
  return rows.map((row) => ({
    websiteId: row.website_id,
    clientId: row.client_id,
    clientSlug: row.client_slug,
    clientName: row.client_name,
    websiteName: row.website_name,
    websiteUrl: row.website_url,
    environment: row.environment,
    enquiryKey: row.enquiry_key,
    formKey: row.form_key,
    instanceId: row.instance_id,
    formId: row.form_id,
    namespace: row.namespace,
    countsInTotals: row.counts_in_totals,
  }));
}

export async function listWixFollowUpStatuses(
  db: Queryable,
  externalIds: string[],
): Promise<Array<{ externalId: string; status: WixFollowUpStatus }>> {
  const ids = externalIds.filter((id) => UUID.test(id));
  if (ids.length === 0) return [];
  const { rows } = await db.query<{ external_id: string; status: WixFollowUpStatus }>(
    "select external_id, status from enquiry_follow_ups where external_id = any($1::uuid[])",
    [ids],
  );
  return rows.map((row) => ({ externalId: row.external_id, status: row.status }));
}

/**
 * Saves follow-up for a Wix submission. A missing row means New.
 * The expected status must still match, and the Wix submission itself is not changed.
 */
export async function setWixEnquiryFollowUp(
  db: Queryable,
  input: { externalId: string; enquiryKey: string | null; fromStatus: string; toStatus: string; scope: string[] | null },
): Promise<{ id: string; clinicId: string; websiteKey: string | null } | null> {
  const externalId = input.externalId.toLowerCase();
  const fromStatus = status(input.fromStatus);
  const toStatus = status(input.toStatus);
  if (!UUID.test(externalId) || !fromStatus || !toStatus || fromStatus === toStatus) return null;
  if (!input.enquiryKey || !/^[a-z0-9-]{1,64}$/.test(input.enquiryKey)) return null;
  const site = await db.query<{ id: string; client_id: string; slug: string; enquiry_key: string }>(
    `select w.id, w.client_id, c.slug, w.enquiry_key
     from websites w
     join clients c on c.id = w.client_id
     where w.enquiry_source = 'wix'
       and w.status = 'active'
       and w.enquiry_key = $1
       and ($2::text[] is null or c.slug = any($2))`,
    [input.enquiryKey, input.scope],
  );
  const website = site.rows[0];
  if (!website) return null;
  const updated = await db.query<{ external_id: string }>(
    `update enquiry_follow_ups
     set status = $4, updated_at = now()
     where website_id = $1 and external_id = $2 and client_id = $3 and status = $5
     returning external_id`,
    [website.id, externalId, website.client_id, toStatus, fromStatus],
  );
  if (updated.rows[0]) return { id: externalId, clinicId: website.slug, websiteKey: website.enquiry_key };
  if (fromStatus !== "new") return null;
  const inserted = await db.query<{ external_id: string }>(
    `insert into enquiry_follow_ups (website_id, client_id, external_id, status)
     values ($1, $2, $3, $4)
     on conflict (website_id, external_id) do nothing
     returning external_id`,
    [website.id, website.client_id, externalId, toStatus],
  );
  if (!inserted.rows[0]) return null;
  return { id: externalId, clinicId: website.slug, websiteKey: website.enquiry_key };
}

/**
 * Connects one existing website to one Wix form. The stored values are the
 * instance id, form id, fixed namespace and form key. Submission answers stay at Wix.
 */
export async function bindWixEnquiryForm(
  db: Queryable,
  input: { clientId: string; websiteId: string; instanceId: string; formId: string; formKey: string },
  actorUserId: string,
): Promise<void> {
  const instanceId = input.instanceId.trim().toLowerCase();
  const formId = input.formId.trim().toLowerCase();
  const formKey = input.formKey.trim().toLowerCase();
  if (!UUID.test(instanceId)) throw new WixBindingRuleError("The Wix site id has to be the UUID for that website.", "instanceId");
  if (!UUID.test(formId)) throw new WixBindingRuleError("The Wix form id has to be the UUID for that form.", "formId");
  if (!FORM_KEY.test(formKey)) throw new WixBindingRuleError("The form key uses lowercase letters, numbers and hyphens.", "formKey");
  const site = (await db.query<{ id: string; enquiry_key: string | null }>(
    "select id, enquiry_key from websites where id = $1 and client_id = $2",
    [input.websiteId, input.clientId],
  )).rows[0];
  if (!site) throw new WixBindingRuleError("That website is not available for this client.", "websiteId");
  if (!site.enquiry_key) throw new WixBindingRuleError("Set this website's enquiry key before connecting a Wix form.", "formKey");
  try {
    const { rowCount } = await db.query(
      `update websites
       set enquiry_source = 'wix', wix_instance_id = $2, wix_form_id = $3,
           wix_form_namespace = $4, wix_form_key = $5, wix_counts_in_totals = false
       where id = $1 and client_id = $6`,
      [site.id, instanceId, formId, WIX_FORM_NAMESPACE, formKey, input.clientId],
    );
    if (!rowCount) throw new WixBindingRuleError("That website is not available for this client.", "websiteId");
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") throw new WixBindingRuleError("That Wix form is already connected to a website.", "formId");
    if (err instanceof WixBindingRuleError) throw err;
    throw err;
  }
  await db.query(
    `insert into website_enquiry_forms (website_id, client_id, source, form_key, provider_form_id, provider_namespace, counts_in_totals)
     values ($1, $2, 'wix', $3, $4, $5, false)
     on conflict (website_id, form_key)
       do update set provider_form_id = excluded.provider_form_id,
                     provider_namespace = excluded.provider_namespace`,
    [site.id, input.clientId, formKey, formId, WIX_FORM_NAMESPACE],
  );
  await recordAudit(db, {
    actorType: "staff",
    actorUserId,
    action: "wix_enquiry.bind",
    targetType: "website",
    targetId: site.id,
    clientId: input.clientId,
    outcome: "success",
    metadata: { formKey, namespace: WIX_FORM_NAMESPACE },
  });
}

/** Returns the website to its enquiry database. The Wix identifiers are cleared. Messages are not stored. */
export async function clearWixEnquiryForm(db: Queryable, input: { clientId: string; websiteId: string }, actorUserId: string): Promise<void> {
  const { rowCount } = await db.query(
    `update websites
     set enquiry_source = 'database', wix_instance_id = null, wix_form_id = null,
         wix_form_namespace = null, wix_form_key = null, wix_counts_in_totals = false
     where id = $1 and client_id = $2`,
    [input.websiteId, input.clientId],
  );
  await db.query("delete from website_enquiry_forms where website_id = $1 and client_id = $2", [input.websiteId, input.clientId]);
  if (!rowCount) throw new WixBindingRuleError("That website is not available for this client.", "websiteId");
  await recordAudit(db, {
    actorType: "staff",
    actorUserId,
    action: "wix_enquiry.clear",
    targetType: "website",
    targetId: input.websiteId,
    clientId: input.clientId,
    outcome: "success",
    metadata: {},
  });
}

/**
 * Adds a further Wix form to a website that already reads one. The website keeps its
 * single app instance; each form is one row. Production counting stays off until it is
 * set deliberately, so a new form never changes a clinic's totals on its own.
 */
export async function addWixEnquiryForm(
  db: Queryable,
  input: { clientId: string; websiteId: string; formId: string; formKey: string; displayName?: string | null },
  actorUserId: string,
): Promise<void> {
  const formId = input.formId.trim().toLowerCase();
  const formKey = input.formKey.trim().toLowerCase();
  if (!UUID.test(formId)) throw new WixBindingRuleError("The Wix form id has to be the UUID for that form.", "formId");
  if (!FORM_KEY.test(formKey)) throw new WixBindingRuleError("The form key uses lowercase letters, numbers and hyphens.", "formKey");
  const site = (await db.query<{ id: string }>(
    "select id from websites where id = $1 and client_id = $2 and enquiry_source = 'wix' and wix_instance_id is not null",
    [input.websiteId, input.clientId],
  )).rows[0];
  if (!site) throw new WixBindingRuleError("Connect this website to Wix before adding another form.", "websiteId");
  try {
    await db.query(
      `insert into website_enquiry_forms (website_id, client_id, source, form_key, provider_form_id, provider_namespace, display_name, counts_in_totals, updated_by)
       values ($1, $2, 'wix', $3, $4, $5, $6, false, $7)`,
      [site.id, input.clientId, formKey, formId, WIX_FORM_NAMESPACE, input.displayName?.trim() || null, actorUserId],
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      throw new WixBindingRuleError("That form key or Wix form is already connected. The same form is never read twice.", "formId");
    }
    throw err;
  }
  await recordAudit(db, {
    actorType: "staff",
    actorUserId,
    action: "wix_enquiry.form_add",
    targetType: "website",
    targetId: site.id,
    clientId: input.clientId,
    outcome: "success",
    metadata: { formKey, namespace: WIX_FORM_NAMESPACE },
  });
}

/** Stops reading one form. The website and its other forms are unchanged. */
export async function removeWixEnquiryForm(
  db: Queryable,
  input: { clientId: string; websiteId: string; formKey: string },
  actorUserId: string,
): Promise<void> {
  const { rowCount } = await db.query(
    "delete from website_enquiry_forms where website_id = $1 and client_id = $2 and form_key = $3",
    [input.websiteId, input.clientId, input.formKey.trim().toLowerCase()],
  );
  if (!rowCount) throw new WixBindingRuleError("That form is not connected to this website.", "formKey");
  await recordAudit(db, {
    actorType: "staff",
    actorUserId,
    action: "wix_enquiry.form_remove",
    targetType: "website",
    targetId: input.websiteId,
    clientId: input.clientId,
    outcome: "success",
    metadata: { formKey: input.formKey.trim().toLowerCase() },
  });
}
