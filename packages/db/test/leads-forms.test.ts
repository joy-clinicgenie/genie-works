import { afterAll, describe, expect, it } from "vitest";
import { listAuditEvents, recordAudit } from "../src/services/audit";
import { canExport } from "../src/services/auth";
import { listEnquiryStatusEvents, recordEnquiryStatusEvent, setEnquiryFollowUp } from "../src/services/enquiry-follow-up";
import { listFormWebsites, listWebsiteForms, markWebsiteFormUnverified, saveWebsiteForm } from "../src/services/website-forms";
import { grantMembership, revokeMembership } from "../src/services/registry";
import { adminPool, appPool, asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const ENQUIRY_ID = "11111111-1111-4111-8111-111111111103";

describe("leads and forms records", () => {
  it("stores follow-up history without the enquiry body and keeps other clinics out", async () => {
    const columns = await adminPool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'enquiry_status_events'",
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain("actor_user_id");
    expect(names).toContain("note");
    expect(names).not.toContain("email");
    expect(names).not.toContain("contact_number");
    expect(names).not.toContain("message");
    expect(names).not.toContain("name");

    const admin = await staffByEmail("admin@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const readonly = await staffByEmail("readonly@example.invalid");
    const harbour = await clientBySlug("meridian-skin");
    const saved = await asContext(staffCtx(admin), async (db) => {
      const event = await recordEnquiryStatusEvent(db, {
        enquiryId: ENQUIRY_ID,
        clinicSlug: "meridian-skin",
        websiteKey: "meridian-skin-production",
        fromStatus: "closed",
        toStatus: "new",
        note: "Reopened for a call back",
        actorUserId: admin.id,
      });
      const events = await listEnquiryStatusEvents(db, ENQUIRY_ID);
      expect(event.clientId).toBe(harbour);
      expect(events[0]?.to_status).toBe("new");
      expect(events[0]?.from_status).toBe("closed");
      expect(events[0]?.note).toBe("Reopened for a call back");
      expect(events[0]).not.toHaveProperty("email");
      await expect(db.query("update enquiry_status_events set note = 'changed' where id = $1", [event.id])).rejects.toThrow(/permission denied/);
      return event.id;
    });
    expect(saved).toBeTruthy();
    await expect(asContext(staffCtx(specB), (db) => recordEnquiryStatusEvent(db, {
      enquiryId: ENQUIRY_ID,
      clinicSlug: "meridian-skin",
      websiteKey: null,
      fromStatus: "new",
      toStatus: "closed",
      note: null,
      actorUserId: specB.id,
    }))).rejects.toThrow();
    await expect(asContext(staffCtx(readonly), (db) => recordEnquiryStatusEvent(db, {
      enquiryId: ENQUIRY_ID,
      clinicSlug: "meridian-skin",
      websiteKey: null,
      fromStatus: "new",
      toStatus: "acknowledged",
      note: null,
      actorUserId: readonly.id,
    }))).rejects.toThrow();
    const hidden = await asContext(staffCtx(specB), (db) => db.query("select id from enquiry_status_events where clinic_slug = 'meridian-skin'"));
    expect(hidden.rows).toHaveLength(0);

    const owned = await adminPool.query<{ id: string }>(
      `insert into enquiry_status_events (enquiry_id, client_id, clinic_slug, from_status, to_status, actor_user_id)
       select $1, c.id, c.slug, 'closed', 'new', $2 from clients c where c.slug = 'meridian-skin' returning id`,
      [ENQUIRY_ID, admin.id],
    );
    const ownedId = owned.rows[0]?.id;
    expect(ownedId).toBeTruthy();
    try {
      await expect(adminPool.query("update enquiry_status_events set note = 'changed' where id = $1", [ownedId])).rejects.toThrow(/append-only/);
    } finally {
      await adminPool.query("alter table enquiry_status_events disable trigger enquiry_status_events_no_delete");
      await adminPool.query("delete from enquiry_status_events where id = $1", [ownedId]);
      await adminPool.query("alter table enquiry_status_events enable trigger enquiry_status_events_no_delete");
    }
  });

  it("changes enquiry status only when the expected status still matches", async () => {
    const id = "11111111-1111-4111-8111-111111111103";
    const calls: string[] = [];
    const query = {
      async query(sql: string) {
        calls.push(sql);
        return { rows: sql.includes("update enquiries") ? [{ id, clinic_id: "meridian-skin", website_key: "meridian-skin-production", public_reference: "TEST-MS-CLOSED-003" }] : [] };
      },
    };
    const runner = query as unknown as Parameters<typeof setEnquiryFollowUp>[0];
    expect(await setEnquiryFollowUp(runner, { id, fromStatus: "closed", toStatus: "closed", scope: ["meridian-skin"] })).toBeNull();
    expect(calls).toHaveLength(0);
    const opened = await setEnquiryFollowUp(runner, { id, fromStatus: "closed", toStatus: "new", scope: ["meridian-skin"] });
    expect(opened?.reference).toBe("TEST-MS-CLOSED-003");
    expect(calls[0]).toContain("set status = $1");
    expect(calls[0]).toContain("and status = $3");
    expect(calls[0]).not.toMatch(/name|email|message|contact_number/);
  });

  it("saves website routing as a proposal and does not mark it applied", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const harbour = await clientBySlug("meridian-skin");
    await asContext(staffCtx(admin), async (db) => {
      const sites = await listFormWebsites(db, [harbour]);
      const site = sites.find((item) => item.enquiry_key === "meridian-skin-production") ?? sites[0];
      expect(site).toBeTruthy();
      const saved = await saveWebsiteForm(db, {
        websiteId: site!.id,
        clientId: harbour,
        formKey: "appointment-enquiry",
        displayName: "Appointment enquiry",
        pagePath: "/request-appointment",
        proposedActive: true,
        consentWording: "Consent proposal",
        screenConfirmation: "Shown on the page",
        emailAcknowledgement: "Sent by email",
        recipientContactId: null,
        updatedBy: admin.id,
      });
      expect(saved.application_status).toBe("pending_website_update");
      expect(saved.screen_confirmation).toBe("Shown on the page");
      expect(saved.email_acknowledgement).toBe("Sent by email");
      const checked = await markWebsiteFormUnverified(db, { websiteId: site!.id, formKey: "appointment-enquiry", actorUserId: admin.id });
      expect(checked.application_status).toBe("unable_to_verify");
      expect(checked.application_status).not.toBe("applied");
      expect(checked.last_verified_at).toBeTruthy();
    });
    await expect(asContext(staffCtx(specA), async (db) => {
      const sites = await listFormWebsites(db, [harbour]);
      await saveWebsiteForm(db, {
        websiteId: sites[0]!.id,
        clientId: harbour,
        formKey: "contact",
        displayName: "Contact",
        pagePath: "/contact",
        proposedActive: false,
        consentWording: null,
        screenConfirmation: null,
        emailAcknowledgement: null,
        recipientContactId: null,
        updatedBy: specA.id,
      });
    })).rejects.toThrow();
    const membershipId = await asContext(staffCtx(admin), async (db) => {
      const granted = await grantMembership(db, { userId: specB.id, clientId: harbour }, admin.id);
      const sites = await listFormWebsites(db, [harbour]);
      const site = sites[0];
      expect(site).toBeTruthy();
      await saveWebsiteForm(db, {
        websiteId: site!.id,
        clientId: harbour,
        formKey: "appointment-enquiry",
        displayName: "Appointment enquiry",
        pagePath: "/request-appointment",
        proposedActive: true,
        consentWording: null,
        screenConfirmation: null,
        emailAcknowledgement: null,
        recipientContactId: null,
        updatedBy: admin.id,
      });
      return granted;
    }, { commit: true });
    try {
      const visible = await asContext(staffCtx(specB), (db) => listWebsiteForms(db, null));
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every((row) => row.client_id === harbour)).toBe(true);
      expect(canExport({ user: { platform_role: specB.platform_role } } as never)).toBe(false);
    } finally {
      await adminPool.query("delete from website_forms where client_id = $1 and form_key = 'appointment-enquiry'", [harbour]);
      await asContext(staffCtx(admin), (db) => revokeMembership(db, membershipId, admin.id, harbour), { commit: true });
    }
  });

  it("lists a manual notification retry without the enquiry body", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const harbour = await clientBySlug("meridian-skin");
    const outboxId = "22222222-2222-4222-8222-222222222202";
    await asContext(staffCtx(admin), async (db) => {
      await recordAudit(db, {
        actorType: "staff",
        actorUserId: admin.id,
        action: "notification.retry",
        targetType: "notification_outbox",
        targetId: outboxId,
        clientId: harbour,
        outcome: "success",
        metadata: { clinicId: "meridian-skin" },
      });
      await recordAudit(db, {
        actorType: "staff",
        actorUserId: admin.id,
        action: "form_submission.view",
        targetType: "form_submission",
        targetId: outboxId,
        clientId: harbour,
        outcome: "success",
        metadata: { reference: "TEST-MS" },
      });
      const rows = await listAuditEvents(db, { action: "notification.retry", targetIds: [outboxId] });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actor_name).toBeTruthy();
      expect(JSON.stringify(rows[0]?.metadata)).not.toMatch(/email|telephone|message/i);
      expect(await listAuditEvents(db, { action: "notification.retry", targetIds: [] })).toHaveLength(0);
    });
  });
});
