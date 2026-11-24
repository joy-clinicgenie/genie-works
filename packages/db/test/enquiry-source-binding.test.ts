import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { setWebsiteEnquirySource } from "../src/services/enquiry-source";
import { assertEnquiryKeyForSlug, createClient, createWebsite, enquiryKeyForClient, setWebsiteEnquiryKey } from "../src/services/registry";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("enquiry source binding", () => {
  it("builds a client-scoped key and refuses another clinic's key", () => {
    const taken = new Set(["fixture-source-production"]);
    expect(enquiryKeyForClient("fixture-source", "production", taken)).toBe("fixture-source-production-2");
    expect(enquiryKeyForClient("fixture-source", "staging", taken)).toBe("fixture-source-staging");
    expect(() => assertEnquiryKeyForSlug("fixture-source", "other-clinic-production")).toThrow(/slug/);
    expect(() => assertEnquiryKeyForSlug("fixture-source", "fixture-source-production")).not.toThrow();
  });

  it("assigns the native key, keeps it on this client, and lets only an administrator change the enquiry source", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const manager = await staffByEmail("manager@example.invalid");
    const specialist = await staffByEmail("specialist-a@example.invalid");
    const slug = `src${randomBytes(3).toString("hex")}`;
    const columns = (await adminPool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name in ('websites', 'enquiry_follow_ups')",
    )).rows.map((row) => row.column_name);
    for (const forbidden of ["email", "message", "phone", "contact_number", "submitter_name"]) {
      expect(columns).not.toContain(forbidden);
    }

    await asContext(staffCtx(admin), async (db) => {
      const client = await createClient(db, {
        slug, name: "Source Binding Clinic (fictional)", ownerUserId: admin.id, channels: ["website"], isSynthetic: true, notes: null,
      }, admin.id);
      const other = await createClient(db, {
        slug: `${slug}b`, name: "Other Source Clinic (fictional)", ownerUserId: admin.id, channels: ["website"], isSynthetic: true, notes: null,
      }, admin.id);
      const first = await createWebsite(db, { clientId: client.id, name: "Production", url: "https://source.example.invalid", platform: "Next.js", environment: "production", notes: null }, admin.id);
      const second = await createWebsite(db, { clientId: client.id, name: "Production two", url: "https://source-two.example.invalid", platform: "Next.js", environment: "production", notes: null }, admin.id);
      expect(first.enquiry_key).toBe(`${slug}-production`);
      expect(second.enquiry_key).toBe(`${slug}-production-2`);
      expect(first.enquiry_source).toBe("database");
      await expect(setWebsiteEnquiryKey(db, first.id, client.id, "other-clinic-production", admin.id)).rejects.toThrow(/slug/);
      await expect(setWebsiteEnquiryKey(db, first.id, other.id, `${slug}-production`, admin.id)).rejects.toThrow(/not available/);
      await setWebsiteEnquiryKey(db, first.id, client.id, `${slug}-notes`, admin.id);

      await db.query("savepoint specialist_key");
      await applyContext(db, staffCtx(specialist));
      await expect(setWebsiteEnquiryKey(db, first.id, client.id, `${slug}-specialist`, specialist.id)).rejects.toThrow(/permission|not available/i);
      await db.query("rollback to savepoint specialist_key");

      await applyContext(db, staffCtx(manager));
      await setWebsiteEnquiryKey(db, first.id, client.id, `${slug}-manager`, manager.id);
      await db.query("savepoint manager_source");
      await expect(setWebsiteEnquirySource(db, { clientId: client.id, websiteId: first.id, source: "supabase" }, manager.id)).rejects.toThrow(/administrator/i);
      await db.query("rollback to savepoint manager_source");

      await applyContext(db, staffCtx(admin));
      await expect(setWebsiteEnquirySource(db, { clientId: client.id, websiteId: first.id, source: "wix" }, admin.id)).rejects.toThrow(/Choose where/);
      await expect(setWebsiteEnquirySource(db, { clientId: other.id, websiteId: first.id, source: "supabase" }, admin.id)).rejects.toThrow(/not available/);
      // Any website already reading Supabase in the shared dev database is moved aside inside this rolled-back transaction.
      await db.query("update websites set enquiry_source = 'database' where enquiry_source = 'supabase'");
      await setWebsiteEnquirySource(db, { clientId: client.id, websiteId: first.id, source: "supabase" }, admin.id);
      expect((await db.query<{ enquiry_source: string }>("select enquiry_source from websites where id = $1", [first.id])).rows[0]?.enquiry_source).toBe("supabase");
      const audit = (await db.query<{ metadata: { source: string } }>(
        "select metadata from audit_events where action = 'enquiry_source.set' and target_id = $1",
        [first.id],
      )).rows;
      expect(audit.map((row) => row.metadata.source)).toEqual(["supabase"]);

      await db.query("savepoint second_supabase");
      await expect(setWebsiteEnquirySource(db, { clientId: client.id, websiteId: second.id, source: "supabase" }, admin.id)).rejects.toThrow(/already reads/);
      await db.query("rollback to savepoint second_supabase");

      await setWebsiteEnquirySource(db, { clientId: client.id, websiteId: first.id, source: "database" }, admin.id);
      await setWebsiteEnquirySource(db, { clientId: client.id, websiteId: second.id, source: "supabase" }, admin.id);
      const sources = (await db.query<{ id: string; enquiry_source: string }>(
        "select id, enquiry_source from websites where id = any($1::uuid[]) order by name",
        [[first.id, second.id]],
      )).rows.map((row) => row.enquiry_source);
      expect(sources).toEqual(["database", "supabase"]);
    });
  });
});
