import type { ClientChannel, PlatformRole } from "@clinic-genie/contracts";
import type { Queryable } from "../client";
import { recordAudit } from "./audit";
import { recordTimeline } from "./timeline";

export interface ClientRow {
  id: string;
  slug: string;
  name: string;
  status: "active" | "archived";
  owner_user_id: string | null;
  owner_name: string | null;
  channels: ClientChannel[];
  services: string | null;
  is_synthetic: boolean;
  notes: string | null;
  reference_number: string | null;
  short_code: string | null;
  specialty: string | null;
  legal_name: string | null;
  public_name: string | null;
  address: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  enquiry_owner_user_id: string | null;
  enquiry_owner_name: string | null;
  notification_owner_user_id: string | null;
  notification_owner_name: string | null;
  administration_owner_user_id: string | null;
  administration_owner_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

export interface WebsiteRow {
  id: string;
  client_id: string;
  name: string;
  url: string | null;
  platform: string;
  environment: "production" | "staging" | "development";
  status: "active" | "archived";
  notes: string | null;
  enquiry_key: string | null;
  enquiry_source: "database" | "wix";
  wix_instance_id: string | null;
  wix_form_id: string | null;
  wix_form_namespace: string | null;
  wix_form_key: string | null;
  wix_counts_in_totals: boolean;
  blog_requirements: { author: boolean; category: boolean; featuredImage: boolean; seo: boolean; social: boolean };
  created_at: Date;
  archived_at: Date | null;
}

export interface AccountReferenceRow {
  id: string;
  client_id: string;
  kind: string;
  label: string;
  external_identifier: string | null;
  url: string | null;
  vault_reference: string | null;
  notes: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ClientContactRow {
  id: string;
  client_id: string;
  name: string;
  designation: string | null;
  work_email: string | null;
  work_phone: string | null;
  is_primary: boolean;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

export interface MembershipRow {
  id: string;
  user_id: string;
  client_id: string;
  active: boolean;
  user_email: string;
  user_name: string;
  user_role: PlatformRole;
  created_at: Date;
}

export interface StaffRow {
  id: string;
  email: string;
  display_name: string;
  platform_role: PlatformRole;
  active: boolean;
  membership_count: number;
}

const CLIENT_SELECT = `select c.*,
  owner.display_name as owner_name,
  enquiry.display_name as enquiry_owner_name,
  notice.display_name as notification_owner_name,
  adminc.display_name as administration_owner_name,
  creator.display_name as created_by_name,
  editor.display_name as updated_by_name
from clients c
left join staff_users owner on owner.id = c.owner_user_id
left join staff_users enquiry on enquiry.id = c.enquiry_owner_user_id
left join staff_users notice on notice.id = c.notification_owner_user_id
left join staff_users adminc on adminc.id = c.administration_owner_user_id
left join staff_users creator on creator.id = c.created_by
left join staff_users editor on editor.id = c.updated_by`;

export async function listClients(db: Queryable, opts: { includeArchived?: boolean; query?: string; specialty?: string; ownerUserId?: string; status?: "active" | "archived" | "all" } = {}): Promise<ClientRow[]> {
  const query = opts.query?.trim();
  const { rows } = await db.query<ClientRow>(
    `${CLIENT_SELECT}
     where (
       ($1::text is not null and c.status = $1)
       or ($1::text is null and ($2::bool or c.status = 'active'))
     )
     and ($3::uuid is null or c.owner_user_id = $3)
     and ($4::text is null or c.specialty = $4)
     and (
       $5::text is null
       or c.name ilike $5 escape E'\\\\'
       or coalesce(c.public_name, '') ilike $5 escape E'\\\\'
       or coalesce(c.legal_name, '') ilike $5 escape E'\\\\'
       or coalesce(c.reference_number, '') ilike $5 escape E'\\\\'
       or coalesce(c.short_code, '') ilike $5 escape E'\\\\'
       or coalesce(c.specialty, '') ilike $5 escape E'\\\\'
       or c.slug ilike $5 escape E'\\\\'
     )
     order by c.reference_number nulls last, c.name`,
    [
      opts.status && opts.status !== "all" ? opts.status : null,
      opts.includeArchived ?? false,
      opts.ownerUserId ?? null,
      opts.specialty?.trim() || null,
      query ? `%${query.replace(/[%_\\]/g, "\\$&")}%` : null,
    ],
  );
  return rows;
}

export async function listClientSpecialties(db: Queryable, opts: { status?: "active" | "archived" | "all" } = {}): Promise<string[]> {
  const { rows } = await db.query<{ specialty: string }>(
    `select distinct specialty from clients
     where specialty is not null and specialty <> ''
       and ($1::text is null or status = $1)
     order by specialty`,
    [opts.status && opts.status !== "all" ? opts.status : null],
  );
  return rows.map((row) => row.specialty);
}

export async function getClient(db: Queryable, id: string): Promise<ClientRow | null> {
  const { rows } = await db.query<ClientRow>(`${CLIENT_SELECT} where c.id = $1`, [id]);
  return rows[0] ?? null;
}

export interface ShellClient {
  id: string;
  name: string;
  slug: string;
  reference_number: string | null;
  short_code: string | null;
  public_name: string | null;
  legal_name: string | null;
  specialty: string | null;
}

/** Names and search labels for the shell. Skips the staff joins used by the full client record. */
export async function listShellClients(db: Queryable): Promise<ShellClient[]> {
  const { rows } = await db.query<ShellClient>(
    `select id, name, slug, reference_number, short_code, public_name, legal_name, specialty
     from clients
     where status = 'active'
     order by reference_number nulls last, name`,
  );
  return rows;
}

export async function listActiveWebsiteClientIds(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ client_id: string }>(
    "select distinct client_id from websites where status = 'active' and archived_at is null",
  );
  return rows.map((row) => row.client_id);
}

export interface ActiveWebsiteSummary {
  id: string;
  client_id: string;
  client_name: string;
  reference_number: string | null;
  name: string;
  url: string | null;
  platform: string;
  environment: WebsiteRow["environment"];
  status: WebsiteRow["status"];
}

/** Active websites for the SEO picker, in one query. */
export async function listActiveWebsiteSummaries(db: Queryable): Promise<ActiveWebsiteSummary[]> {
  const { rows } = await db.query<ActiveWebsiteSummary>(
    `select w.id, w.client_id, c.name as client_name, c.reference_number, w.name, w.url, w.platform, w.environment, w.status
     from websites w
     join clients c on c.id = w.client_id
     where w.status = 'active' and w.archived_at is null and c.status = 'active'
     order by c.reference_number nulls last, c.name, w.name`,
  );
  return rows;
}

/** Active clients, plus an explicitly requested client when that record is visible. An unknown id stays absent so callers can deny it. */
export async function listClientsForRequest(db: Queryable, requestedId?: string | null): Promise<ClientRow[]> {
  const clients = await listClients(db);
  if (!requestedId || clients.some((client) => client.id === requestedId)) return clients;
  const requested = await getClient(db, requestedId);
  return requested ? [requested, ...clients] : clients;
}

export async function getClientBySlug(db: Queryable, slug: string): Promise<ClientRow | null> {
  const { rows } = await db.query<ClientRow>(`${CLIENT_SELECT} where c.slug = $1`, [slug]);
  return rows[0] ?? null;
}

export interface ClientInput {
  slug: string;
  name: string;
  ownerUserId: string | null;
  channels: ClientChannel[];
  services?: string | null;
  isSynthetic: boolean;
  notes: string | null;
  referenceNumber?: string | null;
  shortCode?: string | null;
  specialty?: string | null;
  legalName?: string | null;
  publicName?: string | null;
  address?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  enquiryOwnerUserId?: string | null;
  notificationOwnerUserId?: string | null;
  administrationOwnerUserId?: string | null;
}

export async function createClient(db: Queryable, input: ClientInput, actorUserId: string): Promise<ClientRow> {
  const { rows } = await db.query<{ id: string }>(
    `insert into clients (
       slug, name, owner_user_id, channels, services, is_synthetic, notes,
       reference_number, short_code, specialty, legal_name, public_name, address, contact_email, contact_phone,
       enquiry_owner_user_id, notification_owner_user_id, administration_owner_user_id, created_by, updated_by
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19) returning id`,
    [
      input.slug, input.name, input.ownerUserId, input.channels, cleanServices(input.services), input.isSynthetic, input.notes,
      input.referenceNumber ?? null, input.shortCode ?? null, input.specialty ?? null, input.legalName ?? null, input.publicName ?? null, input.address ?? null, input.contactEmail ?? null, input.contactPhone ?? null,
      input.enquiryOwnerUserId ?? null, input.notificationOwnerUserId ?? null, input.administrationOwnerUserId ?? null, actorUserId,
    ],
  );
  const id = rows[0]!.id;
  await recordAudit(db, { actorType: "staff", actorUserId, action: "client.create", targetType: "client", targetId: id, clientId: id, outcome: "success", metadata: { slug: input.slug } });
  await recordTimeline(db, { clientId: id, eventType: "client_created", title: `Client ${input.name} created`, relatedType: null, relatedId: null, actorUserId, dedupeKey: `client_created:${id}` });
  return (await getClient(db, id))!;
}

export async function updateClient(db: Queryable, id: string, input: Omit<ClientInput, "slug" | "isSynthetic">, actorUserId: string): Promise<void> {
  const { rowCount } = await db.query(
    `update clients set
       name = $2, owner_user_id = $3, channels = $4, services = $5, notes = $6,
       reference_number = $7, short_code = $8, specialty = $9, legal_name = $10, public_name = $11, address = $12, contact_email = $13, contact_phone = $14,
       enquiry_owner_user_id = $15, notification_owner_user_id = $16, administration_owner_user_id = $17,
       updated_by = $18, updated_at = now()
     where id = $1`,
    [
      id, input.name, input.ownerUserId, input.channels, cleanServices(input.services), input.notes,
      input.referenceNumber ?? null, input.shortCode ?? null, input.specialty ?? null, input.legalName ?? null, input.publicName ?? null, input.address ?? null, input.contactEmail ?? null, input.contactPhone ?? null,
      input.enquiryOwnerUserId ?? null, input.notificationOwnerUserId ?? null, input.administrationOwnerUserId ?? null, actorUserId,
    ],
  );
  if (!rowCount) throw new RegistryRuleError("Client was not saved. You may not have permission to change it.");
  await recordAudit(db, { actorType: "staff", actorUserId, action: "client.update", targetType: "client", targetId: id, clientId: id, outcome: "success", metadata: { fields: ["profile", "services", "owner", "operational_contacts"] } });
}

function cleanServices(value: string | null | undefined): string | null {
  const text = value?.trim() || null;
  if (text && text.length > 2000) throw new RegistryRuleError("Services must be 2000 characters or fewer.");
  return text;
}

/** Soft archive. Every linked record is retained. */
export async function archiveClient(db: Queryable, id: string, actorUserId: string): Promise<void> {
  const { rowCount } = await db.query("update clients set status = 'archived', archived_at = now(), updated_at = now(), updated_by = $2 where id = $1 and status = 'active'", [id, actorUserId]);
  if (!rowCount) return;
  await recordAudit(db, { actorType: "staff", actorUserId, action: "client.archive", targetType: "client", targetId: id, clientId: id, outcome: "success" });
  await recordTimeline(db, { clientId: id, eventType: "client_archived", title: "Client archived", relatedType: null, relatedId: null, actorUserId, dedupeKey: `client_archived:${id}:${Date.now()}` });
}

export async function restoreClient(db: Queryable, id: string, actorUserId: string): Promise<void> {
  await db.query("update clients set status = 'active', archived_at = null, updated_at = now(), updated_by = $2 where id = $1", [id, actorUserId]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "client.restore", targetType: "client", targetId: id, clientId: id, outcome: "success" });
}

// --- Websites ---------------------------------------------------------------

export async function listWebsites(db: Queryable, clientId: string): Promise<WebsiteRow[]> {
  const { rows } = await db.query<WebsiteRow>("select * from websites where client_id = $1 order by status, created_at", [clientId]);
  return rows;
}

/** The stored client owns the website. A caller-supplied client id cannot replace it. */
export async function requireWebsiteForClient(db: Queryable, websiteId: string, clientId: string): Promise<WebsiteRow> {
  const { rows } = await db.query<WebsiteRow>("select * from websites where id = $1 and client_id = $2", [websiteId, clientId]);
  const site = rows[0];
  if (!site) throw new RegistryRuleError("That website is not available for this client.");
  return site;
}

export async function createWebsite(
  db: Queryable,
  input: { clientId: string; name: string; url: string | null; platform: string; environment: WebsiteRow["environment"]; notes: string | null },
  actorUserId: string,
): Promise<WebsiteRow> {
  const client = (await db.query<{ slug: string }>("select slug from clients where id = $1", [input.clientId])).rows[0];
  if (!client) throw new RegistryRuleError("Website was not saved. You may not have permission to change it.");
  const taken = new Set((await db.query<{ enquiry_key: string }>("select enquiry_key from websites where enquiry_key is not null")).rows.map((row) => row.enquiry_key));
  const enquiryKey = enquiryKeyForClient(client.slug, input.environment, taken);
  const { rows } = await db.query<WebsiteRow>(
    "insert into websites (client_id, name, url, platform, environment, notes, enquiry_key) values ($1, $2, $3, $4, $5, $6, $7) returning *",
    [input.clientId, input.name, input.url, input.platform, input.environment, input.notes, enquiryKey],
  );
  const site = rows[0];
  if (!site) throw new RegistryRuleError("Website was not saved. You may not have permission to change it.");
  await recordAudit(db, { actorType: "staff", actorUserId, action: "website.create", targetType: "website", targetId: site.id, clientId: input.clientId, outcome: "success", metadata: { environment: input.environment } });
  return site;
}

export async function updateWebsite(
  db: Queryable,
  id: string,
  input: { name: string; url: string | null; platform: string; environment: WebsiteRow["environment"]; status: WebsiteRow["status"]; notes: string | null; blogRequirements?: WebsiteRow["blog_requirements"] | null },
  actorUserId: string,
): Promise<void> {
  const { rows } = await db.query<WebsiteRow>(
    `update websites set name = $2, url = $3, platform = $4, environment = $5, status = $6, notes = $7,
       blog_requirements = coalesce($8::jsonb, blog_requirements),
       archived_at = case when $6 = 'archived' and archived_at is null then now() when $6 = 'active' then null else archived_at end
     where id = $1 returning *`,
    [id, input.name, input.url, input.platform, input.environment, input.status, input.notes, input.blogRequirements ? JSON.stringify(input.blogRequirements) : null],
  );
  const site = rows[0];
  if (!site) throw new RegistryRuleError("Website was not saved. You may not have permission to change it.");
  await recordAudit(db, { actorType: "staff", actorUserId, action: "website.update", targetType: "website", targetId: id, clientId: site.client_id, outcome: "success", metadata: { status: input.status } });
}

/** Staff who manage the registry can point this website at its own enquiry rows. */
export async function setWebsiteEnquiryKey(db: Queryable, websiteId: string, clientId: string, enquiryKey: string, actorUserId: string): Promise<void> {
  await requireWebsiteForClient(db, websiteId, clientId);
  const client = (await db.query<{ slug: string }>("select slug from clients where id = $1", [clientId])).rows[0];
  if (!client) throw new RegistryRuleError("That website is not available for this client.", "enquiryKey");
  assertEnquiryKeyForSlug(client.slug, enquiryKey);
  const clash = (await db.query<{ id: string }>("select id from websites where enquiry_key = $1 and id <> $2", [enquiryKey, websiteId])).rows[0];
  if (clash) throw new RegistryRuleError("That enquiry key is already used by another website.", "enquiryKey");
  const { rowCount } = await db.query("update websites set enquiry_key = $2 where id = $1 and client_id = $3", [websiteId, enquiryKey, clientId]);
  if (!rowCount) throw new RegistryRuleError("Website was not saved. You may not have permission to change it.", "enquiryKey");
  await recordAudit(db, { actorType: "staff", actorUserId, action: "website.enquiry_key", targetType: "website", targetId: websiteId, clientId, outcome: "success", metadata: { enquiryKey } });
}

// --- Account references -----------------------------------------------------

export async function listAccountReferences(db: Queryable, clientId: string, includeInactive = false): Promise<AccountReferenceRow[]> {
  const { rows } = await db.query<AccountReferenceRow>(
    `select r.*, u.display_name as owner_name
     from account_references r
     left join staff_users u on u.id = r.owner_user_id
     where r.client_id = $1 and ($2 or r.active)
     order by r.kind, r.label`,
    [clientId, includeInactive],
  );
  return rows;
}

export interface AccountReferenceInput {
  kind: string;
  label: string;
  externalIdentifier: string | null;
  url: string | null;
  vaultReference: string | null;
  notes: string | null;
  ownerUserId?: string | null;
}

const SECRET_LIKE = /(password|passwd|secret|api[-_ ]?key|token)\s*[:=]/i;

export class RegistryRuleError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "RegistryRuleError";
    this.field = field;
  }
}

