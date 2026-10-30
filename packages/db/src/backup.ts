/**
 * Logical backup and restore test. The embedded development Postgres ships without pg_dump,
 * so this tool exports every business table as JSON through the owner connection and restores it
 * into a freshly migrated isolated database. A managed vendor's physical backups are separate and
 * are not claimed here.
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { databaseNameFromUrl, ensureAppRole, runMigrations } from "./migrate";

export const BACKUP_TABLES = [
  "staff_users",
  "clients",
  "client_contacts",
  "client_file_links",
  "form_routes",
  "memberships",
  "websites",
  "website_forms",
  "enquiry_status_events",
  "blog_articles",
  "blog_article_versions",
  "blog_media",
  "blog_approvals",
  "blog_publications",
  "blog_preview_tokens",
  "account_references",
  "tasks",
  "task_history",
  "task_notes",
  "approvals",
  "approval_decisions",
  "seo_pages",
  "seo_changes",
  "seo_page_settings",
  "seo_website_settings",
  "seo_redirects",
  "seo_site_tokens",
  "seo_business_profiles",
  "ads_audits",
  "ads_findings",
  "ads_changes",
  "issues",
  "issue_history",
  "evidence_items",
  "medical_claims",
  "claim_wordings",
  "medical_reviews",
  "medical_sources",
  "report_snapshots",
  "analytics_connections",
  "analytics_secrets",
  "analytics_oauth_states",
  "analytics_capabilities",
  "analytics_source_policies",
  "analytics_jobs",
  "analytics_sync_runs",
  "analytics_report_partitions",
  "analytics_report_rows",
  "analytics_metric_values",
  "analytics_coverage",
  "analytics_imports",
  "analytics_page_registry",
  "analytics_annotations",
  "analytics_report_exports",
  "report_notes",
  "saved_reports",
  "saved_report_versions",
  "saved_report_downloads",
  "timeline_events",
  "audit_events",
  "backup_runs",
  "users",
  "accounts",
] as const;

export interface BackupFile {
  format: "clinic-genie-logical-v1";
  createdAt: string;
  sourceDatabase: string;
  migrations: string[];
  tables: Record<string, unknown[]>;
}

export async function writeBackup(pool: pg.Pool, outDir: string): Promise<{ file: string; counts: Record<string, number> }> {
  mkdirSync(outDir, { recursive: true });
  const client = await pool.connect();
  const runId = (await client.query<{ id: string }>("insert into backup_runs (kind, target) values ('backup', $1) returning id", [outDir])).rows[0]!.id;
  try {
    await client.query("begin isolation level repeatable read");
    const migrations = (await client.query<{ name: string }>("select name from schema_migrations order by name")).rows.map((r) => r.name);
    const tables: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};
    for (const table of BACKUP_TABLES) {
      const { rows } = await client.query(`select * from ${table}`);
      tables[table] = rows;
      counts[table] = rows.length;
    }
    await client.query("commit");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(outDir, `backup-${stamp}.json`);
    const body: BackupFile = { format: "clinic-genie-logical-v1", createdAt: new Date().toISOString(), sourceDatabase: "redacted", migrations, tables };
    writeFileSync(file, JSON.stringify(body));
    await client.query("update backup_runs set finished_at = now(), outcome = 'passed', artefact_ref = $2, record_counts = $3 where id = $1", [
      runId,
      file,
      JSON.stringify(counts),
    ]);
    return { file, counts };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    await client.query("update backup_runs set finished_at = now(), outcome = 'failed', notes = $2 where id = $1", [runId, String((err as Error).message).slice(0, 300)]);
    throw err;
  } finally {
    client.release();
  }
}

export function latestBackupFile(dir: string): string | null {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("backup-") && f.endsWith(".json"))
    .sort();
  return files.length ? join(dir, files[files.length - 1]!) : null;
}

export interface RestoreVerification {
  counts: Record<string, number>;
  mismatches: string[];
  orphans: Record<string, number>;
  rlsEnabled: boolean;
  isolationCheck: { userA: number; userB: number; total: number } | null;
}

/**
 * Restores a backup file into an isolated database (created fresh), then verifies record counts,
 * relationships and access policies. Records the result in the SOURCE database's backup_runs table.
 */
