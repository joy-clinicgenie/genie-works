/**
 * Creates the staging enquiry tables and two restricted roles.
 * Connects only with ENQUIRY_STAGING_ADMIN_URL, and only when that URL names
 * clinic_genie_enquiry_staging. The owner credential is not saved as an
 * application credential. No mail is sent.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadRootEnv } from "../src/env";
import { assertStagingEnquiryAdminUrl, ENQUIRY_STAGING_DATABASE } from "../src/testing/targets";

const INTAKE_ROLE = "cg_enquiry_intake";
const STAFF_ROLE = "cg_enquiry_staff";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENV_FILE = join(ROOT, ".env");

const SCHEMA = `
create table clinics (
  id text primary key,
  display_name text not null,
  is_synthetic boolean not null default false
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
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  unique (clinic_id, idempotency_key)
);

create table notification_outbox (
  id uuid primary key default gen_random_uuid(),
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notification_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references notification_outbox (id),
  attempted_at timestamptz not null,
  outcome text not null check (outcome in ('sent', 'failed', 'unconfigured')),
  provider text,
  provider_message_id text,
  error_code text,
  error_message text,
  triggered_by text not null
);

create index enquiries_clinic_created_idx on enquiries (clinic_id, created_at desc);
create index enquiries_website_key_idx on enquiries (website_key);
create index notification_outbox_enquiry_idx on notification_outbox (enquiry_id, updated_at desc);
`;

loadRootEnv();
const adminUrl = process.env.ENQUIRY_STAGING_ADMIN_URL?.trim() ?? "";
if (!adminUrl) {
  throw new Error("ENQUIRY_STAGING_ADMIN_URL is empty. Add the staging owner connection in .env. The value is not requested here.");
}
const target = assertStagingEnquiryAdminUrl(adminUrl);

function safeError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "Staging enquiry setup failed.";
  return new Error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[connection string omitted]"));
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Refusing: the role name is not a plain identifier.");
  return `"${name}"`;
}

function applicationUrl(role: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${ENQUIRY_STAGING_DATABASE}`;
  return url.toString();
}

function rememberApplicationUrl(key: string, value: string): void {
  const text = readFileSync(ENV_FILE, "utf8");
  const line = `${key}=${value}`;
  const lines = text.split(/\n/);
  let found = false;
  const next = lines.map((entry) => {
    if (!entry.startsWith(`${key}=`)) return entry;
    found = true;
    return line;
  });
  if (!found) next.push(line);
  const body = next.join("\n");
  writeFileSync(ENV_FILE, body.endsWith("\n") ? body : `${body}\n`);
}

async function ensureRole(client: pg.Client, role: string, envKey: string): Promise<"created" | "kept"> {
  const existing = await client.query("select 1 from pg_roles where rolname = $1", [role]);
  if ((existing.rowCount ?? 0) > 0) return "kept";
  const password = randomBytes(24).toString("base64url");
  await client.query(`create role ${quoteIdent(role)} login nosuperuser nocreatedb nocreaterole nobypassrls password '${password}'`);
  rememberApplicationUrl(envKey, applicationUrl(role, password));
  return "created";
}

async function applyGrants(client: pg.Client): Promise<void> {
  const intake = quoteIdent(INTAKE_ROLE);
  const staff = quoteIdent(STAFF_ROLE);
  await client.query(`revoke all on database ${ENQUIRY_STAGING_DATABASE} from public`);
  await client.query(`grant connect on database ${ENQUIRY_STAGING_DATABASE} to ${intake}, ${staff}`);
  await client.query("revoke all on schema public from public");
  await client.query(`grant usage on schema public to ${intake}, ${staff}`);
  await client.query("revoke all on all tables in schema public from public");
  await client.query(`grant select, insert on clinics, enquiries, notification_outbox, notification_attempts to ${intake}`);
  await client.query(`grant update on notification_outbox, notification_attempts to ${intake}`);
  await client.query(`grant select on clinics, enquiries, notification_outbox, notification_attempts to ${staff}`);
  await client.query(`grant update (status) on enquiries to ${staff}`);
  await client.query(`grant update (status, next_attempt_at, leased_until, updated_at) on notification_outbox to ${staff}`);
}

const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  const current = await client.query<{ database: string; role: string }>("select current_database() as database, current_user as role");
  const database = current.rows[0]?.database;
  const role = current.rows[0]?.role;
  if (database !== ENQUIRY_STAGING_DATABASE) throw new Error("Refusing staging enquiry setup: the connection is not clinic_genie_enquiry_staging.");
  if (role !== "neondb_owner") throw new Error(`Refusing staging enquiry setup: the connected role is ${role ?? "unknown"}.`);
  const existing = await client.query<{ name: string | null }>("select to_regclass('public.enquiries')::text as name");
  if (!existing.rows[0]?.name) {
    await client.query("begin");
    await client.query(SCHEMA);
    await client.query("commit");
  }
  const intake = await ensureRole(client, INTAKE_ROLE, "ENQUIRY_STAGING_INTAKE_URL");
  const staff = await ensureRole(client, STAFF_ROLE, "ENQUIRY_STAGING_STAFF_URL");
  await applyGrants(client);
  console.log(`Staging enquiry database: ${target.database}`);
  console.log("Host: remote");
  console.log(`Connected role: ${role}`);
  console.log(`Tables: ${existing.rows[0]?.name ? "already present" : "created"}`);
  console.log(`Website role ${INTAKE_ROLE}: ${intake}`);
  console.log(`Genie Works role ${STAFF_ROLE}: ${staff}`);
  console.log("Application URLs were stored in .env. Values were not printed. ENQUIRY_DATABASE_URL was not changed.");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw safeError(error);
} finally {
  await client.end().catch(() => undefined);
}
