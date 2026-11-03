import type { Queryable } from "../client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EnquiryReadSource = "database" | "wix";

/** Records the first open. A later open keeps the original row. Follow-up status is not changed. */
export async function markEnquiryRead(
  db: Queryable,
  input: { clientId: string; externalId: string; source: EnquiryReadSource; userId: string },
): Promise<boolean> {
  const externalId = input.externalId.toLowerCase();
  const clientId = input.clientId.toLowerCase();
  const userId = input.userId.toLowerCase();
  if (!UUID.test(externalId) || !UUID.test(clientId) || !UUID.test(userId)) return false;
  if (input.source !== "database" && input.source !== "wix") return false;
  const result = await db.query(
    `insert into enquiry_reads (client_id, external_id, source, read_by)
     values ($1, $2, $3, $4)
     on conflict (source, external_id) do nothing`,
    [clientId, externalId, input.source, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Identities `source:id` that already have a read row. Another connector with the same id stays out. */
export async function openedEnquiryIdentities(
  db: Queryable,
  items: Array<{ id: string; source: EnquiryReadSource }>,
): Promise<string[]> {
  const ids = [...new Set(items.map((item) => item.id.toLowerCase()).filter((id) => UUID.test(id)))];
  if (ids.length === 0) return [];
  const wanted = new Set(items.filter((item) => UUID.test(item.id)).map((item) => `${item.source}:${item.id.toLowerCase()}`));
  const { rows } = await db.query<{ source: EnquiryReadSource; external_id: string }>(
    `select source, external_id::text as external_id
     from enquiry_reads
     where external_id = any($1::uuid[])`,
    [ids],
  );
  return rows
    .map((row) => `${row.source}:${row.external_id.toLowerCase()}`)
    .filter((identity) => wanted.has(identity));
}
