import { randomBytes } from "node:crypto";
import pg from "pg";
import type { PlatformRole } from "@clinic-genie/contracts";
import { applyContext, type DbContext } from "../src/client";
import { loadRootEnv, requireEnv } from "../src/env";

/**
 * A disposable database on the local test server, for tests that must not share the seeded
 * development database (migration upgrades, publishing behaviour). Refuses anything not local,
 * and the sibling clinic database port.
 */

loadRootEnv();
const LOCAL = new Set(["127.0.0.1", "localhost", "::1"]);

function urlFor(base: string, database: string, user?: { name: string; password: string }): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (user) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
}

function adminBase(): string {
  const adminUrl = requireEnv("DATABASE_ADMIN_URL");
  const url = new URL(adminUrl);
  if (!LOCAL.has(url.hostname) || url.port === "54329") throw new Error("Refusing: isolated test databases are created on the local test server only.");
  return adminUrl;
}

async function appPassword(base: string): Promise<string> {
  const url = new URL(base);
  for (const password of [...new Set([process.env.APP_DB_PASSWORD, "cg_app_dev"].filter((v): v is string => Boolean(v)))]) {
    const client = new pg.Client({ host: url.hostname, port: Number(url.port), user: "cg_app", password, database: "postgres" });
    try {
      await client.connect();
      await client.end();
      return password;
    } catch {
      await client.end().catch(() => {});
    }
  }
  throw new Error("The local cg_app role does not accept the known development password.");
}

export interface IsolatedDatabase {
  name: string;
  admin: pg.Pool;
  app: pg.Pool;
  asContext<T>(ctx: DbContext, fn: (db: pg.PoolClient) => Promise<T>, opts?: { commit?: boolean }): Promise<T>;
  staff(email: string): Promise<{ id: string; platform_role: PlatformRole }>;
  drop(): Promise<void>;
}

export async function createIsolatedDatabase(label: string): Promise<IsolatedDatabase> {
  const base = adminBase();
  const name = `clinic_genie_test_${label}_${randomBytes(3).toString("hex")}`;
  if (!/^[a-z0-9_]{1,63}$/.test(name)) throw new Error("Invalid isolated database name.");
  const maintenance = new pg.Client({ connectionString: urlFor(base, "postgres") });
  await maintenance.connect();
  await maintenance.query(`create database ${name}`);
  await maintenance.end();
  const admin = new pg.Pool({ connectionString: urlFor(base, name), max: 3 });
  const app = new pg.Pool({ connectionString: urlFor(base, name, { name: "cg_app", password: await appPassword(base) }), max: 6 });
  return {
    name,
    admin,
    app,
    async asContext(ctx, fn, opts = {}) {
      const client = await app.connect();
      try {
        await client.query("begin");
        await applyContext(client, ctx);
        const result = await fn(client);
        await client.query(opts.commit ? "commit" : "rollback");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async staff(email) {
      const { rows } = await admin.query("select id, platform_role from staff_users where email = $1", [email]);
      if (!rows[0]) throw new Error(`Seed user ${email} missing in ${name}.`);
      return rows[0];
    },
    async drop() {
      await app.end().catch(() => {});
      await admin.end().catch(() => {});
      const client = new pg.Client({ connectionString: urlFor(base, "postgres") });
      await client.connect();
      await client.query(`drop database if exists ${name} with (force)`);
      await client.end();
    },
  };
}

export const staffContext = (u: { id: string; platform_role: PlatformRole }): DbContext => ({ kind: "staff", userId: u.id, role: u.platform_role });
