/**
 * Enquiry and notification fixture for signed-in performance baselines.
 *
 * It reuses the schema and the guards of the standard enquiry fixture and loads a larger dataset into
 * a separate isolated database, so the stored batch-08 fixture is untouched. Every row is synthetic:
 * `is_synthetic` is true, contacts are under example.invalid, and no production enquiry is read or
 * copied. Notification rows are stored states only; nothing is sent.
 *
 * Clinic ids match the platform fixture's client slugs and website_key matches its `websites.enquiry_key`,
 * because that is how apps/platform/src/lib/form-submissions.ts joins the two databases.
 */
import pg from "pg";
import { assertEnquiryFixtureUrl } from "./targets";
import { ENQUIRY_FIXTURE_SCHEMA } from "./enquiry-fixture";
import { FIXTURE_CLIENTS, FIXTURE_WEBSITES, anchorDateSgt } from "./perf-fixture";

export const PERF_ENQUIRY_FIXTURE_VERSION = "perf-enquiry-2";

/**
 * Only Clinic A has database enquiries. Clinic B's production website is Wix-sourced, and D31 gives a
 * website one source, so its enquiries come from the Wix mock instead. That also covers D36: two
 * connectors on one page, Clinic A from the database and Clinic B from Wix. Clinic C has none at all.
 *
 * 60 rows is three pages at 25 per page, across two website keys so the website filter has options.
 */
export const PERF_ENQUIRY_COUNTS = { a: 60 } as const;

const STATUSES = ["new", "acknowledged", "closed"] as const;

/**
 * Stored notification states. "processing" is not a stored status: the platform derives it from a
 * pending row whose lease is still in the future, so that is how it is represented here.
 */
const NOTIFICATION_STATES = [
  { kind: "sent", status: "sent", attempts: 1, error: null, leased: false },
  { kind: "failed", status: "failed", attempts: 2, error: "sink_rejected", leased: false },
  { kind: "exhausted", status: "exhausted", attempts: 5, error: "sink_rejected", leased: false },
  { kind: "pending", status: "pending", attempts: 0, error: null, leased: false },
  { kind: "processing", status: "pending", attempts: 1, error: null, leased: true },
  { kind: "unconfigured", status: "unconfigured", attempts: 0, error: "mailbox_unconfigured", leased: false },
  { kind: "none", status: null, attempts: 0, error: null, leased: false },
] as const;

