/**
 * Read-only migration verification for migrations 0044, 0045, 0053 and 0054 (production readiness).
 *
 *   cd packages/db && npx tsx scripts/migration-verify.ts
 *
 * Uses DATABASE_ADMIN_URL (owner: schema_migrations has row level security with no policy, so the application role cannot
 * read it). Everything runs in ONE read-only transaction that is rolled back; nothing is written, created or changed.
 * Prints names, true/false and counts only: no connection string, no row content, no secret.
 *
 * It answers four separate questions, because "the table is missing" does not by itself mean "the migration did not run":
 *   1. History: is each file recorded in schema_migrations, and does its checksum match this checkout?
 *   2. Objects: does each object the migration creates exist?
 *   3. Drift: do history and objects disagree (recorded but missing, present but unrecorded, partly present)?
 *   4. Preconditions: what each pending migration needs from the existing schema, and the 0053 duplicate-lease check.
 *
 * A database that is not on this machine needs MIGRATION_VERIFY_REMOTE_CONFIRM set to its host name.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closePools, getAdminPool } from "../src/client";
import { databasePlace } from "../src/database-environment";
import { loadRootEnv, requireEnv } from "../src/env";

loadRootEnv();
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
const url = new URL(adminUrl);
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) && process.env.MIGRATION_VERIFY_REMOTE_CONFIRM !== url.hostname) {
  console.error(`Refusing: this database is not on this machine. Set MIGRATION_VERIFY_REMOTE_CONFIRM to its host name (${url.hostname}).`);
  process.exit(2);
}

type Check = { kind: "table" | "column" | "index" | "function" | "trigger" | "policy"; name: string; on?: string };

const MIGRATIONS: Record<string, { file: string; creates: Check[]; needs: Check[] }> = {
  "0044": {
    file: "0044_website_enquiry_forms.sql",
    creates: [
      { kind: "table", name: "website_enquiry_forms" },
      { kind: "index", name: "website_enquiry_forms_provider_idx" },
      { kind: "index", name: "website_enquiry_forms_client_idx" },
      { kind: "index", name: "website_enquiry_forms_website_idx" },
      { kind: "function", name: "website_enquiry_forms_owner_check" },
      { kind: "function", name: "website_enquiry_forms_admin_only" },
      { kind: "trigger", name: "website_enquiry_forms_owner_trg", on: "website_enquiry_forms" },
      { kind: "trigger", name: "website_enquiry_forms_admin_trg", on: "website_enquiry_forms" },
      ...["select", "insert", "update", "delete"].map((p) => ({ kind: "policy" as const, name: `website_enquiry_forms_${p}`, on: "website_enquiry_forms" })),
    ],
    needs: [
      ...["wix_instance_id", "wix_form_id", "wix_form_key", "wix_form_namespace", "wix_counts_in_totals", "enquiry_source"].map((c) => ({ kind: "column" as const, name: c, on: "websites" })),
      { kind: "table", name: "staff_users" },
      ...["app_is_admin", "app_can_access_client", "app_can_edit_client"].map((f) => ({ kind: "function" as const, name: f })),
    ],
  },
  "0045": {
    file: "0045_wix_inbox_messages.sql",
    creates: [
      { kind: "table", name: "wix_inbox_messages" },
      { kind: "table", name: "wix_inbox_coverage" },
      { kind: "index", name: "wix_inbox_messages_client_idx" },
      { kind: "index", name: "wix_inbox_messages_website_idx" },
      { kind: "index", name: "wix_inbox_messages_conversation_idx" },
      { kind: "function", name: "wix_inbox_owner_check" },
      { kind: "function", name: "wix_inbox_messages_append_only" },
      { kind: "trigger", name: "wix_inbox_messages_owner_trg", on: "wix_inbox_messages" },
      { kind: "trigger", name: "wix_inbox_coverage_owner_trg", on: "wix_inbox_coverage" },
      { kind: "trigger", name: "wix_inbox_messages_append_only_trg", on: "wix_inbox_messages" },
      { kind: "policy", name: "wix_inbox_messages_select", on: "wix_inbox_messages" },
      { kind: "policy", name: "wix_inbox_messages_insert", on: "wix_inbox_messages" },
      { kind: "policy", name: "wix_inbox_coverage_select", on: "wix_inbox_coverage" },
      { kind: "policy", name: "wix_inbox_coverage_insert", on: "wix_inbox_coverage" },
      { kind: "policy", name: "wix_inbox_coverage_update", on: "wix_inbox_coverage" },
    ],
    needs: [
      { kind: "column", name: "enquiry_source", on: "websites" },
      { kind: "column", name: "wix_instance_id", on: "websites" },
      { kind: "table", name: "staff_users" },
      ...["app_is_admin", "app_can_access_client"].map((f) => ({ kind: "function" as const, name: f })),
    ],
  },
  "0053": {
    file: "0053_analytics_scheduling.sql",
    creates: [
      { kind: "column", name: "window_class", on: "analytics_jobs" },
      { kind: "column", name: "priority", on: "analytics_jobs" },
      { kind: "column", name: "last_served_at", on: "analytics_connections" },
      { kind: "column", name: "cooldown_until", on: "analytics_connections" },
      { kind: "column", name: "consecutive_failures", on: "analytics_connections" },
      { kind: "index", name: "analytics_jobs_class_idx" },
      { kind: "index", name: "analytics_jobs_one_lease_idx" },
    ],
    needs: [{ kind: "table", name: "analytics_jobs" }, { kind: "table", name: "analytics_connections" }],
  },
  "0054": {
    file: "0054_analytics_worker_invocations.sql",
    creates: [
      { kind: "table", name: "analytics_worker_invocations" },
      { kind: "index", name: "analytics_worker_invocations_started_idx" },
      { kind: "index", name: "analytics_worker_invocations_running_idx" },
      { kind: "policy", name: "analytics_worker_invocations_select", on: "analytics_worker_invocations" },
      { kind: "policy", name: "analytics_worker_invocations_write", on: "analytics_worker_invocations" },
    ],
    needs: [...["app_is_global", "app_is_service"].map((f) => ({ kind: "function" as const, name: f }))],
  },
};

const SQL: Record<Check["kind"], string> = {
  table: "select to_regclass('public.' || $1) is not null as present",
  column: "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = $2 and column_name = $1) as present",
  index: "select exists (select 1 from pg_indexes where schemaname = 'public' and indexname = $1) as present",
  function: "select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1) as present",
  trigger: "select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and t.tgname = $1 and c.relname = $2) as present",
  policy: "select exists (select 1 from pg_policies where schemaname = 'public' and policyname = $1 and tablename = $2) as present",
};

const pool = getAdminPool();
const client = await pool.connect();
try {
  await client.query("begin transaction read only");
  const present = async (c: Check) => (await client.query<{ present: boolean }>(SQL[c.kind], c.kind === "table" || c.kind === "index" || c.kind === "function" ? [c.name] : [c.name, c.on])).rows[0]!.present;

  const target = { place: databasePlace(adminUrl), role: (await client.query<{ r: string }>("select current_user as r")).rows[0]!.r === "cg_app" ? "application role (history will be unreadable)" : "owner or other non-app role", readOnlyTransaction: true };

  const tableExists = (await client.query<{ present: boolean }>("select to_regclass('public.schema_migrations') is not null as present")).rows[0]!.present;
  const history = tableExists
    ? (await client.query<{ name: string; checksum: string; applied_at: Date }>("select name, checksum, applied_at from schema_migrations order by name")).rows
    : [];
  const byName = new Map(history.map((h) => [h.name, h]));

  const report: Record<string, unknown> = {};
  for (const [id, m] of Object.entries(MIGRATIONS)) {
    const checksum = createHash("sha256").update(readFileSync(join(import.meta.dirname, "..", "migrations", m.file), "utf8")).digest("hex");
    const recorded = byName.get(m.file);
    const created: Array<{ c: Check; ok: boolean }> = [];
    for (const c of m.creates) created.push({ c, ok: await present(c) });
    const needed: Array<{ c: Check; ok: boolean }> = [];
    for (const c of m.needs) needed.push({ c, ok: await present(c) });
    const have = created.filter((x) => x.ok).length;
    const objects = have === 0 ? "none" : have === created.length ? "all" : "PARTIAL";
    const history_ = !recorded ? "not recorded" : recorded.checksum === checksum ? "recorded, checksum matches" : "recorded, CHECKSUM DIFFERS";
    const drift =
      recorded && objects === "none" ? "DRIFT: recorded as applied but its objects are missing"
      : !recorded && objects === "all" ? "DRIFT: objects exist but the migration is not recorded (applied by hand?)"
      : objects === "PARTIAL" ? "DRIFT: partly applied"
      : recorded && objects === "all" ? "consistent (applied)"
      : "consistent (pending)";
    report[id] = {
      file: m.file,
      history: history_,
      appliedAt: recorded?.applied_at.toISOString().slice(0, 10) ?? null,
      objects: `${objects} (${have} of ${created.length})`,
      missingObjects: created.filter((x) => !x.ok).map((x) => `${x.c.kind} ${x.c.on ? x.c.on + "." : ""}${x.c.name}`),
      drift,
      preconditionsMet: needed.every((x) => x.ok),
      missingPreconditions: needed.filter((x) => !x.ok).map((x) => `${x.c.kind} ${x.c.on ? x.c.on + "." : ""}${x.c.name}`),
    };
  }

  // Precondition for 0053's unique index, and counts that show what 0044's backfill would copy. Counts only.
  const hasJobs = (await client.query<{ present: boolean }>("select to_regclass('public.analytics_jobs') is not null as present")).rows[0]!.present;
  const duplicateLeases = hasJobs
    ? (await client.query<{ n: number }>("select count(*)::int as n from (select connection_id from analytics_jobs where state = 'leased' group by 1 having count(*) > 1) d")).rows[0]!.n
    : null;
  const leasedJobs = hasJobs ? (await client.query<{ n: number }>("select count(*)::int as n from analytics_jobs where state = 'leased'")).rows[0]!.n : null;
  const wixCols = await client.query<{ present: boolean }>("select exists (select 1 from information_schema.columns where table_schema='public' and table_name='websites' and column_name='wix_form_id') as present");
  const backfillCandidates = wixCols.rows[0]!.present
    ? (await client.query<{ n: number }>("select count(*)::int as n from websites where enquiry_source = 'wix' and wix_form_id is not null and wix_form_key is not null and wix_instance_id is not null")).rows[0]!.n
    : null;
  const wixSites = wixCols.rows[0]!.present
    ? (await client.query<{ n: number }>("select count(*)::int as n from websites where enquiry_source = 'wix'")).rows[0]!.n
    : null;

  const migrationsRecorded = history.length;
  const latest = history.length ? history[history.length - 1]!.name : null;
  console.log(JSON.stringify({
    target,
    schemaMigrations: { tableExists, recordedCount: migrationsRecorded, latestRecorded: latest, anyChecksumDiffers: Object.values(report).some((r) => String((r as { history: string }).history).includes("DIFFERS")) },
    migrations: report,
    preconditions: { leasedJobs, connectionsWithMoreThanOneLeasedJob: duplicateLeases, wixEnquirySites: wixSites, bindingsThe0044BackfillWouldCopy: backfillCandidates },
  }, null, 2));
  await client.query("rollback");
} finally {
  client.release();
  await closePools();
}
