import { afterAll, describe, expect, it } from "vitest";
import { applyContext } from "../src/client";
import { grantMembership } from "../src/services/registry";
import { listWixFollowUpStatuses, setWixEnquiryFollowUp } from "../src/services/wix-enquiry-binding";
import { randomBytes } from "node:crypto";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";

const EXTERNAL_ID = "22222222-2222-4222-8222-222222222222";
const INSTANCE_ID = "00000000-0000-4000-8000-0000000000a1";
const FORM_ID = "00000000-0000-4000-8000-0000000000a2";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("Wix enquiry follow-up", () => {
  it("stores status without the submission and keeps other clinics out", async () => {
    const columns = await adminPool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'enquiry_follow_ups'",
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toEqual(expect.arrayContaining(["website_id", "client_id", "external_id", "status", "updated_at"]));
    expect(names).not.toContain("email");
    expect(names).not.toContain("name");
    expect(names).not.toContain("message");
    expect(names).not.toContain("contact_number");
    expect(names).not.toContain("phone");

    const admin = await staffByEmail("admin@example.invalid");
    const slug = `check-${randomBytes(3).toString("hex")}`;
    const enquiryKey = `${slug}-site`;
    const created = (await adminPool.query<{ client_id: string; id: string }>(
      `with clinic as (
         insert into clients (slug, name, owner_user_id, channels, is_synthetic, created_by, updated_by)
         select $1, 'Check clinic', id, array['website'], true, id, id
         from staff_users where email = 'admin@example.invalid'
         returning id
       )
       insert into websites (client_id, name, url, platform, environment, enquiry_key)
       select id, 'Check website', 'https://check.example.invalid', 'Wix', 'production', $2
       from clinic
       returning client_id, id`,
      [slug, enquiryKey],
    )).rows[0]!;
    const site = { id: created.id, enquiry_source: "manual", wix_instance_id: null, wix_form_id: null, wix_form_namespace: null, wix_form_key: null, wix_counts_in_totals: false };
    const membershipId = (await adminPool.query<{ id: string }>(
      "insert into memberships (user_id, client_id, granted_by) values ($1, $2, $3) returning id",
      [(await staffByEmail("specialist-a@example.invalid")).id, created.client_id, admin.id],
    )).rows[0]!.id;
    const specA = await staffByEmail("specialist-a@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const readonly = await staffByEmail("readonly@example.invalid");

    await expect(adminPool.query(
      "update websites set wix_form_id = $2 where id = $1",
      [site!.id, FORM_ID],
    )).rejects.toThrow(/websites_wix_binding_shape/);

    try {
      await adminPool.query(
        `update websites
         set enquiry_source = 'wix', wix_instance_id = $2, wix_form_id = $3,
             wix_form_namespace = 'wix.form_app.form', wix_form_key = 'contact', wix_counts_in_totals = false
         where id = $1`,
        [site!.id, INSTANCE_ID, FORM_ID],
      );
      await expect(adminPool.query(
        `insert into enquiry_follow_ups (website_id, client_id, external_id, status)
         select w.id, c.id, $2, 'new'
         from websites w
         join clients c on c.slug = 'clinic-genie'
         where w.id = $1`,
        [site!.id, EXTERNAL_ID],
      )).rejects.toThrow(/Wix enquiry website/);

      const saved = await asContext(staffCtx(specA), async (db) => {
        const opened = await setWixEnquiryFollowUp(db, {
          externalId: EXTERNAL_ID,
          enquiryKey,
          fromStatus: "new",
          toStatus: "acknowledged",
          scope: [slug],
        });
        const stale = await setWixEnquiryFollowUp(db, {
          externalId: EXTERNAL_ID,
          enquiryKey,
          fromStatus: "new",
          toStatus: "closed",
          scope: [slug],
        });
        const closed = await setWixEnquiryFollowUp(db, {
          externalId: EXTERNAL_ID,
          enquiryKey,
          fromStatus: "acknowledged",
          toStatus: "closed",
          scope: [slug],
        });
        const visible = await listWixFollowUpStatuses(db, [EXTERNAL_ID]);
        return { opened, stale, closed, visible };
      });
      expect(saved.opened).toEqual({ id: EXTERNAL_ID, clinicId: slug, websiteKey: enquiryKey });
      expect(saved.stale).toBeNull();
      expect(saved.closed?.clinicId).toBe(slug);
      expect(saved.visible).toEqual([{ externalId: EXTERNAL_ID, status: "closed" }]);

      await adminPool.query(
        `insert into enquiry_follow_ups (website_id, client_id, external_id, status)
         select w.id, w.client_id, $2, 'new' from websites w where w.id = $1`,
        [site!.id, EXTERNAL_ID],
      );
      const hidden = await asContext(staffCtx(specB), (db) => listWixFollowUpStatuses(db, [EXTERNAL_ID]));
      expect(hidden).toEqual([]);
      const owned = await asContext(staffCtx(specA), (db) => listWixFollowUpStatuses(db, [EXTERNAL_ID]));
      expect(owned).toEqual([{ externalId: EXTERNAL_ID, status: "new" }]);
      const outsider = await asContext(staffCtx(specB), (db) => setWixEnquiryFollowUp(db, {
        externalId: EXTERNAL_ID,
        enquiryKey,
        fromStatus: "new",
        toStatus: "acknowledged",
        scope: ["clinic-genie"],
      }));
      expect(outsider).toBeNull();
      await expect(asContext(staffCtx(admin), async (db) => {
        await grantMembership(db, { userId: readonly.id, clientId: created.client_id }, admin.id);
        await applyContext(db, staffCtx(readonly));
        await setWixEnquiryFollowUp(db, {
          externalId: EXTERNAL_ID,
          enquiryKey,
          fromStatus: "new",
          toStatus: "acknowledged",
          scope: [slug],
        });
      })).rejects.toThrow();
      await expect(asContext(staffCtx(admin), (db) => db.query("delete from enquiry_follow_ups where external_id = $1", [EXTERNAL_ID]))).rejects.toThrow(/permission denied/);
      await expect(adminPool.query(
        "update enquiry_follow_ups set external_id = '33333333-3333-4333-8333-333333333333' where external_id = $1",
        [EXTERNAL_ID],
      )).rejects.toThrow(/cannot change/);
    } finally {
      await adminPool.query("delete from enquiry_follow_ups where external_id = $1", [EXTERNAL_ID]);
      await adminPool.query("delete from memberships where client_id = $1", [created.client_id]);
      await adminPool.query("delete from websites where id = $1", [created.id]);
      for (const table of ["audit_events", "timeline_events"]) {
        await adminPool.query(`alter table ${table} disable trigger user`);
      }
      await adminPool.query("delete from audit_events where client_id = $1", [created.client_id]);
      await adminPool.query("delete from timeline_events where client_id = $1", [created.client_id]);
      await adminPool.query("delete from clients where id = $1", [created.client_id]);
      for (const table of ["audit_events", "timeline_events"]) {
        await adminPool.query(`alter table ${table} enable trigger user`);
      }
      void membershipId;
    }
  });
});