const ENQUIRY_KEY = /^[a-z0-9-]{1,64}$/;

/** The key is `{slug}-{environment}`. It names this website's enquiry rows. It is not a message. */
export function enquiryKeyForClient(slug: string, environment: string, taken: ReadonlySet<string>): string {
  const base = `${slug}-${environment}`.toLowerCase().slice(0, 64);
  if (!ENQUIRY_KEY.test(base)) throw new RegistryRuleError("A website key could not be chosen.");
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const key = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!taken.has(key)) return key;
  }
  throw new RegistryRuleError("A website key could not be chosen.");
}

/** A key may name only the website's own client. Another clinic's key is refused. */
export function assertEnquiryKeyForSlug(slug: string, key: string): void {
  if (!ENQUIRY_KEY.test(key) || (key !== slug && !key.startsWith(`${slug}-`))) {
    throw new RegistryRuleError("The enquiry key has to start with this client's slug.", "enquiryKey");
  }
}

/** Rejects values that look like credentials. References point to a vault entry; they never hold the secret. */
export function assertNoSecret(input: AccountReferenceInput): void {
  for (const v of [input.externalIdentifier, input.vaultReference, input.notes, input.label]) {
    if (v && SECRET_LIKE.test(v)) throw new RegistryRuleError("This looks like a credential. Store the secret in the password vault and save only its reference here.");
  }
}

