import type { Queryable } from "../client";
import { recordAudit } from "./audit";

/**
 * Wix Inbox as an additional read source beside the New Wix Forms connector, which is
 * unchanged. Only identifiers and operational metadata are stored: submitted fields,
 * message bodies and raw event payloads stay at Wix and are read when staff open an
 * enquiry. See D50.
 */

export class WixInboxRuleError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "WixInboxRuleError";
    this.field = field;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MESSAGE_ID = /^[0-9A-Za-z_-]{1,64}$/;

export interface InboxMessageInput {
  instanceId: string;
  conversationId: string;
  messageId: string;
  sequence?: string | null;
  appId?: string | null;
  formTitle?: string | null;
  messageCreatedAt: Date;
  eventId?: string | null;
  discoveredVia: "webhook" | "registered";
}

export interface InboxMessageRow {
  websiteId: string;
  clientId: string;
  clientSlug: string;
  clientName: string;
  websiteName: string;
  enquiryKey: string | null;
  conversationId: string;
  messageId: string;
  appId: string | null;
  formTitle: string | null;
  messageCreatedAt: Date;
  discoveredVia: string;
}

export interface InboxCoverageRow {
  websiteId: string;
  clientSlug: string;
  websiteName: string;
  coverageStartAt: Date | null;
  earliestMessageAt: Date | null;
  messageCount: number;
  note: string | null;
}

/**
 * Records one incoming Inbox form message, found from the message_sent_to_business
 * event. Idempotent: site, conversation and message together are unique, so a repeated
 * delivery of the same event inserts nothing and is reported as a duplicate.
 */
export async function recordInboxFormMessage(
  db: Queryable,
  input: InboxMessageInput,
): Promise<{ stored: boolean; duplicate: boolean; websiteId: string | null }> {
  const instanceId = input.instanceId.trim().toLowerCase();
  const conversationId = input.conversationId.trim().toLowerCase();
  const messageId = input.messageId.trim();
  if (!UUID.test(instanceId) || !UUID.test(conversationId) || !MESSAGE_ID.test(messageId)) {
    throw new WixInboxRuleError("The Inbox message identifiers are not in the expected form.");
  }
  // The instance decides the website, so one site's event can never land on another.
  const site = (await db.query<{ id: string; client_id: string }>(
    `select id, client_id from websites
     where lower(wix_instance_id) = $1 and enquiry_source = 'wix' and status = 'active'`,
    [instanceId],
  )).rows[0];
  if (!site) return { stored: false, duplicate: false, websiteId: null };
  const { rows } = await db.query<{ id: string }>(
    `insert into wix_inbox_messages
       (website_id, client_id, conversation_id, message_id, sequence, app_id, form_title,
        message_created_at, discovered_via, event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (website_id, conversation_id, message_id) do nothing
     returning id`,
    [
      site.id, site.client_id, conversationId, messageId,
      input.sequence ?? null, input.appId ?? null, input.formTitle ?? null,
      input.messageCreatedAt, input.discoveredVia, input.eventId ?? null,
    ],
  );
  const stored = rows.length > 0;
  if (stored) {
    // Coverage begins at the first message this website ever recorded.
    await db.query(
      `insert into wix_inbox_coverage (website_id, client_id, coverage_start_at)
       values ($1, $2, $3)
       on conflict (website_id) do update
         set coverage_start_at = least(wix_inbox_coverage.coverage_start_at, excluded.coverage_start_at),
             updated_at = now()`,
      [site.id, site.client_id, input.messageCreatedAt],
    );
  }
  return { stored, duplicate: !stored, websiteId: site.id };
}

/** Inbox form messages the caller may read. Content is not stored, so none is returned. */
export async function listInboxFormMessages(
  db: Queryable,
  scope: string[] | null,
  filters: { clinicId?: string; from?: string; to?: string; limit?: number } = {},
): Promise<InboxMessageRow[]> {
  const { rows } = await db.query<{
    website_id: string; client_id: string; client_slug: string; client_name: string;
    website_name: string; enquiry_key: string | null; conversation_id: string; message_id: string;
    app_id: string | null; form_title: string | null; message_created_at: Date; discovered_via: string;
  }>(
    `select m.website_id, m.client_id, c.slug as client_slug, c.name as client_name,
            w.name as website_name, w.enquiry_key, m.conversation_id, m.message_id,
            m.app_id, m.form_title, m.message_created_at, m.discovered_via
     from wix_inbox_messages m
     join websites w on w.id = m.website_id
     join clients c on c.id = m.client_id
     where ($1::text[] is null or c.slug = any($1))
       and ($2::text is null or c.slug = $2)
       and ($3::timestamptz is null or m.message_created_at >= $3)
       and ($4::timestamptz is null or m.message_created_at < $4)
     order by m.message_created_at desc
     limit $5`,
    [scope, filters.clinicId ?? null, filters.from ?? null, filters.to ?? null, Math.min(500, filters.limit ?? 200)],
  );
  return rows.map((row) => ({
    websiteId: row.website_id,
    clientId: row.client_id,
    clientSlug: row.client_slug,
    clientName: row.client_name,
    websiteName: row.website_name,
    enquiryKey: row.enquiry_key,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    appId: row.app_id,
    formTitle: row.form_title,
    messageCreatedAt: row.message_created_at,
    discoveredVia: row.discovered_via,
  }));
}

