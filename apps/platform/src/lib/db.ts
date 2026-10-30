import { SERVICE, withContext, type AccessProfile, type PoolClient } from "@clinic-genie/db";

/** Runs a transaction as the signed-in staff member. Row-level security sees their role and memberships. */
export function staffTx<T>(access: AccessProfile, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  return withContext({ kind: "staff", userId: access.user.id, role: access.user.platform_role }, fn);
}

/** Runs trusted server-to-server work under the service RLS context. Never call from client code. */
export function serviceTx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  return withContext(SERVICE, fn);
}
