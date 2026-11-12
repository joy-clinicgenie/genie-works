import pg from "pg";
import { loadRootEnv, requireEnv } from "../src/env";
import type { PlatformRole } from "@clinic-genie/contracts";
import { applyContext, type DbContext } from "../src/client";
import { assertTestDatabase } from "../src/database-environment";

loadRootEnv();

// Checked before either pool exists: tests never open the production database or an unlisted remote host (D54).
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
const appUrl = requireEnv("DATABASE_URL");
assertTestDatabase(adminUrl);
assertTestDatabase(appUrl);

export const adminPool = new pg.Pool({ connectionString: adminUrl, max: 4 });
export const appPool = new pg.Pool({ connectionString: appUrl, max: 4 });

/** Runs `fn` as the application role with the given context, then rolls back so tests leave no trace. */
export async function asContext<T>(ctx: DbContext, fn: (db: pg.PoolClient) => Promise<T>, opts: { commit?: boolean } = {}): Promise<T> {
  const client = await appPool.connect();
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
}

export async function staffByEmail(email: string): Promise<{ id: string; platform_role: PlatformRole }> {
  const { rows } = await adminPool.query("select id, platform_role from staff_users where email = $1", [email]);
  if (!rows[0]) throw new Error(`Seed user ${email} missing. Run npm run db:seed.`);
  return rows[0];
}

export async function clientBySlug(slug: string): Promise<string> {
  const { rows } = await adminPool.query("select id from clients where slug = $1", [slug]);
  if (!rows[0]) throw new Error(`Seed client ${slug} missing. Run npm run db:seed.`);
  return rows[0].id;
}

export const staffCtx = (u: { id: string; platform_role: PlatformRole }): DbContext => ({ kind: "staff", userId: u.id, role: u.platform_role });
