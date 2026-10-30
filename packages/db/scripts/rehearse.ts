/** Creates the local fictional rehearsal database and the isolated enquiry fixture. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadRootEnv, requireEnv } from "../src/env";
import { assertSafeTarget, describeDatabaseTarget, ensureAppRole, runMigrations } from "../src/migrate";
import { REHEARSAL_CLIENT_SLUGS, REHEARSAL_DATABASE } from "../src/rehearsal";
import { seedDemo } from "../src/seed";
import { resetEnquiryFixture } from "../src/testing/enquiry-fixture";
import { maintenanceUrl } from "../src/testing/targets";

loadRootEnv();
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
assertSafeTarget(adminUrl);
const database = decodeURIComponent(new URL(adminUrl).pathname.replace(/^\//, ""));
if (database !== REHEARSAL_DATABASE) {
  throw new Error(`Refusing rehearsal: the database must be ${REHEARSAL_DATABASE}.`);
}
console.log(describeDatabaseTarget(adminUrl));

const maint = new pg.Client({ connectionString: maintenanceUrl(adminUrl) });
await maint.connect();
try {
  await maint.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [REHEARSAL_DATABASE]);
  await maint.query(`drop database if exists ${REHEARSAL_DATABASE}`);
  await maint.query(`create database ${REHEARSAL_DATABASE}`);
} finally {
  await maint.end();
}

const pool = new pg.Pool({ connectionString: adminUrl, max: 2 });
try {
  await ensureAppRole(pool, process.env.APP_DB_PASSWORD || "cg_app_dev");
  const migrations = await runMigrations(pool, (line) => console.log(line));
  const checksums = await pool.query<{ name: string; checksum: string }>("select name, checksum from schema_migrations");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const mismatches: string[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql"))) {
    const checksum = createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
    const applied = checksums.rows.find((row) => row.name === file);
    if (!applied || applied.checksum !== checksum) mismatches.push(file);
  }
  if (mismatches.length) throw new Error(`Migration checksum mismatch: ${mismatches.join(", ")}`);
  console.log(`Migration history matches ${checksums.rowCount} files.`);

  await seedDemo(pool, (line) => console.log(line));
  const clients = await pool.query<{ slug: string }>("select slug from clients order by slug");
  const slugs = clients.rows.map((row) => row.slug);
  const allowed = new Set<string>(REHEARSAL_CLIENT_SLUGS);
  const unexpected = slugs.filter((slug) => !allowed.has(slug));
  if (unexpected.length) throw new Error(`Unexpected clients remain: ${unexpected.join(", ")}`);
  const directory = await pool.query<{ count: number }>(
    "select count(*)::int as count from clients where is_synthetic = false and slug <> 'clinic-genie'",
  );
  if (directory.rows[0]?.count !== 0) throw new Error("A non-fictional directory client remains.");
  const hosts = await pool.query<{ host: string }>(
    "select distinct split_part(regexp_replace(url, '^https?://', ''), '/', 1) as host from websites where url is not null",
  );
  if (hosts.rows.some((row) => !row.host.endsWith("example.invalid"))) {
    throw new Error("A website host is outside example.invalid.");
  }
  const emails = await pool.query<{ email: string | null }>("select contact_email as email from clients where contact_email is not null");
  if (emails.rows.some((row) => row.email && !row.email.endsWith("example.invalid"))) {
    throw new Error("A contact email is outside example.invalid.");
  }
  console.log(`Rehearsal clients: ${slugs.join(", ")}`);
  console.log(`Websites: ${hosts.rowCount ?? 0}`);
  console.log(`Migrations applied: ${migrations.applied.length}`);

  const enquiry = await resetEnquiryFixture();
  const enquiryClinics = [...enquiry.clinics].sort();
  const expectedClinics = ["harbourview-dental", "meridian-skin", "northgate-physio"];
  if (enquiry.database !== "clinic_genie_enquiry_test" || enquiryClinics.join() !== expectedClinics.join()) {
    throw new Error("Enquiry fixture clinics are not the fictional set.");
  }
  console.log(`Enquiry fixture database: ${enquiry.database}`);
  console.log(`Enquiry clinics: ${enquiryClinics.join(", ")}`);
  console.log(`Synthetic enquiries: ${enquiry.enquiries}`);
  console.log(`Notifications: ${enquiry.notifications}`);
} finally {
  await pool.end();
}
