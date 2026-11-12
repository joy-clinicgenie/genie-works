/**
 * Builds an isolated suite database from nothing: create, migrate, seed, then load the suite fixture.
 *
 * Usage:
 *   npx tsx e2e-batch08/prepare.mts [b08|perf]          prepare the suite
 *   npx tsx e2e-batch08/prepare.mts [b08|perf] drop     drop the suite databases
 *
 * Every database name is checked by e2e-batch08/targets.ts before a maintenance connection opens, so a
 * shared or production database is refused rather than migrated over. No production data is read.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import { adminUrl, appUrl, maintenanceUrl, suiteDatabases, suiteName, suiteTargets } from "./targets.ts";

const args = process.argv.slice(2);
const mode = args.includes("drop") ? "drop" : "prepare";
const suite = suiteName(args.find((arg) => arg !== "drop"));
const targets = suiteTargets(suite);

function envFor(database: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_ENV;
  delete env.VERCEL_ENV;
  delete env.ENQUIRY_DATABASE_URL;
  env.DATABASE_URL = appUrl(database);
  env.DATABASE_ADMIN_URL = adminUrl(database);
  env.APP_DB_PASSWORD = "cg_app_dev";
  return env;
}

function run(command: string, commandArgs: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${commandArgs.join(" ")} exited ${code}`));
    });
  });
}

async function withMaintenance<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: maintenanceUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function databaseExists(name: string): Promise<boolean> {
  return withMaintenance(async (client) => {
    const found = await client.query("select 1 from pg_database where datname = $1", [name]);
    return (found.rowCount ?? 0) > 0;
  });
}

function assertSuiteDatabase(name: string): void {
  if (!suiteDatabases().includes(name)) throw new Error(`Refusing ${name}: it is not an isolated suite database.`);
}

async function dropDatabase(name: string): Promise<void> {
  assertSuiteDatabase(name);
  await withMaintenance(async (client) => {
    const found = await client.query("select 1 from pg_database where datname = $1", [name]);
    if ((found.rowCount ?? 0) === 0) {
      console.log(`database ${name} is already absent`);
      return;
    }
    await client.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [name]);
    await client.query(`drop database ${name}`);
    console.log(`dropped database ${name}`);
  });
}

async function createDatabase(name: string): Promise<void> {
  assertSuiteDatabase(name);
  await withMaintenance(async (client) => {
    const found = await client.query("select 1 from pg_database where datname = $1", [name]);
    if ((found.rowCount ?? 0) > 0) return;
    await client.query(`create database ${name}`);
    console.log(`created database ${name}`);
  });
}

async function dropEmptyStandardFixture(existedBefore: boolean): Promise<void> {
  if (existedBefore) return;
  const name = "clinic_genie_enquiry_test";
  await withMaintenance(async (client) => {
    const found = await client.query("select 1 from pg_database where datname = $1", [name]);
    if ((found.rowCount ?? 0) === 0) return;
    const probe = new pg.Client({ connectionString: maintenanceUrl().replace(/\/postgres$/, `/${name}`) });
    await probe.connect();
    try {
      const tables = await probe.query("select count(*)::int as count from pg_tables where schemaname = 'public'");
      if (Number(tables.rows[0]?.count ?? 0) > 0) {
        console.log(`${name} was created during fixture setup and already has tables; left in place`);
        return;
      }
    } finally {
      await probe.end();
    }
    await client.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [name]);
    await client.query(`drop database ${name}`);
    console.log(`removed empty database ${name} created only so the isolated fixture could load`);
  });
}

/** The batch-08 journey fixture: the internal agency client plus one website. */
async function prepareBatch08(): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl(targets.platformDb) });
  await admin.connect();
  try {
    const actor = await admin.query<{ id: string }>("select id from staff_users where email = 'admin@example.invalid'");
    const adminId = actor.rows[0]?.id;
    if (!adminId) throw new Error("Seeded admin staff record was not found.");
    const clients = await admin.query<{ slug: string; id: string; status: string }>(
      "select slug, id, status from clients where slug = 'clinic-genie'",
    );
    const clinicId = clients.rows[0]?.id;
    if (!clinicId || clients.rows[0]?.status !== "active") throw new Error("The internal agency client was not found after seed.");
    await admin.query(
      `insert into websites (client_id, name, url, platform, environment, notes)
       select $1, 'Clinic Genie website', 'https://clinic-genie.example.invalid', 'Next.js on Vercel', 'production', 'Isolated journey website.'
       where not exists (
         select 1 from websites where client_id = $1 and environment = 'production' and platform = 'Next.js on Vercel'
       )`,
      [clinicId],
    );
    await admin.query(
      `insert into memberships (user_id, client_id, granted_by)
       select u.id, $1, $2
       from staff_users u
       where u.email = any($3::text[])
         and not exists (
           select 1 from memberships m where m.user_id = u.id and m.client_id = $1 and m.active
         )`,
      [clinicId, adminId, ["specialist-a@example.invalid", "reviewer@example.invalid"]],
    );
    const website = await admin.query<{ id: string }>(
      `select id from websites
       where client_id = $1 and environment = 'production' and platform = 'Next.js on Vercel'
       limit 1`,
      [clinicId],
    );
    if (!website.rows[0]?.id) throw new Error("The isolated website was not saved.");
    const removed = await admin.query("select 1 from clients where slug = 'meridian-skin'");
    if ((removed.rowCount ?? 0) > 0) throw new Error("Meridian Skin is still present after seed.");
    await mkdir("e2e-batch08/.run", { recursive: true });
    await writeFile(
      "e2e-batch08/.run/context.json",
      JSON.stringify({
        adminId,
        meridianId: clinicId,
        clinicGenieId: clinicId,
        meridianWebsiteId: website.rows[0].id,
      }, null, 2),
    );
    console.log(`platform database ${targets.platformDb}: clinic-genie website ready`);
  } finally {
    await admin.end();
  }
  const { resetEnquiryFixture } = await import("../packages/db/src/testing/enquiry-fixture.ts");
  const summary = await resetEnquiryFixture(adminUrl(targets.enquiryDb));
  console.log(`enquiry database ${summary.database}: ${summary.enquiries} fictional enquiries, ${summary.notifications} notifications`);
}

