import type pg from "pg";

/** Clients a fresh install may keep. Directory rows from historical migrations are not in this list. */
export const REHEARSAL_CLIENT_SLUGS = ["clinic-genie"] as const;

export const REHEARSAL_DATABASE = "clinic_genie_rehearsal";

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Refusing an unexpected database identifier.");
  return name;
}

async function deleteMatching(client: pg.PoolClient, table: string, whereSql: string, params: unknown[], stack: string[]): Promise<number> {
  if (stack.includes(table)) return 0;
  if (stack.length > 32) throw new Error("Fresh setup could not remove imported directory clients.");
  const next = [...stack, table];
  const refs = await client.query<{ child: string; child_column: string; parent_column: string }>(
    `select src.relname as child, att.attname as child_column, patt.attname as parent_column
     from pg_constraint con
     join pg_class src on src.oid = con.conrelid
     join pg_class dst on dst.oid = con.confrelid
     join pg_namespace ns on ns.oid = src.relnamespace
     join pg_attribute att on att.attrelid = src.oid and att.attnum = con.conkey[1]
     join pg_attribute patt on patt.attrelid = dst.oid and patt.attnum = con.confkey[1]
     where con.contype = 'f' and ns.nspname = 'public' and dst.relname = $1
       and array_length(con.conkey, 1) = 1`,
    [table],
  );
  for (const ref of refs.rows) {
    const childWhere = `${ident(ref.child_column)} in (select ${ident(ref.parent_column)} from ${ident(table)} where ${whereSql})`;
    await deleteMatching(client, ref.child, childWhere, params, next);
  }
  const removed = await client.query(`delete from ${ident(table)} where ${whereSql}`, params);
  return removed.rowCount ?? 0;
}

/**
 * Deletes clients inserted by historical directory migrations, and rows that reference them.
 * The caller decides when this is safe. It does not edit applied migration files.
 */
export async function removeImportedDirectoryClients(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const removed = await deleteMatching(client, "clients", "not (slug = any($1::text[]))", [[...REHEARSAL_CLIENT_SLUGS]], []);
    await client.query(
      `update clients
       set contact_email = null, contact_phone = null, address = null, updated_at = now()
       where slug = 'clinic-genie'
         and (
           (contact_email is not null and contact_email not like '%example.invalid')
           or contact_phone is not null
           or address is not null
         )`,
    );
    await client.query("commit");
    return removed;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