export async function createAccountReference(db: Queryable, clientId: string, input: AccountReferenceInput, actorUserId: string): Promise<AccountReferenceRow> {
  assertNoSecret(input);
  const { rows } = await db.query<AccountReferenceRow>(
    `with inserted as (
       insert into account_references (client_id, kind, label, external_identifier, url, vault_reference, notes, owner_user_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *
     )
     select i.*, u.display_name as owner_name from inserted i left join staff_users u on u.id = i.owner_user_id`,
    [clientId, input.kind, input.label, input.externalIdentifier, input.url, input.vaultReference, input.notes, input.ownerUserId ?? null],
  );
  const created = rows[0];
  if (!created) throw new RegistryRuleError("Reference was not saved. You may not have permission to change it.");
  await recordAudit(db, { actorType: "staff", actorUserId, action: "account_reference.create", targetType: "account_reference", targetId: created.id, clientId, outcome: "success", metadata: { kind: input.kind } });
  return created;
}

export async function updateAccountReference(db: Queryable, id: string, input: AccountReferenceInput & { active: boolean }, actorUserId: string): Promise<void> {
  assertNoSecret(input);
  const { rows } = await db.query<AccountReferenceRow>(
    `with updated as (
       update account_references set kind = $2, label = $3, external_identifier = $4, url = $5, vault_reference = $6, notes = $7, active = $8, owner_user_id = $9, updated_at = now()
       where id = $1 returning *
     )
     select i.*, u.display_name as owner_name from updated i left join staff_users u on u.id = i.owner_user_id`,
    [id, input.kind, input.label, input.externalIdentifier, input.url, input.vaultReference, input.notes, input.active, input.ownerUserId ?? null],
  );
  const ref = rows[0];
  if (!ref) throw new RegistryRuleError("Reference was not saved. You may not have permission to change it.");
  await recordAudit(db, { actorType: "staff", actorUserId, action: "account_reference.update", targetType: "account_reference", targetId: id, clientId: ref.client_id, outcome: "success", metadata: { kind: input.kind, active: input.active } });
}

