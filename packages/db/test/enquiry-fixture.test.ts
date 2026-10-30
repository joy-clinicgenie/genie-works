import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { loadRootEnv, requireEnv } from "../src/env";
import { enquiryFixtureUrlFromAdmin } from "../src/testing/targets";
import { setEnquiryFollowUp, websiteFormConfigPresent } from "../src/services/enquiry-follow-up";
import {
  HARBOUR_DUPLICATE_KEY,
  RETRY_FAILURE_OUTBOX_ID,
  RETRY_SUCCESS_OUTBOX_ID,
  checkEnquiryFixture,
  ensureEnquiryDatabase,
  requeueNotification,
  resetEnquiryFixture,
} from "../src/testing/enquiry-fixture";

loadRootEnv();
delete process.env.ENQUIRY_DATABASE_URL;
const fixtureUrl = enquiryFixtureUrlFromAdmin(requireEnv("DATABASE_ADMIN_URL"));

describe("synthetic enquiry fixture", () => {
  afterAll(async () => {
    await resetEnquiryFixture(fixtureUrl);
  });

  it("resets labelled records and keeps a retry from creating another enquiry", async () => {
    await ensureEnquiryDatabase(requireEnv("DATABASE_ADMIN_URL"));
    const summary = await resetEnquiryFixture(fixtureUrl);
    expect(summary.database).toBe("clinic_genie_enquiry_test");
    expect(summary.host).toBe("127.0.0.1");
    expect(summary.clinics).toEqual(["harbourview-dental", "meridian-skin", "northgate-physio"]);
    expect(summary.enquiries).toBe(6);
    expect(summary.notifications).toBe(6);
    expect(summary.mailSink).toBe("notification_outbox");

    const url = fixtureUrl;
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    try {
      const statuses = await pool.query<{ status: string; count: number }>(
        "select status, count(*)::int as count from enquiries group by status order by status",
      );
      expect(Object.fromEntries(statuses.rows.map((row) => [row.status, row.count]))).toEqual({ acknowledged: 2, closed: 1, new: 3 });
      const websites = await pool.query<{ website_key: string }>("select distinct website_key from enquiries order by website_key");
      expect(websites.rows.map((row) => row.website_key)).toEqual([
        "harbourview-dental-wix",
        "meridian-skin-production",
        "meridian-skin-staging",
        "northgate-physio-wix",
      ]);
      const sources = await pool.query<{ attribution_source: string }>("select distinct attribution_source from enquiries order by 1");
      expect(sources.rows.map((row) => row.attribution_source)).toEqual(["campaign", "direct", "organic", "referral"]);

      const before = await pool.query<{ count: number }>("select count(*)::int as count from enquiries");
      await expect(pool.query(
        `insert into enquiries (
           id, public_reference, clinic_id, form_key, form_version, idempotency_key, payload_digest,
           name, contact_number, email, reason, attribution_source, notice_version, status, is_synthetic, created_at
         ) values (
           '11111111-1111-4111-8111-111111111199', 'TEST-DUP', 'harbourview-dental', 'appointment-enquiry', 1, $1, 'other',
           'Other', '11111111', 'other.person@example.invalid', 'general-enquiry', 'direct', 'fixture-notice-v1', 'new', true, now()
         )`,
        [HARBOUR_DUPLICATE_KEY],
      )).rejects.toThrow(/duplicate key/);
      expect((await pool.query<{ count: number }>("select count(*)::int as count from enquiries")).rows[0]?.count).toBe(before.rows[0]?.count);
      const kept = await pool.query<{ public_reference: string; name: string; email: string | null; contact_number: string }>(
        "select public_reference, name, email, contact_number from enquiries where clinic_id = 'harbourview-dental' and idempotency_key = $1",
        [HARBOUR_DUPLICATE_KEY],
      );
      expect(kept.rows).toEqual([{
        public_reference: "TEST-HV-NEW-001",
        name: "Test Person Harbour",
        email: "harbour.person@example.invalid",
        contact_number: "00000000",
      }]);

      const shape = await pool.query<{ id: string }>(
        `insert into enquiries (
           public_reference, clinic_id, form_key, form_version, idempotency_key, payload_digest,
           name, contact_number, reason, notice_version, consent_acknowledged_at, is_synthetic
         ) values ($1, $2, 'appointment-enquiry', 1, $3, 'test', 'Test submission', '00000000', 'Test submission', 'test', now(), true)
         returning id`,
        ["TEST-SHAPE", "harbourview-dental", "fixture-shape-only"],
      );
      expect(shape.rows[0]?.id).toBeTruthy();
      await pool.query("delete from enquiries where public_reference = 'TEST-SHAPE'");

      const harbourOnly = await pool.query<{ clinic_id: string }>(
        "select clinic_id from enquiries where clinic_id = any($1::text[])",
        [["harbourview-dental"]],
      );
      expect(new Set(harbourOnly.rows.map((row) => row.clinic_id))).toEqual(new Set(["harbourview-dental"]));

      expect(await requeueNotification(url, RETRY_SUCCESS_OUTBOX_ID, ["harbourview-dental"])).toEqual({ id: RETRY_SUCCESS_OUTBOX_ID });
      expect(await requeueNotification(url, RETRY_FAILURE_OUTBOX_ID, ["harbourview-dental"])).toBeNull();
      expect(await requeueNotification(url, RETRY_SUCCESS_OUTBOX_ID, ["northgate-physio"])).toBeNull();
      expect((await pool.query<{ count: number }>("select count(*)::int as count from enquiries")).rows[0]?.count).toBe(6);
      const requeued = await pool.query<{ status: string }>("select status from notification_outbox where id = $1", [RETRY_SUCCESS_OUTBOX_ID]);
      expect(requeued.rows[0]?.status).toBe("pending");

      const closedId = "11111111-1111-4111-8111-111111111103";
      const closedBefore = await pool.query<{ status: string; name: string; email: string | null }>("select status, name, email from enquiries where id = $1", [closedId]);
      expect(closedBefore.rows[0]?.status).toBe("closed");
      const viewed = await pool.query<{ status: string }>("select status from enquiries where id = $1", [closedId]);
      expect(viewed.rows[0]?.status).toBe("closed");
      const opened = await setEnquiryFollowUp(pool, { id: closedId, fromStatus: "closed", toStatus: "new", scope: ["harbourview-dental"] });
      expect(opened?.reference).toBe("TEST-HV-CLOSED-003");
      const after = await pool.query<{ status: string; name: string; email: string | null }>("select status, name, email from enquiries where id = $1", [closedId]);
      expect(after.rows[0]).toEqual({ status: "new", name: closedBefore.rows[0]?.name, email: closedBefore.rows[0]?.email });
      expect(await setEnquiryFollowUp(pool, { id: closedId, fromStatus: "closed", toStatus: "acknowledged", scope: ["harbourview-dental"] })).toBeNull();
      expect(await setEnquiryFollowUp(pool, { id: closedId, fromStatus: "new", toStatus: "closed", scope: ["northgate-physio"] })).toBeNull();
      expect((await pool.query<{ status: string }>("select status from enquiries where id = $1", [closedId])).rows[0]?.status).toBe("new");
      expect(await websiteFormConfigPresent(pool)).toBe(false);
      expect(await setEnquiryFollowUp(pool, { id: closedId, fromStatus: "new", toStatus: "closed", scope: null })).toMatchObject({ id: closedId });
    } finally {
      await pool.end();
    }

    const checked = await checkEnquiryFixture(fixtureUrl);
    expect(checked.enquiries).toBe(6);
  });
});
