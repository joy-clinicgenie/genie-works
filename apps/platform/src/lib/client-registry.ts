import { cache } from "react";
import { listShellClients, type Queryable, type ShellClient } from "@clinic-genie/db";

export interface ShellClientStore {
  pending: Promise<ShellClient[]> | null;
}

/** One store per request, the same way getAccess() resolves the access profile once per request. */
const requestStore = cache((): ShellClientStore => ({ pending: null }));

/**
 * Reads the shell client registry once per request. The app layout and the page it wraps both
 * need it, and before this they each read it.
 *
 * The caller passes its own open transaction, so sharing costs no extra connection and the rows
 * stay scoped to that transaction's row-level security context. Nothing is held between requests:
 * React cache() is request-scoped, and outside a server render it does not share at all, so each
 * caller simply reads for itself as it did before.
 */
export function shellClients(db: Queryable, store: ShellClientStore = requestStore()): Promise<ShellClient[]> {
  if (!store.pending) {
    store.pending = listShellClients(db).catch((error: unknown) => {
      // A failed read must not deny the rest of the request its own attempt.
      store.pending = null;
      throw error;
    });
  }
  return store.pending;
}