// --- Client contacts --------------------------------------------------------

export async function listClientContacts(db: Queryable, clientId: string, includeInactive = false): Promise<ClientContactRow[]> {
  const { rows } = await db.query<ClientContactRow>(
    "select * from client_contacts where client_id = $1 and ($2 or active) order by is_primary desc, name",
    [clientId, includeInactive],
  );
  return rows;
}

export interface ClientContactInput {
  name: string;
  designation: string | null;
  workEmail: string | null;
  workPhone: string | null;
  isPrimary: boolean;
}

async function clearOtherPrimaryContacts(db: Queryable, clientId: string, exceptId: string | null): Promise<void> {
  await db.query("update client_contacts set is_primary = false, updated_at = now() where client_id = $1 and is_primary and ($2::uuid is null or id <> $2)", [clientId, exceptId]);
}

export async function createClientContact(db: Queryable, clientId: string, input: ClientContactInput, actorUserId: string): Promise<ClientContactRow> {
  if (input.isPrimary) await clearOtherPrimaryContacts(db, clientId, null);
  const { rows } = await db.query<ClientContactRow>(
    `insert into client_contacts (client_id, name, designation, work_email, work_phone, is_primary, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $7) returning *`,
    [clientId, input.name, input.designation, input.workEmail, input.workPhone, input.isPrimary, actorUserId],
  );
  await recordAudit(db, { actorType: "staff", actorUserId, action: "client_contact.create", targetType: "client_contact", targetId: rows[0]!.id, clientId, outcome: "success", metadata: { primary: input.isPrimary } });
  return rows[0]!;
}