export interface PerfEnquiryFixtureSummary {
  version: string;
  database: string;
  anchorDate: string;
  enquiries: number;
  notifications: number;
  byStatus: Record<string, number>;
  byNotificationState: Record<string, number>;
  clinics: string[];
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function uuid(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

interface Row {
  id: string;
  reference: string;
  clinicId: string;
  websiteKey: string;
  formKey: string;
  name: string;
  email: string | null;
  contactNumber: string;
  status: (typeof STATUSES)[number];
  attribution: string;
  createdAt: string;
  state: (typeof NOTIFICATION_STATES)[number];
  outboxId: string;
}

/**
 * Builds the dataset. Spread over the 60 days before the anchor so the default 30-day window has rows
 * and the comparison window before it does too.
 */
export function perfEnquiryRows(anchor: string): Row[] {
  const rows: Row[] = [];
  const clinics = [
    { id: FIXTURE_CLIENTS.a.slug, websiteKeys: [FIXTURE_WEBSITES.aProduction.enquiryKey, FIXTURE_WEBSITES.aStaging.enquiryKey], count: PERF_ENQUIRY_COUNTS.a, prefix: "a1000000", letter: "A" },
  ];
  let index = 0;
  for (const clinic of clinics) {
    for (let i = 0; i < clinic.count; i += 1) {
      index += 1;
      const status = STATUSES[i % STATUSES.length]!;
      const state = NOTIFICATION_STATES[i % NOTIFICATION_STATES.length]!;
      const dayOffset = -(i * 59) / Math.max(1, clinic.count - 1);
      rows.push({
        id: uuid(clinic.prefix, index),
        reference: `TEST-${clinic.letter}-${String(i + 1).padStart(3, "0")}`,
        clinicId: clinic.id,
        websiteKey: clinic.websiteKeys[i % clinic.websiteKeys.length]!,
        formKey: i % 3 === 0 ? "contact" : "appointment-enquiry",
        name: `Test Person ${clinic.letter}${i + 1}`,
        email: i % 7 === 0 ? null : `person.${clinic.letter.toLowerCase()}${i + 1}@example.invalid`,
        contactNumber: "00000000",
        status,
        attribution: (["direct", "organic", "referral", "campaign"] as const)[i % 4]!,
        createdAt: `${addDays(anchor, Math.round(dayOffset))}T02:00:00.000Z`,
        state,
        outboxId: uuid("c1000000", index),
      });
    }
  }
  return rows;
}

export async function resetPerfEnquiryFixture(url: string, now: Date = new Date()): Promise<PerfEnquiryFixtureSummary> {
  const target = assertEnquiryFixtureUrl(url);
  if (!target.database.includes("perf")) {
    throw new Error("Refusing the performance enquiry fixture: the database name does not contain perf.");
  }
  const anchor = anchorDateSgt(now);
  const rows = perfEnquiryRows(anchor);
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    const existing = await client.query<{ clinics: string | null }>("select to_regclass('public.clinics')::text as clinics");
    if (existing.rows[0]?.clinics) {
      const stored = await client.query("select 1 from enquiries where public_reference not like 'TEST-%' limit 1");
      if ((stored.rowCount ?? 0) > 0) {
        throw new Error("Refusing the performance enquiry fixture: rows outside the fixture are present.");
      }
    }
    await client.query("begin");
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
    await client.query(ENQUIRY_FIXTURE_SCHEMA);
    for (const clinic of [{ id: FIXTURE_CLIENTS.a.slug, name: FIXTURE_CLIENTS.a.name }]) {
      await client.query("insert into clinics (id, display_name, is_synthetic) values ($1, $2, true)", [clinic.id, clinic.name]);
    }
    for (const row of rows) {
      await client.query(
        `insert into enquiries (
           id, public_reference, clinic_id, website_key, form_key, form_version, idempotency_key, payload_digest,
           name, contact_number, email, message, page_path, reason, attribution_source, notice_version,
           consent_acknowledged_at, status, is_synthetic, created_at
         ) values ($1, $2, $3, $4, $5, 1, $6, 'fixture', $7, $8, $9,
           'Synthetic performance fixture enquiry. No real appointment and no real person.',
           $10, 'general-enquiry', $11, 'fixture-notice-v1', $12, $13, true, $12)`,
        [row.id, row.reference, row.clinicId, row.websiteKey, row.formKey, `perf-${row.id}`, row.name, row.contactNumber, row.email, `/${row.formKey}`, row.attribution, row.createdAt, row.status],
      );
      if (!row.state.status) continue;
      await client.query(
        `insert into notification_outbox (
           id, enquiry_id, clinic_id, event_type, recipient_ref, status, attempts, max_attempts,
           next_attempt_at, leased_until, provider, provider_message_id, last_error_code,
           created_at, updated_at, sent_at
         ) values ($1, $2, $3, 'clinic_notification', 'fixture-mailbox@example.invalid', $4, $5, 5,
           case when $4 in ('failed', 'pending') then $6::timestamptz else null end,
           case when $7 then now() + interval '10 minutes' else null end,
           'fixture-sink', case when $4 = 'sent' then 'fixture-message' else null end, $8,
           $6, $6, case when $4 = 'sent' then $6::timestamptz else null end)`,
        [row.outboxId, row.id, row.clinicId, row.state.status, row.state.attempts, row.createdAt, row.state.leased, row.state.error],
      );
    }
    await client.query("commit");
    await client.query("analyze");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  const byStatus: Record<string, number> = {};
  const byNotificationState: Record<string, number> = {};
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    byNotificationState[row.state.kind] = (byNotificationState[row.state.kind] ?? 0) + 1;
  }
  return {
    version: PERF_ENQUIRY_FIXTURE_VERSION,
    database: target.database,
    anchorDate: anchor,
    enquiries: rows.length,
    notifications: rows.filter((row) => row.state.status).length,
    byStatus,
    byNotificationState,
    clinics: [FIXTURE_CLIENTS.a.slug],
  };
}
