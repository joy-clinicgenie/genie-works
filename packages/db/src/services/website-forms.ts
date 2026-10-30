import type { Queryable } from "../client";
import { recordAudit } from "./audit";

export class WebsiteFormRuleError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "WebsiteFormRuleError";
    this.field = field;
  }
}

export type FormApplicationStatus = "pending_website_update" | "applied" | "failed" | "unable_to_verify";

export interface WebsiteFormRow {
  id: string;
  website_id: string;
  client_id: string;
  form_key: string;
  display_name: string;
  page_path: string | null;
  proposed_active: boolean;
  consent_wording: string | null;
  screen_confirmation: string | null;
  email_acknowledgement: string | null;
  recipient_contact_id: string | null;
  application_status: FormApplicationStatus;
  application_note: string | null;
  last_verified_at: Date | null;
  updated_at: Date;
}

export interface FormWebsiteRow {
  id: string;
  client_id: string;
  client_slug: string;
  client_name: string;
  name: string;
  url: string | null;
  enquiry_key: string | null;
  environment: string;
  status: string;
}

const FORM_COLUMNS = `id, website_id, client_id, form_key, display_name, page_path, proposed_active,
  consent_wording, screen_confirmation, email_acknowledgement, recipient_contact_id,
  application_status, application_note, last_verified_at, updated_at`;

function wording(value: string | null, limit: number, field: string, label: string): string | null {
  const text = value?.trim() || null;
  if (text && text.length > limit) throw new WebsiteFormRuleError(`${label} must be ${limit} characters or fewer.`, field);
  return text;
}

export async function listFormWebsites(db: Queryable, clientIds: string[] | null): Promise<FormWebsiteRow[]> {
  const { rows } = await db.query<FormWebsiteRow>(
    `select w.id, w.client_id, c.slug as client_slug, c.name as client_name, w.name, w.url, w.enquiry_key, w.environment, w.status
     from websites w
     join clients c on c.id = w.client_id
     where w.status = 'active'
       and ($1::uuid[] is null or w.client_id = any($1))
     order by c.name, w.name`,
    [clientIds],
  );
  return rows;
}

export async function listWebsiteForms(db: Queryable, clientIds: string[] | null): Promise<WebsiteFormRow[]> {
  const { rows } = await db.query<WebsiteFormRow>(
    `select ${FORM_COLUMNS}
     from website_forms
     where ($1::uuid[] is null or client_id = any($1))
     order by display_name, form_key`,
    [clientIds],
  );
  return rows;
}

export async function saveWebsiteForm(
  db: Queryable,
  input: {
    websiteId: string;
    clientId: string;
    formKey: string;
    displayName: string;
    pagePath: string | null;
    proposedActive: boolean;
    consentWording: string | null;
    screenConfirmation: string | null;
    emailAcknowledgement: string | null;
    recipientContactId: string | null;
    updatedBy: string;
  },
): Promise<WebsiteFormRow> {
  if (!/^[a-z0-9-]{1,64}$/.test(input.formKey)) throw new WebsiteFormRuleError("That form is not available.", "formKey");
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 120) throw new WebsiteFormRuleError("Enter a form name.", "displayName");
  const pagePath = input.pagePath?.trim() || null;
  if (pagePath && (pagePath.length > 300 || !pagePath.startsWith("/"))) throw new WebsiteFormRuleError("The page path must start with /.", "pagePath");
  const consentWording = wording(input.consentWording, 2000, "consentWording", "Consent wording");
  const screenConfirmation = wording(input.screenConfirmation, 1000, "screenConfirmation", "On-screen confirmation");
  const emailAcknowledgement = wording(input.emailAcknowledgement, 1000, "emailAcknowledgement", "Acknowledgement email");
  const site = await db.query<{ id: string }>("select id from websites where id = $1 and client_id = $2", [input.websiteId, input.clientId]);
  if (!site.rows[0]) throw new WebsiteFormRuleError("That website is not available for this client.", "websiteId");
  if (input.recipientContactId) {
    const contact = await db.query<{ id: string }>(
      "select id from client_contacts where id = $1 and client_id = $2 and active",
      [input.recipientContactId, input.clientId],
    );
    if (!contact.rows[0]) throw new WebsiteFormRuleError("Choose a contact from this client.", "recipientContactId");
  }
  const { rows } = await db.query<WebsiteFormRow>(
    `insert into website_forms (
       website_id, client_id, form_key, display_name, page_path, proposed_active,
       consent_wording, screen_confirmation, email_acknowledgement, recipient_contact_id,
       application_status, application_note, last_verified_at, updated_by
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending_website_update', null, null, $11)
     on conflict (website_id, form_key) do update set
       display_name = excluded.display_name,
       page_path = excluded.page_path,
       proposed_active = excluded.proposed_active,
       consent_wording = excluded.consent_wording,
       screen_confirmation = excluded.screen_confirmation,
       email_acknowledgement = excluded.email_acknowledgement,
       recipient_contact_id = excluded.recipient_contact_id,
       application_status = 'pending_website_update',
       application_note = null,
       last_verified_at = null,
       updated_by = excluded.updated_by,
       updated_at = now()
     returning ${FORM_COLUMNS}`,
    [
      input.websiteId,
      input.clientId,
      input.formKey,
      displayName,
      pagePath,
      input.proposedActive,
      consentWording,
      screenConfirmation,
      emailAcknowledgement,
      input.recipientContactId,
      input.updatedBy,
    ],
  );
  const saved = rows[0];
  if (!saved) throw new WebsiteFormRuleError("Form routing was not saved. You may not have permission to change it.");
  if (saved.application_status !== "pending_website_update") throw new WebsiteFormRuleError("Form routing was not saved as a proposal.");
  await recordAudit(db, {
    actorType: "staff",
    actorUserId: input.updatedBy,
    action: "website_form.propose",
    targetType: "website_form",
    targetId: saved.id,
    clientId: input.clientId,
    outcome: "success",
    metadata: { formKey: input.formKey, recipientSet: Boolean(input.recipientContactId), proposedActive: input.proposedActive },
  });
  return saved;
}

/** Records that the website configuration could not be confirmed. This does not mark the proposal applied. */
export async function markWebsiteFormUnverified(db: Queryable, input: { websiteId: string; formKey: string; actorUserId: string }): Promise<WebsiteFormRow> {
  const { rows } = await db.query<WebsiteFormRow>(
    `update website_forms
     set application_status = 'unable_to_verify',
         application_note = 'The website form configuration could not be confirmed.',
         last_verified_at = now(),
         updated_by = $3,
         updated_at = now()
     where website_id = $1 and form_key = $2
     returning ${FORM_COLUMNS}`,
    [input.websiteId, input.formKey, input.actorUserId],
  );
  const saved = rows[0];
  if (!saved) throw new WebsiteFormRuleError("That form is not available to check.");
  await recordAudit(db, {
    actorType: "staff",
    actorUserId: input.actorUserId,
    action: "website_form.verify",
    targetType: "website_form",
    targetId: saved.id,
    clientId: saved.client_id,
    outcome: "success",
    metadata: { formKey: input.formKey, applicationStatus: saved.application_status },
  });
  return saved;
}