export async function updateClientContact(db: Queryable, id: string, input: ClientContactInput & { active: boolean }, actorUserId: string): Promise<void> {
  const current = (await db.query<{ client_id: string }>("select client_id from client_contacts where id = $1", [id])).rows[0];
  if (!current) return;
  const primary = input.active && input.isPrimary;
  if (primary) await clearOtherPrimaryContacts(db, current.client_id, id);
  await db.query(
    `update client_contacts set name = $2, designation = $3, work_email = $4, work_phone = $5, is_primary = $6, active = $7, updated_by = $8, updated_at = now() where id = $1`,
    [id, input.name, input.designation, input.workEmail, input.workPhone, primary, input.active, actorUserId],
  );
  await recordAudit(db, { actorType: "staff", actorUserId, action: "client_contact.update", targetType: "client_contact", targetId: id, clientId: current.client_id, outcome: "success", metadata: { primary, active: input.active } });
}

// --- Staff and memberships --------------------------------------------------

export async function listStaff(db: Queryable): Promise<StaffRow[]> {
  const { rows } = await db.query<StaffRow>(
    `select u.id, u.email, u.display_name, u.platform_role, u.active,
            (select count(*)::int from memberships m where m.user_id = u.id and m.active) as membership_count
     from staff_users u order by u.active desc, u.display_name`,
  );
  return rows;
}

