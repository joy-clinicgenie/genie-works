import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import { ENQUIRY_DB, PLATFORM_DB, adminUrl, appUrl, maintenanceUrl } from "./targets.ts";

const mode = process.argv[2] === "drop" ? "drop" : "prepare";

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

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
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

async function dropDatabase(name: string): Promise<void> {
  if (name !== PLATFORM_DB && name !== ENQUIRY_DB) throw new Error(`Refusing to drop ${name}.`);
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
  if (name !== PLATFORM_DB && name !== ENQUIRY_DB) throw new Error(`Refusing to create ${name}.`);
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

async function prepare(): Promise<void> {
  process.env.NODE_ENV = "development";
  delete process.env.VERCEL_ENV;
  process.env.DATABASE_URL = appUrl(PLATFORM_DB);
  process.env.DATABASE_ADMIN_URL = adminUrl(PLATFORM_DB);
  process.env.APP_DB_PASSWORD = "cg_app_dev";
  delete process.env.ENQUIRY_DATABASE_URL;
  const standardExisted = await databaseExists("clinic_genie_enquiry_test");
  await dropDatabase(PLATFORM_DB);
  await dropDatabase(ENQUIRY_DB);
  await createDatabase(PLATFORM_DB);
  await createDatabase(ENQUIRY_DB);
  const env = envFor(PLATFORM_DB);
  await run("npm", ["run", "db:migrate"], env);
  await run("npm", ["run", "db:seed"], env);

  const admin = new pg.Client({ connectionString: adminUrl(PLATFORM_DB) });
  await admin.connect();
  try {
    const actor = await admin.query<{ id: string }>("select id from staff_users where email = 'admin@example.invalid'");
    const adminId = actor.rows[0]?.id;
    if (!adminId) throw new Error("Seeded admin staff record was not found.");
    await admin.query(
      `update clients
       set status = 'active', archived_at = null, updated_at = now(), updated_by = $1
       where slug = any($2::text[])`,
      [adminId, ["harbourview-dental", "meridian-skin", "northgate-physio"]],
    );
    const clients = await admin.query<{ slug: string; id: string; status: string }>(
      "select slug, id, status from clients where slug = any($1::text[]) order by slug",
      [["harbourview-dental", "meridian-skin", "northgate-physio"]],
    );
    const website = await admin.query<{ id: string }>(
      `select w.id
       from websites w
       join clients c on c.id = w.client_id
       where c.slug = 'meridian-skin' and w.environment = 'production' and w.platform = 'Next.js on Vercel'
       limit 1`,
    );
    if (!website.rows[0]?.id) throw new Error("Meridian native website was not found after seed.");
    if (clients.rows.some((row) => row.status !== "active")) throw new Error("Fictional clinic restore did not leave the three clinics active.");
    const bySlug = Object.fromEntries(clients.rows.map((row) => [row.slug, row.id]));
    await mkdir("e2e-batch08/.run", { recursive: true });
    await writeFile(
      "e2e-batch08/.run/context.json",
      JSON.stringify({
        adminId,
        harbourId: bySlug["harbourview-dental"],
        meridianId: bySlug["meridian-skin"],
        northgateId: bySlug["northgate-physio"],
        meridianWebsiteId: website.rows[0].id,
      }, null, 2),
    );
    console.log(`platform database ${PLATFORM_DB}: restored 3 fictional clinics`);
  } finally {
    await admin.end();
  }

  const { resetEnquiryFixture } = await import("../packages/db/src/testing/enquiry-fixture.ts");
  const summary = await resetEnquiryFixture(adminUrl(ENQUIRY_DB));
  console.log(`enquiry database ${summary.database}: ${summary.enquiries} fictional enquiries, ${summary.notifications} notifications`);
  await dropEmptyStandardFixture(standardExisted);
}

if (mode === "drop") {
  await dropDatabase(PLATFORM_DB);
  await dropDatabase(ENQUIRY_DB);
} else {
  await prepare();
}
