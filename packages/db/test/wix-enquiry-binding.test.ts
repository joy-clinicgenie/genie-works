import { afterAll, describe, expect, it } from "vitest";
import { applyContext } from "../src/client";
import { grantMembership } from "../src/services/registry";
import { listWixFollowUpStatuses, setWixEnquiryFollowUp } from "../src/services/wix-enquiry-binding";
import { adminPool, appPool, asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";

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

    const site = (await adminPool.query<{ id: string; enquiry_source: string; wix_instance_id: string | null; wix_form_id: string | null; wix_form_namespace: string | null; wix_form_key: string | null; wix_counts_in_totals: boolean }>(
      `select id, enquiry_source, wix_instance_id, wix_form_id, wix_form_namespace, wix_form_key, wix_counts_in_totals
       from websites where enquiry_key = 'meridian-skin-production'`,
    )).rows[0];
    expect(site).toBeTruthy();
    const admin = await staffByEmail("admin@example.invalid");
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
          enquiryKey: "meridian-skin-production",
          fromStatus: "new",
          toStatus: "acknowledged",
          scope: ["meridian-skin"],
        });
        const stale = await setWixEnquiryFollowUp(db, {
          externalId: EXTERNAL_ID,
          enquiryKey: "meridian-skin-production",
          fromStatus: "new",
          toStatus: "closed",
          scope: ["meridian-skin"],
        });
        const closed = await setWixEnquiryFollowUp(db, {
          externalId: EXTERNAL_ID,
          enquiryKey: "meridian-skin-production",
          fromStatus: "acknowledged",
          toStatus: "closed",
          scope: ["meridian-skin"],
        });
        const visible = await listWixFollowUpStatuses(db, [EXTERNAL_ID]);
        return { opened, stale, closed, visible };
      });
      expect(saved.opened).toEqual({ id: EXTERNAL_ID, clinicId: "meridian-skin", websiteKey: "meridian-skin-production" });
      expect(saved.stale).toBeNull();
      expect(saved.closed?.clinicId).toBe("meridian-skin");
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
        enquiryKey: "meridian-skin-production",
        fromStatus: "new",
        toStatus: "acknowledged",
        scope: ["clinic-genie"],
      }));
      expect(outsider).toBeNull();
      const meridian = await clientBySlug("meridian-skin");
      await expect(asContext(staffCtx(admin), async (db) => {
        await grantMembership(db, { userId: readonly.id, clientId: meridian }, admin.id);
        await applyContext(db, staffCtx(readonly));
        await setWixEnquiryFollowUp(db, {
          externalId: EXTERNAL_ID,
          enquiryKey: "meridian-skin-production",
          fromStatus: "new",
          toStatus: "acknowledged",
          scope: ["meridian-skin"],
        });
      })).rejects.toThrow();
      await expect(asContext(staffCtx(admin), (db) => db.query("delete from enquiry_follow_ups where external_id = $1", [EXTERNAL_ID]))).rejects.toThrow(/permission denied/);
      await expect(adminPool.query(
        "update enquiry_follow_ups set external_id = '33333333-3333-4333-8333-333333333333' where external_id = $1",
        [EXTERNAL_ID],
      )).rejects.toThrow(/cannot change/);
    } finally {
      await adminPool.query("delete from enquiry_follow_ups where external_id = $1", [EXTERNAL_ID]);
      await adminPool.query(
        `update websites
         set enquiry_source = $2, wix_instance_id = $3, wix_form_id = $4,
             wix_form_namespace = $5, wix_form_key = $6, wix_counts_in_totals = $7
         where id = $1`,
        [site!.id, site!.enquiry_source, site!.wix_instance_id, site!.wix_form_id, site!.wix_form_namespace, site!.wix_form_key, site!.wix_counts_in_totals],
      );
    }
  });
});