export async function listActiveStaff(db: Queryable): Promise<Array<{ id: string; display_name: string; platform_role: PlatformRole }>> {
  const { rows } = await db.query("select id, display_name, platform_role from staff_users where active order by display_name");
  return rows;
}

export async function createStaff(db: Queryable, input: { email: string; displayName: string; role: PlatformRole }, actorUserId: string | null): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  const { rows } = await db.query<{ id: string }>("insert into staff_users (email, display_name, platform_role) values ($1, $2, $3) returning id", [email, input.displayName.trim(), input.role]);
  await recordAudit(db, { actorType: actorUserId ? "staff" : "system", actorUserId, action: "staff.create", targetType: "staff_user", targetId: rows[0]!.id, outcome: "success", metadata: { role: input.role } });
  return rows[0]!.id;
}

export async function updateOwnName(db: Queryable, userId: string, displayName: string): Promise<void> {
  const name = displayName.trim();
  if (!name) throw new Error("Enter your name.");
  const { rowCount } = await db.query("update staff_users set display_name = $2 where id = $1 and active", [userId, name.slice(0, 120)]);
  if (!rowCount) throw new Error("Your name could not be saved.");
  await recordAudit(db, { actorType: "staff", actorUserId: userId, action: "staff.update", targetType: "staff_user", targetId: userId, outcome: "success", metadata: { fields: ["display_name"] } });
}

