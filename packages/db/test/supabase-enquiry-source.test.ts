import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { assertSupabaseEnquiryUrl } from "../src/testing/targets";
import { getSupabaseEnquiryWebsite, listExternalFollowUpStatuses, setSupabaseEnquiryFollowUp } from "../src/services/enquiry-source";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";

const EXTERNAL_ID = "33333333-3333-4333-8333-333333333333";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("Supabase enquiry URL guard (D85)", () => {
  const env = { VITEST: undefined };
  it("accepts a dedicated read-only role on a remote host", () => {
    expect(assertSupabaseEnquiryUrl("postgresql://genie_works_reader:pw@db.example.invalid:5432/postgres", env)).toEqual({ host: "remote", database: "postgres" });
  });

  it("refuses the owner, the pooled owner and the service role", () => {
    for (const user of ["postgres", "postgres.abcdefghij", "service_role", "supabase_admin"]) {
      expect(() => assertSupabaseEnquiryUrl(`postgresql://${user}:pw@db.example.invalid:5432/postgres`, env)).toThrow(/read-only enquiry role/);
    }
  });

  it("refuses the sibling clinic database, a local host outside tests, and the platform database", () => {
    expect(() => assertSupabaseEnquiryUrl("postgresql://reader:pw@db.example.invalid:54329/postgres", env)).toThrow(/54329/);
    expect(() => assertSupabaseEnquiryUrl("postgresql://reader:pw@127.0.0.1:5432/postgres", env)).toThrow(/local host/);
    expect(() => assertSupabaseEnquiryUrl("postgresql://reader:pw@db.example.invalid:5432/postgres", { DATABASE_URL: "postgresql://cg_app:x@db.example.invalid:5432/postgres" })).toThrow(/DATABASE_URL/);
    expect(() => assertSupabaseEnquiryUrl("not a url", env)).toThrow(/not valid/);
  });
});

