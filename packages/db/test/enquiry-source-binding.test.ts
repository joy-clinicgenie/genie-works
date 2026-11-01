import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { bindWixEnquiryForm, clearWixEnquiryForm } from "../src/services/wix-enquiry-binding";
import { assertEnquiryKeyForSlug, createClient, createWebsite, enquiryKeyForClient, setWebsiteEnquiryKey } from "../src/services/registry";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const INSTANCE = "00000000-0000-4000-8000-0000000000b1";
const FORM = "00000000-0000-4000-8000-0000000000b2";

describe("enquiry source binding", () => {
  it("builds a client-scoped key and refuses another clinic's key", () => {
    const taken = new Set(["fixture-source-production"]);
    expect(enquiryKeyForClient("fixture-source", "production", taken)).toBe("fixture-source-production-2");
    expect(enquiryKeyForClient("fixture-source", "staging", taken)).toBe("fixture-source-staging");
    expect(() => assertEnquiryKeyForSlug("fixture-source", "other-clinic-production")).toThrow(/slug/);
    expect(() => assertEnquiryKeyForSlug("fixture-source", "fixture-source-production")).not.toThrow();
  });

  it("assigns the native key, keeps it on this client, and lets only an administrator connect a Wix form", async () => {
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
      await db.query("savepoint manager_bind");
      await expect(bindWixEnquiryForm(db, {
        clientId: client.id, websiteId: first.id, instanceId: INSTANCE, formId: FORM, formKey: "contact",
      }, manager.id)).rejects.toThrow(/administrator/i);
      await db.query("rollback to savepoint manager_bind");

      await applyContext(db, staffCtx(admin));
      await bindWixEnquiryForm(db, {
        clientId: client.id, websiteId: first.id, instanceId: INSTANCE, formId: FORM, formKey: "contact",
      }, admin.id);
      const bound = (await db.query<{ enquiry_source: string; wix_form_namespace: string; wix_counts_in_totals: boolean }>(
        "select enquiry_source, wix_form_namespace, wix_counts_in_totals from websites where id = $1",
        [first.id],
      )).rows[0];
      expect(bound).toEqual({ enquiry_source: "wix", wix_form_namespace: "wix.form_app.form", wix_counts_in_totals: false });
      expect((await db.query<{ n: number }>("select count(*)::int as n from enquiry_follow_ups where website_id = $1", [first.id])).rows[0]?.n).toBe(0);

      const staging = await createWebsite(db, { clientId: client.id, name: "Staging", url: "https://source-three.example.invalid", platform: "Next.js", environment: "staging", notes: null }, admin.id);
      await db.query("savepoint duplicate_form");
      await expect(bindWixEnquiryForm(db, {
        clientId: client.id, websiteId: staging.id, instanceId: INSTANCE, formId: FORM, formKey: "contact",
      }, admin.id)).rejects.toThrow(/already connected/);
      await db.query("rollback to savepoint duplicate_form");
      await expect(bindWixEnquiryForm(db, {
        clientId: other.id, websiteId: first.id, instanceId: "00000000-0000-4000-8000-0000000000b3", formId: "00000000-0000-4000-8000-0000000000b4", formKey: "contact",
      }, admin.id)).rejects.toThrow(/not available/);

      await db.query("savepoint manager_clear");
      await applyContext(db, staffCtx(manager));
      await expect(clearWixEnquiryForm(db, { clientId: client.id, websiteId: first.id }, manager.id)).rejects.toThrow(/administrator/i);
      await db.query("rollback to savepoint manager_clear");

      await applyContext(db, staffCtx(admin));
      await clearWixEnquiryForm(db, { clientId: client.id, websiteId: first.id }, admin.id);
      const cleared = (await db.query<{ enquiry_source: string; wix_form_id: string | null }>(
        "select enquiry_source, wix_form_id from websites where id = $1",
        [first.id],
      )).rows[0];
      expect(cleared).toEqual({ enquiry_source: "database", wix_form_id: null });
    });
  });
});