/** Coverage per website, so a partial Inbox window is never shown as every enquiry. */
export async function listInboxCoverage(db: Queryable, scope: string[] | null): Promise<InboxCoverageRow[]> {
  const { rows } = await db.query<{
    website_id: string; client_slug: string; website_name: string;
    coverage_start_at: Date | null; earliest: Date | null; message_count: number; note: string | null;
  }>(
    `select w.id as website_id, c.slug as client_slug, w.name as website_name,
            v.coverage_start_at, v.note,
            min(m.message_created_at) as earliest,
            count(m.id)::int as message_count
     from websites w
     join clients c on c.id = w.client_id
     left join wix_inbox_coverage v on v.website_id = w.id
     left join wix_inbox_messages m on m.website_id = w.id
     where w.enquiry_source = 'wix' and w.status = 'active'
       and ($1::text[] is null or c.slug = any($1))
     group by w.id, c.slug, c.name, w.name, v.coverage_start_at, v.note
     order by c.name, w.name`,
    [scope],
  );
  return rows.map((row) => ({
    websiteId: row.website_id,
    clientSlug: row.client_slug,
    websiteName: row.website_name,
    coverageStartAt: row.coverage_start_at,
    earliestMessageAt: row.earliest,
    messageCount: row.message_count,
    note: row.note,
  }));
}

/**
 * Registers a conversation an administrator already knows about, for history the event
 * route cannot reach. The caller must have proved the conversation belongs to this
 * website's Wix site before calling, because only that call can establish ownership.
 */
export async function registerInboxConversation(
  db: Queryable,
  input: { clientId: string; websiteId: string; conversationId: string; messageId: string; messageCreatedAt: Date; formTitle?: string | null; appId?: string | null },
  actorUserId: string,
): Promise<{ stored: boolean; duplicate: boolean }> {
  const conversationId = input.conversationId.trim().toLowerCase();
  const messageId = input.messageId.trim();
  if (!UUID.test(conversationId)) throw new WixInboxRuleError("The conversation id has to be the UUID Wix shows for that conversation.", "conversationId");
  if (!MESSAGE_ID.test(messageId)) throw new WixInboxRuleError("The message id is not in the expected form.", "messageId");
  const site = (await db.query<{ id: string; client_id: string }>(
    `select id, client_id from websites
     where id = $1 and client_id = $2 and enquiry_source = 'wix' and wix_instance_id is not null`,
    [input.websiteId, input.clientId],
  )).rows[0];
  if (!site) throw new WixInboxRuleError("Connect this website to Wix before registering a conversation.", "websiteId");
  const { rows } = await db.query<{ id: string }>(
    `insert into wix_inbox_messages
       (website_id, client_id, conversation_id, message_id, app_id, form_title, message_created_at, discovered_via)
     values ($1, $2, $3, $4, $5, $6, $7, 'registered')
     on conflict (website_id, conversation_id, message_id) do nothing
     returning id`,
    [site.id, site.client_id, conversationId, messageId, input.appId ?? null, input.formTitle ?? null, input.messageCreatedAt],
  );
  const stored = rows.length > 0;
  if (stored) {
    await db.query(
      `insert into wix_inbox_coverage (website_id, client_id, coverage_start_at, updated_by)
       values ($1, $2, $3, $4)
       on conflict (website_id) do update
         set coverage_start_at = least(wix_inbox_coverage.coverage_start_at, excluded.coverage_start_at),
             updated_at = now(), updated_by = excluded.updated_by`,
      [site.id, site.client_id, input.messageCreatedAt, actorUserId],
    );
    await recordAudit(db, {
      actorType: "staff",
      actorUserId,
      action: "wix_inbox.register",
      targetType: "website",
      targetId: site.id,
      clientId: site.client_id,
      outcome: "success",
      metadata: { conversationId, discoveredVia: "registered" },
    });
  }
  return { stored, duplicate: !stored };
}