describe("Supabase enquiry follow-up (D85)", () => {
  it("stores status only, refuses stale and unauthorised changes, and keeps other clinics out", async () => {
    const columns = (await adminPool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'enquiry_follow_ups'",
    )).rows.map((row) => row.column_name);
    for (const forbidden of ["email", "name", "message", "phone", "clinic_name", "specialty"]) expect(columns).not.toContain(forbidden);

    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const readonly = await staffByEmail("readonly@example.invalid");
    const slug = `sb-${randomBytes(3).toString("hex")}`;
    const db = await adminPool.connect();
    try {
      await db.query("begin");
      // Owner connection for setup; each staff check below runs as cg_app under RLS in its own context.
      await db.query("update websites set enquiry_source = 'database' where enquiry_source = 'supabase'");
      const created = (await db.query<{ client_id: string; id: string }>(
        `with clinic as (
           insert into clients (slug, name, owner_user_id, channels, is_synthetic, created_by, updated_by)
           values ($1, 'Supabase source clinic (fictional)', $2, array['website'], true, $2, $2)
           returning id
         )
         insert into websites (client_id, name, url, platform, environment, enquiry_key)
         select id, 'Website', 'https://supabase-source.example.invalid', 'Next.js', 'production', $3 from clinic
         returning client_id, id`,
        [slug, admin.id, `${slug}-production`],
      )).rows[0]!;
      await db.query("insert into memberships (user_id, client_id, granted_by) values ($1, $2, $3)", [specA.id, created.client_id, admin.id]);
      await db.query("insert into memberships (user_id, client_id, granted_by) values ($1, $2, $3)", [readonly.id, created.client_id, admin.id]);

      // A database-source website cannot hold follow-up rows.
      await db.query("savepoint plain");
      await expect(db.query(
        "insert into enquiry_follow_ups (website_id, client_id, external_id, status) values ($1, $2, $3, 'new')",
        [created.id, created.client_id, EXTERNAL_ID],
      )).rejects.toThrow(/externally read enquiry website/);
      await db.query("rollback to savepoint plain");

      await db.query("update websites set enquiry_source = 'supabase' where id = $1", [created.id]);
      await db.query("commit");
    } catch (err) {
      await db.query("rollback");
      db.release();
      throw err;
    }
    db.release();

    try {
      const saved = await asContext(staffCtx(specA), async (tx) => {
        const site = await getSupabaseEnquiryWebsite(tx, [slug]);
        const opened = await setSupabaseEnquiryFollowUp(tx, { externalId: EXTERNAL_ID, fromStatus: "new", toStatus: "acknowledged", scope: [slug] });
        const stale = await setSupabaseEnquiryFollowUp(tx, { externalId: EXTERNAL_ID, fromStatus: "new", toStatus: "closed", scope: [slug] });
        const closed = await setSupabaseEnquiryFollowUp(tx, { externalId: EXTERNAL_ID, fromStatus: "acknowledged", toStatus: "closed", scope: [slug] });
        const invalid = await setSupabaseEnquiryFollowUp(tx, { externalId: "not-a-uuid", fromStatus: "new", toStatus: "closed", scope: [slug] });
        const visible = await listExternalFollowUpStatuses(tx, [EXTERNAL_ID.toUpperCase()]);
        return { site, opened, stale, closed, invalid, visible };
      });
      expect(saved.site?.clientSlug).toBe(slug);
      expect(saved.opened).toEqual({ id: EXTERNAL_ID, clinicId: slug, websiteKey: `${slug}-production` });
      expect(saved.stale).toBeNull();
      expect(saved.closed?.clinicId).toBe(slug);
      expect(saved.invalid).toBeNull();
      expect(saved.visible).toEqual([{ externalId: EXTERNAL_ID, status: "closed" }]);

      // Concurrency: two staff starting from New; only one insert wins.
      const [first, second] = await Promise.all([
        asContext(staffCtx(admin), (tx) => setSupabaseEnquiryFollowUp(tx, { externalId: "44444444-4444-4444-8444-444444444444", fromStatus: "new", toStatus: "acknowledged", scope: null }), { commit: true }),
        asContext(staffCtx(admin), (tx) => setSupabaseEnquiryFollowUp(tx, { externalId: "44444444-4444-4444-8444-444444444444", fromStatus: "new", toStatus: "closed", scope: null }), { commit: true }),
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);

      // Another clinic's specialist sees neither the website nor its follow-up, and cannot write.
      const outsider = await asContext(staffCtx(specB), async (tx) => ({
        site: await getSupabaseEnquiryWebsite(tx, null),
        statuses: await listExternalFollowUpStatuses(tx, ["44444444-4444-4444-8444-444444444444"]),
        write: await setSupabaseEnquiryFollowUp(tx, { externalId: EXTERNAL_ID, fromStatus: "new", toStatus: "closed", scope: null }),
      }));
      expect(outsider).toEqual({ site: null, statuses: [], write: null });

      // Read-only member can see the status but RLS refuses the write.
      const viewer = await asContext(staffCtx(readonly), async (tx) => ({
        statuses: await listExternalFollowUpStatuses(tx, ["44444444-4444-4444-8444-444444444444"]),
        write: await setSupabaseEnquiryFollowUp(tx, { externalId: "55555555-5555-4555-8555-555555555555", fromStatus: "new", toStatus: "closed", scope: null }).catch(() => "refused"),
      }));
      expect(viewer.statuses).toHaveLength(1);
      expect(viewer.write === null || viewer.write === "refused").toBe(true);
    } finally {
      await adminPool.query("delete from enquiry_follow_ups where client_id = (select id from clients where slug = $1)", [slug]);
      await adminPool.query("update websites set enquiry_source = 'database', status = 'archived' where client_id = (select id from clients where slug = $1)", [slug]);
      // Other files assume the seeded specialists hold no extra memberships.
      await adminPool.query("update memberships set active = false, revoked_at = now() where active and client_id = (select id from clients where slug = $1)", [slug]);
      await adminPool.query("update clients set status = 'archived' where slug = $1", [slug]);
    }
  });
});
