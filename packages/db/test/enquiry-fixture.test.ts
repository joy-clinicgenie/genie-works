import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { loadRootEnv, requireEnv } from "../src/env";
import { SUITE_ENQUIRY_DATABASES, suiteEnquiryFixtureUrl } from "../src/testing/targets";
import { setEnquiryFollowUp, websiteFormConfigPresent } from "../src/services/enquiry-follow-up";
import {
  FIXTURE_DUPLICATE_KEY,
  RETRY_FAILURE_OUTBOX_ID,
  RETRY_SUCCESS_OUTBOX_ID,
  checkEnquiryFixture,
  disposeSuiteEnquiryDatabase,
  ensureEnquiryDatabase,
  requeueNotification,
  resetEnquiryFixture,
} from "../src/testing/enquiry-fixture";

loadRootEnv();
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
const fixtureUrl = suiteEnquiryFixtureUrl(adminUrl, "db");

describe("synthetic enquiry fixture", () => {
  beforeAll(async () => {
    await ensureEnquiryDatabase(adminUrl, fixtureUrl);
  });

  afterAll(async () => {
    await disposeSuiteEnquiryDatabase(adminUrl, "db");
  });

  it("resets labelled records and keeps a retry from creating another enquiry", async () => {
    await ensureEnquiryDatabase(adminUrl, fixtureUrl);
    const summary = await resetEnquiryFixture(fixtureUrl);
    expect(summary.database).toBe(SUITE_ENQUIRY_DATABASES.db);
    expect(summary.database).not.toBe("clinic_genie_enquiry_test");
    expect(summary.host).toBe("127.0.0.1");
    expect(summary.clinics).toEqual(["meridian-skin"]);
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
        "meridian-skin-production",
        "meridian-skin-staging",
      ]);
      const sources = await pool.query<{ attribution_source: string }>("select distinct attribution_source from enquiries order by 1");
      expect(sources.rows.map((row) => row.attribution_source)).toEqual(["campaign", "direct", "organic", "referral"]);

      const before = await pool.query<{ count: number }>("select count(*)::int as count from enquiries");
      await expect(pool.query(
        `insert into enquiries (
           id, public_reference, clinic_id, form_key, form_version, idempotency_key, payload_digest,
           name, contact_number, email, reason, attribution_source, notice_version, status, is_synthetic, created_at
         ) values (
           '11111111-1111-4111-8111-111111111199', 'TEST-DUP', 'meridian-skin', 'appointment-enquiry', 1, $1, 'other',
           'Other', '11111111', 'other.person@example.invalid', 'general-enquiry', 'direct', 'fixture-notice-v1', 'new', true, now()
         )`,
        [FIXTURE_DUPLICATE_KEY],
      )).rejects.toThrow(/duplicate key/);
      expect((await pool.query<{ count: number }>("select count(*)::int as count from enquiries")).rows[0]?.count).toBe(before.rows[0]?.count);
      const kept = await pool.query<{ public_reference: string; name: string; email: string | null; contact_number: string }>(
        "select public_reference, name, email, contact_number from enquiries where clinic_id = 'meridian-skin' and idempotency_key = $1",
        [FIXTURE_DUPLICATE_KEY],
      );
      expect(kept.rows).toEqual([{
        public_reference: "TEST-MS-NEW-001",
        name: "Test Person Meridian One",
        email: "meridian.one@example.invalid",
        contact_number: "00000000",
      }]);

      const shape = await pool.query<{ id: string }>(
        `insert into enquiries (
           public_reference, clinic_id, form_key, form_version, idempotency_key, payload_digest,
           name, contact_number, reason, notice_version, consent_acknowledged_at, is_synthetic
         ) values ($1, $2, 'appointment-enquiry', 1, $3, 'test', 'Test submission', '00000000', 'Test submission', 'test', now(), true)
         returning id`,
        ["TEST-SHAPE", "meridian-skin", "fixture-shape-only"],
      );
      expect(shape.rows[0]?.id).toBeTruthy();
      await pool.query("delete from enquiries where public_reference = 'TEST-SHAPE'");

      const meridianOnly = await pool.query<{ clinic_id: string }>(
        "select clinic_id from enquiries where clinic_id = any($1::text[])",
        [["meridian-skin"]],
      );
      expect(new Set(meridianOnly.rows.map((row) => row.clinic_id))).toEqual(new Set(["meridian-skin"]));

      expect(await requeueNotification(url, RETRY_SUCCESS_OUTBOX_ID, ["meridian-skin"])).toEqual({ id: RETRY_SUCCESS_OUTBOX_ID });
      expect(await requeueNotification(url, RETRY_FAILURE_OUTBOX_ID, ["meridian-skin"])).toBeNull();
      expect(await requeueNotification(url, RETRY_SUCCESS_OUTBOX_ID, ["clinic-genie"])).toBeNull();
      expect((await pool.query<{ count: number }>("select count(*)::int as count from enquiries")).rows[0]?.count).toBe(6);
      const requeued = await pool.query<{ status: string }>("select status from notification_outbox where id = $1", [RETRY_SUCCESS_OUTBOX_ID]);
      expect(requeued.rows[0]?.status).toBe("pending");

      const closedId = "11111111-1111-4111-8111-111111111103";
      const closedBefore = await pool.query<{ status: string; name: string; email: string | null }>("select status, name, email from enquiries where id = $1", [closedId]);
      expect(closedBefore.rows[0]?.status).toBe("closed");
      const viewed = await pool.query<{ status: string }>("select status from enquiries where id = $1", [closedId]);
      expect(viewed.rows[0]?.status).toBe("closed");
      const opened = await setEnquiryFollowUp(pool, { id: closedId, fromStatus: "closed", toStatus: "new", scope: ["meridian-skin"] });
      expect(opened?.reference).toBe("TEST-MS-CLOSED-003");
      const after = await pool.query<{ status: string; name: string; email: string | null }>("select status, name, email from enquiries where id = $1", [closedId]);
      expect(after.rows[0]).toEqual({ status: "new", name: closedBefore.rows[0]?.name, email: closedBefore.rows[0]?.email });
      expect(await setEnquiryFollowUp(pool, { id: closedId, fromStatus: "closed", toStatus: "acknowledged", scope: ["meridian-skin"] })).toBeNull();
      expect(await setEnquiryFollowUp(pool, { id: closedId, fromStatus: "new", toStatus: "closed", scope: ["clinic-genie"] })).toBeNull();
      expect((await pool.query<{ status: string }>("select status from enquiries where id = $1", [closedId])).rows[0]?.status).toBe("new");
      expect(await websiteFormConfigPresent(pool)).toBe(false);
      expect(await setEnquiryFollowUp(pool, { id: closedId, fromStatus: "new", toStatus: "closed", scope: null })).toMatchObject({ id: closedId });
    } finally {
      await pool.end();
    }

    const checked = await checkEnquiryFixture(fixtureUrl);
    expect(checked.enquiries).toBe(6);
  });

  it("refuses a reset when a stored reference is outside the fixture", async () => {
    await resetEnquiryFixture(fixtureUrl);
    const pool = new pg.Pool({ connectionString: fixtureUrl, max: 1 });
    try {
      await pool.query("update enquiries set public_reference = 'DEMO-OUTSIDE' where public_reference = 'TEST-MS-NEW-006'");
      await expect(resetEnquiryFixture(fixtureUrl)).rejects.toThrow(/outside the fixture/);
      expect((await pool.query<{ count: number }>("select count(*)::int as count from enquiries where public_reference = 'DEMO-OUTSIDE'")).rows[0]?.count).toBe(1);
      await pool.query("update enquiries set public_reference = 'TEST-MS-NEW-006' where public_reference = 'DEMO-OUTSIDE'");
    } finally {
      await pool.end();
    }
  });

  it("persists follow-up transitions and lets one concurrent update win", async () => {
    await resetEnquiryFixture(fixtureUrl);
    const left = new pg.Pool({ connectionString: fixtureUrl, max: 1 });
    const right = new pg.Pool({ connectionString: fixtureUrl, max: 1 });
    const enquiryId = "11111111-1111-4111-8111-111111111101";
    const failedEnquiryId = "11111111-1111-4111-8111-111111111102";
    const pendingId = "22222222-2222-4222-8222-222222222204";
    try {
      const before = await left.query<{ status: string; message: string }>("select status, message from enquiries where id = $1", [enquiryId]);
      expect(before.rows[0]?.status).toBe("new");
      expect(await setEnquiryFollowUp(left, { id: enquiryId, fromStatus: "new", toStatus: "acknowledged", scope: null })).toMatchObject({ id: enquiryId });
      expect(await setEnquiryFollowUp(left, { id: enquiryId, fromStatus: "acknowledged", toStatus: "closed", scope: null })).toMatchObject({ id: enquiryId });
      expect(await setEnquiryFollowUp(left, { id: enquiryId, fromStatus: "closed", toStatus: "new", scope: null })).toMatchObject({ id: enquiryId });
      const reopened = await left.query<{ status: string; message: string }>("select status, message from enquiries where id = $1", [enquiryId]);
      expect(reopened.rows[0]).toEqual({ status: "new", message: before.rows[0]?.message });

      const [first, second] = await Promise.all([
        setEnquiryFollowUp(left, { id: enquiryId, fromStatus: "new", toStatus: "acknowledged", scope: null }),
        setEnquiryFollowUp(right, { id: enquiryId, fromStatus: "new", toStatus: "closed", scope: null }),
      ]);
      expect([first, second].filter((row) => row !== null)).toHaveLength(1);
      const raced = await left.query<{ status: string; message: string }>("select status, message from enquiries where id = $1", [enquiryId]);
      expect(["acknowledged", "closed"]).toContain(raced.rows[0]?.status);
      expect(raced.rows[0]?.message).toBe(before.rows[0]?.message);
      expect(await setEnquiryFollowUp(left, { id: enquiryId, fromStatus: "new", toStatus: "acknowledged", scope: null })).toBeNull();

      const stored = await left.query<{ id: string; status: string; message: string }>("select id, status, message from enquiries where id = $1", [failedEnquiryId]);
      const sentBefore = await left.query("select status, attempts, provider_message_id, sent_at from notification_outbox where id = $1", [RETRY_FAILURE_OUTBOX_ID]);
      expect(sentBefore.rows[0]?.status).toBe("sent");
      const [retryA, retryB] = await Promise.all([
        requeueNotification(fixtureUrl, RETRY_SUCCESS_OUTBOX_ID, null),
        requeueNotification(fixtureUrl, RETRY_SUCCESS_OUTBOX_ID, null),
      ]);
      expect([retryA, retryB].filter((row) => row !== null)).toHaveLength(1);
      expect(await requeueNotification(fixtureUrl, RETRY_FAILURE_OUTBOX_ID, null)).toBeNull();
      const sentAfter = await left.query("select status, attempts, provider_message_id, sent_at from notification_outbox where id = $1", [RETRY_FAILURE_OUTBOX_ID]);
      expect(sentAfter.rows).toEqual(sentBefore.rows);
      const stillThere = await left.query<{ id: string; status: string; message: string }>("select id, status, message from enquiries where id = $1", [failedEnquiryId]);
      expect(stillThere.rows).toEqual(stored.rows);
      expect((await left.query<{ count: number }>("select count(*)::int as count from enquiries")).rows[0]?.count).toBe(6);
      expect((await left.query<{ status: string }>("select status from notification_outbox where id = $1", [RETRY_SUCCESS_OUTBOX_ID])).rows[0]?.status).toBe("pending");

      await left.query("update notification_outbox set leased_until = now() + interval '5 minutes' where id = $1 and status = 'pending'", [pendingId]);
      const leased = await left.query<{ leased: boolean }>("select leased_until > now() as leased from notification_outbox where id = $1", [pendingId]);
      expect(leased.rows[0]?.leased).toBe(true);
    } finally {
      await left.end();
      await right.end();
    }
  });
});
