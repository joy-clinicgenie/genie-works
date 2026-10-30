/**
 * Logical backup and restore test. The embedded development Postgres ships without pg_dump,
 * so this tool exports every business table as JSON through the owner connection and restores it
 * into a freshly migrated isolated database. A managed vendor's physical backups are separate and
 * are not claimed here.
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { assertSafeTarget, ensureAppRole, runMigrations } from "./migrate";
import { databaseTarget, maintenanceUrl } from "./testing/targets";

/**
 * Copied business and identity tables. Auth.js session cookies, one-time
 * verification tokens and development magic links are deliberately absent:
 * a restore must not revive an old sign-in. Staff sign in again. The `users`
 * and `accounts` rows are kept so an existing identity link can be used.
 */
export const BACKUP_EXCLUDED_TABLES = ["sessions", "verification_token", "dev_magic_links"] as const;

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
  "blog_activity",
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

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Refusing recovery: the database name is not a plain identifier.");
  return `"${name}"`;
}

/** Backup and restore-test sources. Shared, enquiry and production databases are refused before any write. */
export function assertRecoverySource(url: string): { database: string } {
  assertSafeTarget(url);
  const target = databaseTarget(url);
  assertRecoveryDatabaseName(target.database);
  return { database: target.database };
}

export function assertRecoveryDatabaseName(database: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error("Refusing recovery: the database name is not a plain identifier.");
  if (database === "clinic_genie" || database === "neondb" || database === "postgres" || database.includes("enquiry")) {
    throw new Error("Refusing recovery: that database is shared or is the enquiry source.");
  }
  if (database.endsWith("_restore_test")) throw new Error("Refusing recovery: the source is already a restore destination.");
  const pattern = process.env.RECOVERY_ALLOWED_DB_PATTERN || "rehearsal";
  if (!database.includes(pattern)) throw new Error(`Refusing recovery: database name does not contain "${pattern}".`);
}

/** Isolated destination. It is never the source database. */
export function recoveryDestinationName(sourceDatabase: string): string {
  assertRecoveryDatabaseName(sourceDatabase);
  return `${sourceDatabase}_restore_test`;
}

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
  let runId: string | undefined;
  try {
    const current = await client.query<{ name: string }>("select current_database() as name");
    assertRecoveryDatabaseName(current.rows[0]!.name);
    runId = (await client.query<{ id: string }>("insert into backup_runs (kind, target) values ('backup', $1) returning id", [outDir])).rows[0]!.id;
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
    if (runId) {
      await client.query("update backup_runs set finished_at = now(), outcome = 'failed', notes = $2 where id = $1", [runId, String((err as Error).message).slice(0, 300)]);
    }
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
  migrationsMatch: boolean;
  invalidated: Record<(typeof BACKUP_EXCLUDED_TABLES)[number], number>;
  blog: { articles: number; versions: number; activity: number; activityMissingArticle: number; activityClientMismatch: number };
  isolationCheck: { userA: number; userB: number; total: number } | null;
}

/**
 * Restores a backup file into an isolated database (created fresh), then verifies record counts,
 * relationships and access policies. Records the result in the SOURCE database's backup_runs table.
 */