export async function updateStaff(db: Queryable, userId: string, input: { displayName: string; role: PlatformRole; active: boolean }, actorUserId: string): Promise<{ sessionsRevoked: number }> {
  const before = (await db.query<{ platform_role: string; active: boolean }>("select platform_role, active from staff_users where id = $1", [userId])).rows[0];
  const { rowCount } = await db.query(
    "update staff_users set display_name = $2, platform_role = $3, active = $4, deactivated_at = case when $4 then null else coalesce(deactivated_at, now()) end where id = $1",
    [userId, input.displayName.trim(), input.role, input.active],
  );
  if (!rowCount) throw new RegistryRuleError("Staff record was not changed.");
  let sessionsRevoked = 0;
  if (!input.active) {
    const removed = await db.query<{ revoked: number }>("select revoke_staff_sessions($1) as revoked", [userId]);
    sessionsRevoked = removed.rows[0]?.revoked ?? 0;
  }
  await recordAudit(db, {
    actorType: "staff",
    actorUserId,
    action: "staff.update",
    targetType: "staff_user",
    targetId: userId,
    outcome: "success",
    metadata: { roleFrom: before?.platform_role, roleTo: input.role, activeFrom: before?.active, activeTo: input.active, sessionsRevoked },
  });
  return { sessionsRevoked };
}

export async function listMemberships(db: Queryable, clientId: string): Promise<MembershipRow[]> {
  const { rows } = await db.query<MembershipRow>(
    `select m.id, m.user_id, m.client_id, m.active, m.created_at, u.email as user_email, u.display_name as user_name, u.platform_role as user_role
     from memberships m join staff_users u on u.id = m.user_id where m.client_id = $1 and m.active order by u.display_name`,
    [clientId],
  );
  return rows;
}

export async function listMembershipsForUser(db: Queryable, userId: string): Promise<Array<{ id: string; client_id: string; client_name: string }>> {
  const { rows } = await db.query("select m.id, m.client_id, c.name as client_name from memberships m join clients c on c.id = m.client_id where m.user_id = $1 and m.active order by c.name", [userId]);
  return rows;
}