export async function restoreTest(sourcePool: pg.Pool, adminUrl: string, backupPath: string, opts: { keep?: boolean; appPassword: string }): Promise<RestoreVerification> {
  const body = JSON.parse(readFileSync(backupPath, "utf8")) as BackupFile;
  if (body.format !== "clinic-genie-logical-v1") throw new Error("Unsupported backup format");
  const sourceDb = databaseNameFromUrl(adminUrl);
  const testDb = `${sourceDb}_restore_test`;
  const maintenanceUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
  const runId = (await sourcePool.query<{ id: string }>("insert into backup_runs (kind, target, artefact_ref) values ('restore_test', $1, $2) returning id", [testDb, backupPath])).rows[0]!.id;
  const maintenance = new pg.Pool({ connectionString: maintenanceUrl, max: 1 });
  let testPool: pg.Pool | undefined;
  try {
    await maintenance.query(`drop database if exists "${testDb}" with (force)`);
    await maintenance.query(`create database "${testDb}"`);
    const testUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${testDb}$1`);
    testPool = new pg.Pool({ connectionString: testUrl, max: 2 });
    await ensureAppRole(testPool, opts.appPassword);
    await runMigrations(testPool);
    const client = await testPool.connect();
    try {
      await client.query("begin");
      await client.query("set session_replication_role = replica"); // skip append-only guard triggers while loading a verified snapshot
      for (const table of BACKUP_TABLES) {
        const rows = body.tables[table] ?? [];
        if (!rows.length) continue;
        await client.query(`insert into ${table} select * from json_populate_recordset(null::${table}, $1::json)`, [JSON.stringify(rows)]);
      }
      await client.query("set session_replication_role = default");
      for (const seq of ["users_id_seq", "accounts_id_seq"]) {
        const table = seq.replace("_id_seq", "");
        await client.query(`select setval('${seq}', coalesce((select max(id) from ${table}), 0) + 1, false)`);
      }
      await client.query("select setval('report_download_serial', coalesce((select max(serial_number) from saved_report_downloads), 0) + 1, false)");
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    const verification = await verifyRestore(testPool, body);
    const passed = verification.mismatches.length === 0 && Object.values(verification.orphans).every((n) => n === 0) && verification.rlsEnabled;
    await sourcePool.query("update backup_runs set finished_at = now(), outcome = $2, record_counts = $3, notes = $4 where id = $1", [
      runId,
      passed ? "passed" : "failed",
      JSON.stringify(verification.counts),
      passed ? `Restored ${backupPath} into ${testDb}; counts, relationships and RLS verified.` : `Mismatches: ${verification.mismatches.join("; ")}`,
    ]);
    return verification;
  } catch (err) {
    await sourcePool.query("update backup_runs set finished_at = now(), outcome = 'failed', notes = $2 where id = $1", [runId, String((err as Error).message).slice(0, 300)]);
    throw err;
  } finally {
    await testPool?.end();
    if (!opts.keep) await maintenance.query(`drop database if exists "${testDb}" with (force)`).catch(() => {});
    await maintenance.end();
  }
}

async function verifyRestore(pool: pg.Pool, body: BackupFile): Promise<RestoreVerification> {
  const counts: Record<string, number> = {};
  const mismatches: string[] = [];
  for (const table of BACKUP_TABLES) {
    const n = Number((await pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]!.n);
    counts[table] = n;
    const expected = (body.tables[table] ?? []).length;
    if (n !== expected) mismatches.push(`${table}: expected ${expected}, found ${n}`);
  }
  const orphans: Record<string, number> = {};
  const checks: Record<string, string> = {
    websites_without_client: "select count(*) from websites w where not exists (select 1 from clients c where c.id = w.client_id)",
    seo_changes_without_page: "select count(*) from seo_changes s where not exists (select 1 from seo_pages p where p.id = s.seo_page_id)",
    tasks_without_client: "select count(*) from tasks t where not exists (select 1 from clients c where c.id = t.client_id)",
    decisions_without_approval: "select count(*) from approval_decisions d where not exists (select 1 from approvals a where a.id = d.approval_id)",
    evidence_issue_mismatch: "select count(*) from evidence_items e join issues i on i.id = e.issue_id where i.client_id <> e.client_id",
    wordings_without_claim: "select count(*) from claim_wordings w where not exists (select 1 from medical_claims c where c.id = w.claim_id)",
    memberships_without_user: "select count(*) from memberships m where not exists (select 1 from staff_users u where u.id = m.user_id)",
  };
  for (const [name, sql] of Object.entries(checks)) {
    orphans[name] = Number((await pool.query<{ count: string }>(sql)).rows[0]!.count);
  }
  const rls = await pool.query<{ n: string }>(
    "select count(*) as n from pg_tables t join pg_class c on c.relname = t.tablename where t.schemaname = 'public' and t.tablename in ('tasks','clients','websites','audit_events') and c.relrowsecurity",
  );
  const rlsEnabled = Number(rls.rows[0]!.n) === 4;
  // Access policy spot check: two scoped users see only their own client's submissions.
  let isolationCheck: RestoreVerification["isolationCheck"] = null;
  const users = await pool.query<{ id: string; email: string }>("select id, email from staff_users where email in ('specialist-a@example.invalid','specialist-b@example.invalid') order by email");
  if (users.rows.length === 2) {
    const total = Number((await pool.query<{ n: string }>("select count(*) as n from tasks")).rows[0]!.n);
    const countAs = async (userId: string) => {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query("set local role cg_app");
        await c.query("select set_config('app.context','staff',true), set_config('app.user_id',$1,true), set_config('app.platform_role','specialist',true)", [userId]);
        const n = Number((await c.query<{ n: string }>("select count(*) as n from tasks")).rows[0]!.n);
        await c.query("rollback");
        return n;
      } finally {
        c.release();
      }
    };
    isolationCheck = { userA: await countAs(users.rows[0]!.id), userB: await countAs(users.rows[1]!.id), total };
  }
  return { counts, mismatches, orphans, rlsEnabled, isolationCheck };
}