export async function restoreTest(sourcePool: pg.Pool, adminUrl: string, backupPath: string, opts: { keep?: boolean; appPassword: string }): Promise<RestoreVerification> {
  const sourceDb = assertRecoverySource(adminUrl).database;
  const testDb = recoveryDestinationName(sourceDb);
  const body = JSON.parse(readFileSync(backupPath, "utf8")) as BackupFile;
  if (body.format !== "clinic-genie-logical-v1") throw new Error("Unsupported backup format");
  const connected = await sourcePool.query<{ name: string }>("select current_database() as name");
  if (connected.rows[0]?.name !== sourceDb) throw new Error("Refusing recovery: the connection is not the declared source.");
  const runId = (await sourcePool.query<{ id: string }>("insert into backup_runs (kind, target, artefact_ref) values ('restore_test', $1, $2) returning id", [testDb, backupPath])).rows[0]!.id;
  const maintenance = new pg.Pool({ connectionString: maintenanceUrl(adminUrl), max: 1 });
  let testPool: pg.Pool | undefined;
  try {
    await maintenance.query(`drop database if exists ${quoteIdent(testDb)} with (force)`);
    await maintenance.query(`create database ${quoteIdent(testDb)}`);
    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${testDb}`;
    testPool = new pg.Pool({ connectionString: testUrl.toString(), max: 2 });
    await ensureAppRole(testPool, opts.appPassword);
    await runMigrations(testPool);
    const client = await testPool.connect();
    try {
      await client.query("begin");
      await client.query("set session_replication_role = replica"); // skip append-only guard triggers while loading a verified snapshot
      // Migrations insert the internal agency row. Replace those rows with the snapshot so identifiers match.
      for (const table of [...BACKUP_TABLES].reverse()) await client.query(`delete from ${table}`);
      for (const table of BACKUP_EXCLUDED_TABLES) await client.query(`delete from ${table}`);
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
    const passed = verification.mismatches.length === 0;
    await sourcePool.query("update backup_runs set finished_at = now(), outcome = $2, record_counts = $3, notes = $4 where id = $1", [
      runId,
      passed ? "passed" : "failed",
      JSON.stringify(verification.counts),
      passed
        ? `Restored into ${testDb}. Counts, relationships, blog activity and migrations matched. Auth.js sessions, verification tokens and development magic links were left empty.`
        : `Mismatches: ${verification.mismatches.join("; ")}`.slice(0, 300),
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
    if (orphans[name] !== 0) mismatches.push(`${name}: ${orphans[name]}`);
  }
  const blog = {
    articles: Number((await pool.query<{ n: string }>("select count(*) as n from blog_articles")).rows[0]!.n),
    versions: Number((await pool.query<{ n: string }>("select count(*) as n from blog_article_versions")).rows[0]!.n),
    activity: Number((await pool.query<{ n: string }>("select count(*) as n from blog_activity")).rows[0]!.n),
    activityMissingArticle: Number((await pool.query<{ n: string }>("select count(*) as n from blog_activity a where not exists (select 1 from blog_articles b where b.id = a.article_id)")).rows[0]!.n),
    activityClientMismatch: Number((await pool.query<{ n: string }>("select count(*) as n from blog_activity a join blog_articles b on b.id = a.article_id where a.client_id <> b.client_id")).rows[0]!.n),
  };
  if (blog.activityMissingArticle !== 0) mismatches.push(`blog_activity_without_article: ${blog.activityMissingArticle}`);
  if (blog.activityClientMismatch !== 0) mismatches.push(`blog_activity_client_mismatch: ${blog.activityClientMismatch}`);
  const versionsWithoutArticle = Number((await pool.query<{ n: string }>("select count(*) as n from blog_article_versions v where not exists (select 1 from blog_articles a where a.id = v.article_id)")).rows[0]!.n);
  if (versionsWithoutArticle !== 0) mismatches.push(`blog_versions_without_article: ${versionsWithoutArticle}`);
  const applied = (await pool.query<{ name: string }>("select name from schema_migrations order by name")).rows.map((row) => row.name);
  const expectedMigrations = [...body.migrations].sort();
  const migrationsMatch = applied.join("\n") === expectedMigrations.join("\n");
  if (!migrationsMatch) mismatches.push(`migrations: expected ${expectedMigrations.length}, found ${applied.length}`);
  const invalidated = {} as RestoreVerification["invalidated"];
  for (const table of BACKUP_EXCLUDED_TABLES) {
    invalidated[table] = Number((await pool.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]!.n);
    if (invalidated[table] !== 0) mismatches.push(`${table}: expected 0 after sign-in invalidation, found ${invalidated[table]}`);
  }
  const rls = await pool.query<{ n: string }>(
    "select count(*) as n from pg_tables t join pg_class c on c.relname = t.tablename where t.schemaname = 'public' and t.tablename in ('tasks','clients','websites','audit_events','blog_activity') and c.relrowsecurity",
  );
  const rlsEnabled = Number(rls.rows[0]!.n) === 5;
  if (!rlsEnabled) mismatches.push("rls: required tables are not all protected");
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
    if (isolationCheck.total > 0 && isolationCheck.userA === isolationCheck.total && isolationCheck.userB === isolationCheck.total) {
      mismatches.push("isolation: both specialists can see every task");
    }
  } else {
    mismatches.push("isolation: seeded specialists were not found");
  }
  return { counts, mismatches, orphans, rlsEnabled, migrationsMatch, invalidated, blog, isolationCheck };
}