/** The performance fixture: Demo Clinic A and B, an empty clinic, and a larger enquiry dataset. */
async function preparePerf(): Promise<void> {
  const { loadPerfFixture } = await import("../packages/db/src/testing/perf-fixture.ts");
  const platform = await loadPerfFixture(adminUrl(targets.platformDb));
  console.log(`platform database ${platform.database}: fixture ${platform.version}, anchor ${platform.anchorDate}`);
  console.log(`  ${JSON.stringify(platform.counts)}`);

  const { resetPerfEnquiryFixture } = await import("../packages/db/src/testing/perf-enquiry-fixture.ts");
  const enquiry = await resetPerfEnquiryFixture(adminUrl(targets.enquiryDb));
  console.log(`enquiry database ${enquiry.database}: fixture ${enquiry.version}, ${enquiry.enquiries} enquiries, ${enquiry.notifications} notifications`);
  console.log(`  follow-up ${JSON.stringify(enquiry.byStatus)}`);
  console.log(`  notification ${JSON.stringify(enquiry.byNotificationState)}`);

  await mkdir("e2e-batch08/.run", { recursive: true });
  await writeFile(
    "e2e-batch08/.run/perf-context.json",
    JSON.stringify({ suite: "perf", platform, enquiry }, null, 2),
  );
}

async function prepare(): Promise<void> {
  process.env.NODE_ENV = "development";
  delete process.env.VERCEL_ENV;
  process.env.DATABASE_URL = appUrl(targets.platformDb);
  process.env.DATABASE_ADMIN_URL = adminUrl(targets.platformDb);
  process.env.APP_DB_PASSWORD = "cg_app_dev";
  delete process.env.ENQUIRY_DATABASE_URL;
  const standardExisted = await databaseExists("clinic_genie_enquiry_test");
  await dropDatabase(targets.platformDb);
  await dropDatabase(targets.enquiryDb);
  await createDatabase(targets.platformDb);
  await createDatabase(targets.enquiryDb);
  const env = envFor(targets.platformDb);
  await run("npm", ["run", "db:migrate"], env);
  await run("npm", ["run", "db:seed"], env);
  if (suite === "perf") await preparePerf();
  else await prepareBatch08();
  await dropEmptyStandardFixture(standardExisted);
  console.log(`suite ${suite} ready on ${targets.prodOrigin} (production build) and ${targets.devOrigin} (dev server)`);
}

if (mode === "drop") {
  await dropDatabase(targets.platformDb);
  await dropDatabase(targets.enquiryDb);
} else {
  await prepare();
}
