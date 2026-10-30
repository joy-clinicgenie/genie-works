/**
 * Synthetic enquiry and notification fixture.
 *
 * The row shape matches the queries in apps/platform/src/lib/form-submissions.ts
 * and the outbox fields described in the sibling lifecycle document.
 * The sibling SQL migrations (packages/platform/src/db/migrations) and
 * submitEnquiry service are not in that checkout, so this schema is provisional
 * against the missing source. It is not proof that website intake or
 * deduplication processing works.
 */
import pg from "pg";
import { loadRootEnv, requireEnv } from "../env";
import {
  ENQUIRY_FIXTURE_DATABASE,
  assertEnquiryFixtureUrl,
  enquiryFixtureUrlFromAdmin,
  maintenanceUrl,
} from "./targets";

const SCHEMA = `
create table clinics (
  id text primary key,
  display_name text not null,
  is_synthetic boolean not null default true,
  constraint clinics_test_label check (is_synthetic)
);

create table enquiries (
  id uuid primary key default gen_random_uuid(),
  public_reference text not null unique,
  clinic_id text not null references clinics (id),
  website_key text,
  form_key text not null,
  form_version integer not null,
  idempotency_key text not null,
  payload_digest text not null,
  name text not null,
  contact_number text not null,
  email text,
  message text,
  page_path text,
  reason text not null,
  preferred_date date,
  preferred_time_window text,
  attribution_source text not null default 'direct' check (attribution_source in ('direct', 'organic', 'referral', 'campaign')),
  notice_version text not null,
  consent_acknowledged_at timestamptz,
  status text not null default 'new' check (status in ('new', 'acknowledged', 'closed')),
  is_synthetic boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clinic_id, idempotency_key),
  constraint enquiries_test_label check (is_synthetic)
);

create table notification_outbox (
  id uuid primary key,
  enquiry_id uuid not null references enquiries (id),
  clinic_id text not null references clinics (id),
  event_type text not null check (event_type in ('clinic_notification', 'visitor_acknowledgement')),
  recipient_ref text not null,
  status text not null check (status in ('pending', 'sent', 'failed', 'exhausted', 'unconfigured')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz,
  leased_until timestamptz,
  provider text,
  provider_message_id text,
  last_error_code text,
  last_error_message text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table notification_attempts (
  id uuid primary key,
  outbox_id uuid not null references notification_outbox (id),
  attempted_at timestamptz not null,
  outcome text not null check (outcome in ('sent', 'failed', 'unconfigured')),
  provider text,
  provider_message_id text,
  error_code text,
  error_message text,
  triggered_by text not null
);
`;

export interface EnquiryFixtureSummary {
  database: string;
  host: string;
  port: string;
  enquiries: number;
  notifications: number;
  clinics: string[];
  mailSink: "notification_outbox";
}

const CLINICS = [
  { id: "harbourview-dental", display_name: "Harbourview Dental (fictional test)" },
  { id: "meridian-skin", display_name: "Meridian Skin (fictional test)" },
  { id: "northgate-physio", display_name: "Northgate Physio (fictional test)" },
] as const;

