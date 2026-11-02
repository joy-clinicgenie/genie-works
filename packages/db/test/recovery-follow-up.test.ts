import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { loadRootEnv, requireEnv } from "../src/env";
import { runMigrations } from "../src/migrate";
import { seedDemo } from "../src/seed";
import { restoreTest, writeBackup } from "../src/backup";
import { createSavedReport } from "../src/services/saved-reports";
import { storeSavedReportArtifact } from "../src/services/report-artifact";

loadRootEnv();

const SOURCE = "clinic_genie_recovery_rehearsal";
const DESTINATION = `${SOURCE}_restore_test`;
const LOCAL = new Set(["127.0.0.1", "localhost", "::1"]);

function databaseUrl(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Uses a password that already signs in locally. It does not invent a new one. */
async function existingLocalAppPassword(): Promise<string> {
  const candidates = [...new Set([process.env.APP_DB_PASSWORD, "cg_app_dev"].filter((value): value is string => Boolean(value)))];
  for (const password of candidates) {
    const client = new pg.Client({ host: "127.0.0.1", port: 54339, user: "cg_app", password, database: "postgres" });
    try {
      await client.connect();
      await client.end();
      return password;
    } catch {
      await client.end().catch(() => {});
    }
  }
  throw new Error("Refusing recovery rehearsal: changing the local application role password was not attempted.");
}

describe("isolated enquiry follow-up and report recovery", () => {
  afterAll(async () => {
    const adminUrl = process.env.DATABASE_ADMIN_URL;
    if (!adminUrl) return;
    const url = new URL(adminUrl);
    if (!LOCAL.has(url.hostname) || url.port === "54329") return;
    const maintenance = new pg.Client({ connectionString: databaseUrl(adminUrl, "postgres") });
    await maintenance.connect();
    for (const name of [DESTINATION, SOURCE]) {
      await maintenance.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [name]);
      await maintenance.query(`drop database if exists ${name} with (force)`);
    }
    await maintenance.end();
  });

  it("restores a fictional follow-up and a saved report file without touching the source copies", async () => {
    const adminUrl = requireEnv("DATABASE_ADMIN_URL");
    const url = new URL(adminUrl);
    if (!LOCAL.has(url.hostname) || url.port === "54329") {
      throw new Error("Refusing recovery rehearsal: the admin host is not local.");
    }
    const maintenance = new pg.Client({ connectionString: databaseUrl(adminUrl, "postgres") });
    await maintenance.connect();
    await maintenance.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [SOURCE]);
    await maintenance.query(`drop database if exists ${SOURCE} with (force)`);
    await maintenance.query(`create database ${SOURCE}`);
    await maintenance.end();

    const sourceUrl = databaseUrl(adminUrl, SOURCE);
    const pool = new pg.Pool({ connectionString: sourceUrl, max: 2 });
    const artifactDirectory = mkdtempSync(join(tmpdir(), "cg-report-source-"));
    const backupDirectory = mkdtempSync(join(tmpdir(), "cg-backup-"));
    try {
      await runMigrations(pool);
      await seedDemo(pool);
      const client = await pool.connect();
      try {
        const admin = (await client.query<{ id: string }>("select id from staff_users where email = 'admin@example.invalid'")).rows[0];
        const clinic = (await client.query<{ id: string }>("select id from clients where slug = 'clinic-genie'")).rows[0];
        const site = (await client.query<{ id: string; client_id: string }>(
          `insert into websites (client_id, name, url, platform, environment, enquiry_key)
           select id, 'Check website', 'https://check.example.invalid', 'Next.js', 'production', 'check-production'
           from clients where slug = 'clinic-genie'
           returning id, client_id`,
        )).rows[0];
        expect(admin && clinic && site).toBeTruthy();
        await client.query(
          `update websites
           set enquiry_source = 'wix', wix_instance_id = '00000000-0000-4000-8000-0000000000a1',
               wix_form_id = '00000000-0000-4000-8000-0000000000a2', wix_form_namespace = 'wix.form_app.form',
               wix_form_key = 'contact', wix_counts_in_totals = false
           where id = $1`,
          [site!.id],
        );
        await client.query(
          `insert into enquiry_follow_ups (website_id, client_id, external_id, status)
           values ($1, $2, '11111111-1111-4111-8111-111111111199', 'acknowledged')`,
          [site!.id, site!.client_id],
        );
        const reportId = await createSavedReport(client, {
          clientId: clinic!.id,
          name: "Recovery sample",
          periodStart: "2030-08-01",
          periodEnd: "2030-08-31",
          comparisonStart: null,
          comparisonEnd: null,
          sections: ["traffic"],
          summary: "Fictional recovery sample",
          observations: null,
          actionsTaken: null,
          nextSteps: null,
          dataSourcesNote: null,
          missingConnections: null,
          measurementLimitations: null,
        }, admin!.id);
        const stored = await storeSavedReportArtifact(client, reportId, artifactDirectory);
        expect(stored?.created).toBe(true);
      } finally {
        client.release();
      }
      const backup = await writeBackup(pool, backupDirectory, { artifactDirectory });
      expect(backup.counts.enquiry_follow_ups).toBe(1);
      expect(backup.reportArtifacts).toBe(1);
      const verified = await restoreTest(pool, sourceUrl, backup.file, {
        appPassword: await existingLocalAppPassword(),
        artifactDirectory,
      });
      expect(verified.mismatches).toEqual([]);
      expect(verified.counts.enquiry_follow_ups).toBe(1);
      expect(verified.orphans.follow_ups_without_wix_website).toBe(0);
      expect(verified.reportArtifacts.restored).toBe(1);
      expect(verified.reportArtifacts.mismatches).toEqual([]);
    } finally {
      await pool.end();
      rmSync(artifactDirectory, { recursive: true, force: true });
      rmSync(backupDirectory, { recursive: true, force: true });
    }
  }, 180_000);
});
