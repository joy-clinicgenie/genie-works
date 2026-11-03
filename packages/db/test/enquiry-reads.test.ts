import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { markEnquiryRead, openedEnquiryIdentities } from "../src/services/enquiry-reads";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";

const EXTERNAL_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ID = "55555555-5555-4555-8555-555555555555";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("enquiry reads", () => {
  it("stores the first open without the enquiry body and keeps other clinics out", async () => {
    const columns = await adminPool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'enquiry_reads'",
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toEqual(expect.arrayContaining(["client_id", "external_id", "source", "read_at", "read_by"]));
    expect(names).not.toContain("email");
    expect(names).not.toContain("name");
    expect(names).not.toContain("message");
    expect(names).not.toContain("contact_number");
    expect(names).not.toContain("phone");

    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const readonly = await staffByEmail("readonly@example.invalid");
    const slug = `read-${randomBytes(3).toString("hex")}`;
    const created = (await adminPool.query<{ client_id: string; id: string }>(
      `with clinic as (
         insert into clients (slug, name, owner_user_id, channels, is_synthetic, created_by, updated_by)
         select $1, 'Read clinic', id, array['website'], true, id, id
         from staff_users where email = 'admin@example.invalid'
         returning id
       )
       insert into websites (client_id, name, url, platform, environment, enquiry_key)
       select id, 'Read website', 'https://read.example.invalid', 'Wix', 'production', $2
       from clinic
       returning client_id, id`,
      [slug, `${slug}-site`],
    )).rows[0]!;
    await adminPool.query(
      "insert into memberships (user_id, client_id, granted_by) values ($1, $2, $3), ($4, $2, $3)",
      [specA.id, created.client_id, admin.id, readonly.id],
    );

    try {
      const saved = await asContext(staffCtx(specA), async (db) => {
        const opened = await markEnquiryRead(db, {
          clientId: created.client_id,
          externalId: EXTERNAL_ID,
          source: "wix",
          userId: specA.id,
        });
        const again = await markEnquiryRead(db, {
          clientId: created.client_id,
          externalId: EXTERNAL_ID,
          source: "wix",
          userId: specA.id,
        });
        const visible = await openedEnquiryIdentities(db, [
          { id: EXTERNAL_ID, source: "wix" },
          { id: EXTERNAL_ID, source: "database" },
        ]);
        return { opened, again, visible };
      }, { commit: true });
      expect(saved.opened).toBe(true);
      expect(saved.again).toBe(false);
      expect(saved.visible).toEqual([`wix:${EXTERNAL_ID}`]);

      const hidden = await asContext(staffCtx(specB), (db) => openedEnquiryIdentities(db, [{ id: EXTERNAL_ID, source: "wix" }]));
      expect(hidden).toEqual([]);
      await expect(asContext(staffCtx(specB), (db) => markEnquiryRead(db, {
        clientId: created.client_id,
        externalId: OTHER_ID,
        source: "database",
        userId: specB.id,
      }))).rejects.toThrow();

      const reader = await asContext(staffCtx(readonly), (db) => markEnquiryRead(db, {
        clientId: created.client_id,
        externalId: OTHER_ID,
        source: "database",
        userId: readonly.id,
      }), { commit: true });
      expect(reader).toBe(true);
      await expect(asContext(staffCtx(admin), (db) => db.query("delete from enquiry_reads where external_id = $1", [EXTERNAL_ID]))).rejects.toThrow(/permission denied/);
    } finally {
      await adminPool.query("delete from enquiry_reads where client_id = $1", [created.client_id]);
      await adminPool.query("delete from memberships where client_id = $1", [created.client_id]);
      await adminPool.query("delete from websites where id = $1", [created.id]);
      await adminPool.query("delete from clients where id = $1", [created.client_id]);
    }
  });
});