export async function grantMembership(db: Queryable, input: { userId: string; clientId: string }, actorUserId: string | null): Promise<string> {
  const existing = await db.query<{ id: string }>("select id from memberships where user_id = $1 and client_id = $2 and active", [input.userId, input.clientId]);
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows } = await db.query<{ id: string }>("insert into memberships (user_id, client_id, granted_by) values ($1, $2, $3) returning id", [input.userId, input.clientId, actorUserId]);
  const id = rows[0]?.id;
  if (!id) throw new RegistryRuleError("That assignment was not saved.");
  await recordAudit(db, { actorType: actorUserId ? "staff" : "system", actorUserId, action: "membership.grant", targetType: "membership", targetId: id, clientId: input.clientId, outcome: "success", metadata: { userId: input.userId } });
  return id;
}

export async function revokeMembership(db: Queryable, membershipId: string, actorUserId: string, expectedClientId?: string): Promise<void> {
  const current = await db.query<{ client_id: string }>("select client_id from memberships where id = $1 and active", [membershipId]);
  const owner = current.rows[0];
  if (!owner || (expectedClientId && owner.client_id !== expectedClientId)) throw new RegistryRuleError("That assignment was not changed.");
  const { rows } = await db.query<{ client_id: string; user_id: string }>("update memberships set active = false, revoked_at = now() where id = $1 and active returning client_id, user_id", [membershipId]);
  const removed = rows[0];
  if (!removed) throw new RegistryRuleError("That assignment was not changed.");
  await recordAudit(db, { actorType: "staff", actorUserId, action: "membership.revoke", targetType: "membership", targetId: membershipId, clientId: removed.client_id, outcome: "success", metadata: { userId: removed.user_id } });
}

export interface ClientFileLinkRow {
  id: string;
  client_id: string;
  title: string;
  url: string;
  notes: string | null;
  active: boolean;
  created_at: Date;
}

export async function listClientFileLinks(db: Queryable, clientId: string): Promise<ClientFileLinkRow[]> {
  const { rows } = await db.query<ClientFileLinkRow>(
    "select id, client_id, title, url, notes, active, created_at from client_file_links where client_id = $1 and active order by created_at, title",
    [clientId],
  );
  return rows;
}

export function externalFileUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new RegistryRuleError("Enter an https link.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new RegistryRuleError("Enter an https link without a username or password.");
  if (parsed.href.length > 2000) throw new RegistryRuleError("That link is too long.");
  return parsed.href;
}

export async function createClientFileLink(db: Queryable, clientId: string, input: { title: string; url: string; notes: string | null }, actorUserId: string): Promise<string> {
  const title = input.title.trim();
  if (!title || title.length > 160) throw new RegistryRuleError("Enter a title of 160 characters or fewer.");
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 2000) throw new RegistryRuleError("Notes must be 2000 characters or fewer.");
  const url = externalFileUrl(input.url);
  const { rows } = await db.query<{ id: string }>(
    "insert into client_file_links (client_id, title, url, notes, created_by) values ($1, $2, $3, $4, $5) returning id",
    [clientId, title, url, notes, actorUserId],
  );
  const id = rows[0]?.id;
  if (!id) throw new RegistryRuleError("The file link was not saved.");
  await recordAudit(db, { actorType: "staff", actorUserId, action: "client_file_link.create", targetType: "client_file_link", targetId: id, clientId, outcome: "success", metadata: { kind: "external_link" } });
  return id;
}

export async function archiveClientFileLink(db: Queryable, id: string, clientId: string, actorUserId: string): Promise<void> {
  const { rowCount } = await db.query("update client_file_links set active = false where id = $1 and client_id = $2 and active", [id, clientId]);
  if (!rowCount) throw new RegistryRuleError("The file link was not changed.");
  await recordAudit(db, { actorType: "staff", actorUserId, action: "client_file_link.archive", targetType: "client_file_link", targetId: id, clientId, outcome: "success", metadata: { kind: "external_link" } });
}
