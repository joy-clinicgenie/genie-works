import pg from "pg";
import type { PlatformRole } from "@clinic-genie/contracts";
import { loadRootEnv, requireEnv } from "./env";

const { Pool } = pg;
// Dates stay as YYYY-MM-DD strings and numerics become numbers, so day boundaries never shift with the server time zone.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
export type PoolClient = pg.PoolClient;
export type Queryable = pg.PoolClient | pg.Pool;

/**
 * Who is acting in a database transaction. Row-level security policies read these values.
 * - service: the shared backend (intake, dispatcher). Trusted server code only.
 * - staff: an authenticated Control Centre user resolved from staff_users on the server.
 * - public: anonymous. Can insert nothing except through service code paths.
 */
export type DbContext =
  | { kind: "service" }
  | { kind: "staff"; userId: string; role: PlatformRole }
  | { kind: "public" };

let appPool: pg.Pool | undefined;
let adminPool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!appPool) {
    loadRootEnv();
    appPool = new Pool({ connectionString: requireEnv("DATABASE_URL"), max: 8 });
  }
  return appPool;
}

/** Owner connection. Bypasses row-level security. Migrations, seeds, backups and tests only. */
export function getAdminPool(): pg.Pool {
  if (!adminPool) {
    loadRootEnv();
    adminPool = new Pool({ connectionString: requireEnv("DATABASE_ADMIN_URL"), max: 4 });
  }
  return adminPool;
}

export async function closePools(): Promise<void> {
  await Promise.all([appPool?.end(), adminPool?.end()]);
  appPool = undefined;
  adminPool = undefined;
}

export class DbUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Database unavailable");
    this.name = "DbUnavailableError";
    this.cause = cause;
  }
}

/**
 * Runs `fn` inside one transaction with the context applied through SET LOCAL.
 * Commits on success, rolls back on any error. Row-level security sees the context for every statement.
 */
export async function withContext<T>(ctx: DbContext, fn: (client: pg.PoolClient) => Promise<T>, pool = getPool()): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    throw new DbUnavailableError(err);
  }
  try {
    await client.query("begin");
    await applyContext(client, ctx);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* connection already gone */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function applyContext(client: pg.PoolClient, ctx: DbContext): Promise<void> {
  const userId = ctx.kind === "staff" ? ctx.userId : "";
  const role = ctx.kind === "staff" ? ctx.role : "";
  await client.query(
    "select set_config('app.context', $1, true), set_config('app.user_id', $2, true), set_config('app.platform_role', $3, true)",
    [ctx.kind, userId, role],
  );
}

export const SERVICE: DbContext = { kind: "service" };

/**
 * Auth.js talks to the application role directly. Each statement runs as the
 * service context so the identity tables stay closed to staff and anonymous sessions.
 */
export function authAdapterClient(pool = getPool()): pg.Pool {
  return {
    query: async (text: string, params?: unknown[]) => withContext(SERVICE, (db) => db.query(text, params), pool),
  } as pg.Pool;
}