const ENQUIRIES = [
  {
    id: "11111111-1111-4111-8111-111111111101",
    public_reference: "TEST-HV-NEW-001",
    clinic_id: "harbourview-dental",
    website_key: "harbourview-dental-wix",
    form_key: "appointment-enquiry",
    idempotency_key: "fixture-harbour-new-0001",
    name: "Test Person Harbour",
    email: "harbour.person@example.invalid",
    page_path: "/request-appointment",
    reason: "general-enquiry",
    attribution_source: "direct",
    status: "new",
    created_at: "2026-10-20T02:00:00.000Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111102",
    public_reference: "TEST-HV-ACK-002",
    clinic_id: "harbourview-dental",
    website_key: "harbourview-dental-wix",
    form_key: "contact",
    idempotency_key: "fixture-harbour-ack-0002",
    name: "Test Person Harbour Two",
    email: "harbour.two@example.invalid",
    page_path: "/contact",
    reason: "general-enquiry",
    attribution_source: "organic",
    status: "acknowledged",
    created_at: "2026-10-01T02:00:00.000Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111103",
    public_reference: "TEST-HV-CLOSED-003",
    clinic_id: "harbourview-dental",
    website_key: "harbourview-dental-wix",
    form_key: "appointment-enquiry",
    idempotency_key: "fixture-harbour-closed-0003",
    name: "Test Person Harbour Three",
    email: null,
    page_path: "/request-appointment",
    reason: "general-enquiry",
    attribution_source: "referral",
    status: "closed",
    created_at: "2026-09-15T02:00:00.000Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111104",
    public_reference: "TEST-MS-NEW-004",
    clinic_id: "meridian-skin",
    website_key: "meridian-skin-production",
    form_key: "appointment-enquiry",
    idempotency_key: "fixture-meridian-new-0004",
    name: "Test Person Meridian",
    email: "meridian.person@example.invalid",
    page_path: "/request-appointment",
    reason: "general-enquiry",
    attribution_source: "campaign",
    status: "new",
    created_at: "2026-10-27T02:00:00.000Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111105",
    public_reference: "TEST-MS-ACK-005",
    clinic_id: "meridian-skin",
    website_key: "meridian-skin-staging",
    form_key: "contact",
    idempotency_key: "fixture-meridian-ack-0005",
    name: "Test Person Meridian Two",
    email: "meridian.two@example.invalid",
    page_path: "/contact",
    reason: "general-enquiry",
    attribution_source: "direct",
    status: "acknowledged",
    created_at: "2026-10-10T02:00:00.000Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111106",
    public_reference: "TEST-NG-NEW-006",
    clinic_id: "northgate-physio",
    website_key: "northgate-physio-wix",
    form_key: "appointment-enquiry",
    idempotency_key: "fixture-northgate-new-0006",
    name: "Test Person Northgate",
    email: "northgate.person@example.invalid",
    page_path: "/request-appointment",
    reason: "general-enquiry",
    attribution_source: "organic",
    status: "new",
    created_at: "2026-10-05T02:00:00.000Z",
  },
] as const;

const OUTBOX = [
  { id: "22222222-2222-4222-8222-222222222201", enquiry_id: ENQUIRIES[0].id, clinic_id: "harbourview-dental", status: "sent", attempts: 1, error: null },
  { id: "22222222-2222-4222-8222-222222222202", enquiry_id: ENQUIRIES[1].id, clinic_id: "harbourview-dental", status: "failed", attempts: 2, error: "sink_rejected" },
  { id: "22222222-2222-4222-8222-222222222203", enquiry_id: ENQUIRIES[2].id, clinic_id: "harbourview-dental", status: "exhausted", attempts: 5, error: "sink_rejected" },
  { id: "22222222-2222-4222-8222-222222222204", enquiry_id: ENQUIRIES[3].id, clinic_id: "meridian-skin", status: "pending", attempts: 0, error: null },
  { id: "22222222-2222-4222-8222-222222222205", enquiry_id: ENQUIRIES[4].id, clinic_id: "meridian-skin", status: "sent", attempts: 1, error: null },
  { id: "22222222-2222-4222-8222-222222222206", enquiry_id: ENQUIRIES[5].id, clinic_id: "northgate-physio", status: "unconfigured", attempts: 0, error: "mailbox_unconfigured" },
] as const;

export const RETRY_SUCCESS_OUTBOX_ID = OUTBOX[1].id;
export const RETRY_FAILURE_OUTBOX_ID = OUTBOX[0].id;
export const HARBOUR_DUPLICATE_KEY = ENQUIRIES[0].idempotency_key;

export function resolveEnquiryFixtureUrl(): string {
  loadRootEnv();
  const derived = enquiryFixtureUrlFromAdmin(requireEnv("DATABASE_ADMIN_URL"));
  const configured = process.env.ENQUIRY_DATABASE_URL?.trim();
  if (!configured) return derived;
  const target = assertEnquiryFixtureUrl(configured);
  if (target.database !== ENQUIRY_FIXTURE_DATABASE) {
    throw new Error("Refusing enquiry fixture: ENQUIRY_DATABASE_URL must use the database clinic_genie_enquiry_test.");
  }
  return configured;
}

export async function ensureEnquiryDatabase(adminUrl: string): Promise<void> {
  const fixtureUrl = enquiryFixtureUrlFromAdmin(adminUrl);
  assertEnquiryFixtureUrl(fixtureUrl);
  const maint = new pg.Client({ connectionString: maintenanceUrl(adminUrl) });
  await maint.connect();
  try {
    const exists = await maint.query("select 1 from pg_database where datname = $1", [ENQUIRY_FIXTURE_DATABASE]);
    if (exists.rowCount === 0) await maint.query(`create database ${ENQUIRY_FIXTURE_DATABASE}`);
  } finally {
    await maint.end();
  }
}

async function applySchema(client: pg.PoolClient): Promise<void> {
  await client.query("drop schema if exists public cascade");
  await client.query("create schema public");
  await client.query(SCHEMA);
}

async function insertRows(client: pg.PoolClient): Promise<void> {
  for (const clinic of CLINICS) {
    await client.query("insert into clinics (id, display_name, is_synthetic) values ($1, $2, true)", [clinic.id, clinic.display_name]);
  }
  for (const row of ENQUIRIES) {
    await client.query(
      `insert into enquiries (
         id, public_reference, clinic_id, website_key, form_key, form_version, idempotency_key, payload_digest,
         name, contact_number, email, message, page_path, reason, preferred_date, preferred_time_window,
         attribution_source, notice_version, consent_acknowledged_at, status, is_synthetic, created_at
       ) values (
         $1, $2, $3, $4, $5, 1, $6, 'fixture',
         $7, '00000000', $8, 'Synthetic test enquiry. No real appointment.', $9, $10, null, 'morning',
         $11, 'fixture-notice-v1', $12, $13, true, $12
       )`,
      [row.id, row.public_reference, row.clinic_id, row.website_key, row.form_key, row.idempotency_key, row.name, row.email, row.page_path, row.reason, row.attribution_source, row.created_at, row.status],
    );
  }
  for (const row of OUTBOX) {
    await client.query(
      `insert into notification_outbox (
         id, enquiry_id, clinic_id, event_type, recipient_ref, status, attempts, max_attempts,
         next_attempt_at, provider, provider_message_id, last_error_code, created_at, updated_at, sent_at
       ) values (
         $1, $2, $3, 'clinic_notification', 'test-mailbox', $4, $5, 5,
         case when $4 in ('failed', 'pending') then $6::timestamptz else null end,
         'fixture-sink', case when $4 = 'sent' then 'fixture-message' else null end,
         $7, $6, $6, case when $4 = 'sent' then $6::timestamptz else null end
       )`,
      [row.id, row.enquiry_id, row.clinic_id, row.status, row.attempts, "2026-10-28T02:00:00.000Z", row.error],
    );
  }
  await client.query(
    `insert into notification_attempts (id, outbox_id, attempted_at, outcome, provider, provider_message_id, triggered_by)
     values ('33333333-3333-4333-8333-333333333301', $1, '2026-10-20T02:05:00.000Z', 'sent', 'fixture-sink', 'fixture-message', 'fixture-seed')`,
    [OUTBOX[0].id],
  );
}

export async function resetEnquiryFixture(url = resolveEnquiryFixtureUrl()): Promise<EnquiryFixtureSummary> {
  const target = assertEnquiryFixtureUrl(url);
  loadRootEnv();
  await ensureEnquiryDatabase(requireEnv("DATABASE_ADMIN_URL"));
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await applySchema(client);
    await insertRows(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  return summarize(url, target);
}

export async function checkEnquiryFixture(url = resolveEnquiryFixtureUrl()): Promise<EnquiryFixtureSummary> {
  const target = assertEnquiryFixtureUrl(url);
  return summarize(url, target);
}

async function summarize(url: string, target: { host: string; port: string; database: string }): Promise<EnquiryFixtureSummary> {
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 2000 });
  try {
    const enquiries = await pool.query<{ count: number }>("select count(*)::int as count from enquiries where is_synthetic");
    const notifications = await pool.query<{ count: number }>("select count(*)::int as count from notification_outbox where event_type = 'clinic_notification'");
    const clinics = await pool.query<{ id: string }>("select id from clinics order by id");
    return {
      database: target.database,
      host: target.host,
      port: target.port,
      enquiries: enquiries.rows[0]?.count ?? 0,
      notifications: notifications.rows[0]?.count ?? 0,
      clinics: clinics.rows.map((row) => row.id),
      mailSink: "notification_outbox",
    };
  } finally {
    await pool.end();
  }
}

/** Same statement as retryNotification. Returns the row only when a failed or exhausted notification is requeued. */
export async function requeueNotification(url: string, id: string, scope: string[] | null): Promise<{ id: string } | null> {
  assertEnquiryFixtureUrl(url);
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const result = await pool.query<{ id: string }>(
      `update notification_outbox
       set status = 'pending', next_attempt_at = now(), leased_until = null, updated_at = now()
       where id = $1
         and event_type = 'clinic_notification'
         and status in ('failed', 'exhausted')
         and ($2::text[] is null or clinic_id = any($2))
       returning id`,
      [id, scope],
    );
    return result.rows[0] ?? null;
  } finally {
    await pool.end();
  }
}
