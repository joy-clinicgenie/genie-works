import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { assertEnquiryFixtureUrl, canExport, loadRootEnv, type AccessProfile } from "@clinic-genie/db";
import { SUITE_ENQUIRY_DATABASES, suiteEnquiryFixtureUrl } from "../../../../packages/db/src/testing/targets";
import { disposeSuiteEnquiryDatabase, resetEnquiryFixture } from "../../../../packages/db/src/testing/enquiry-fixture";
import { formPageHref } from "./form-catalogue";
import {
  attemptOrigin,
  enquiryChange,
  enquiryConnection,
  enquiryCsv,
  enquiryConnectorLabel,
  enquiryHandling,
  enquiryIdentity,
  enquiryNotificationLabel,
  handlingFilter,
  pageHandledEnquiries,
  enquiryPage,
  enquiryWindow,
  getFormSubmission,
  listEnquiryBoard,
  notificationBoundary,
  notificationFailure,
  notificationLabel,
  sourceLabel,
  submissionStatusCounts,
  type SubmissionListItem,
} from "./form-submissions";

loadRootEnv();

describe("enquiry comparison and export", () => {
  it("shows a numerical change and no percentage when the previous period is zero", () => {
    expect(enquiryChange(4, 0)).toBe("4 more than the previous period");
    expect(enquiryChange(4, 0)).not.toContain("%");
    expect(enquiryChange(0, 0)).toBe("No change from the previous period");
    expect(enquiryChange(0, 0)).not.toContain("%");
  });

  it("includes a percentage when the previous period has enquiries", () => {
    expect(enquiryChange(5, 2)).toContain("%");
    expect(enquiryChange(5, 2)).toContain("3 more");
    expect(enquiryChange(1, 4)).toContain("3 fewer");
    expect(enquiryChange(1, 4)).toContain("%");
  });

  it("defaults the enquiry window to the last 30 days and the 30 days before it", () => {
    expect(enquiryWindow(undefined, undefined, "2026-11-03")).toEqual({
      from: "2026-10-05",
      to: "2026-11-03",
      previousFrom: "2026-09-05",
      previousTo: "2026-10-04",
    });
    expect(enquiryWindow(undefined, undefined, "2026-10-30")).toEqual({
      from: "2026-10-01",
      to: "2026-10-30",
      previousFrom: "2026-09-01",
      previousTo: "2026-09-30",
    });
    expect(enquiryWindow("2026-13-40", "2026-10-02", "2026-10-30").from).toBe("2026-10-01");
  });

  it("labels provider acceptance as Sent and leaves unknown sources uncaptured", () => {
    expect(notificationLabel("sent")).toBe("Sent");
    expect(notificationLabel("sent")).not.toContain("Delivered");
    const now = new Date("2026-10-30T12:00:00.000Z");
    const accepted = notificationBoundary({ status: "sent", now });
    expect(accepted).toMatchObject({ boundary: "accepted", label: "Sent" });
    expect(accepted.detail).toContain("provider accepted");
    expect(accepted.detail).not.toContain("Delivered");
    expect(notificationBoundary({ status: "pending", manualRetry: true, now })).toMatchObject({ boundary: "retry_requested", label: "Retry requested" });
    expect(notificationBoundary({ status: "pending", leasedUntil: "2026-10-30T12:05:00.000Z", manualRetry: true, now })).toMatchObject({ boundary: "processing", label: "Processing" });
    expect(notificationBoundary({ status: "pending", leasedUntil: "2026-10-30T11:00:00.000Z", now })).toMatchObject({ boundary: "waiting", label: "Pending" });
    expect(notificationBoundary({ status: "failed", now }).detail).not.toContain("Delivered");
    expect(notificationBoundary({ status: null, now }).boundary).toBe("none");
    expect(notificationFailure("sink_rejected")).toBe("The mail sink rejected the message.");
    expect(notificationFailure("mailbox_unconfigured")).toBe("No clinic mailbox is configured.");
    expect(notificationFailure("smtp_timeout")).toBe("No explanation is recorded for this code.");
    expect(notificationFailure(null)).toBeNull();
    expect(attemptOrigin("fixture-seed")).toBe("Automatic");
    expect(attemptOrigin("staff:admin")).toBe("Manual");
    expect(attemptOrigin("manual-retry")).toBe("Manual");
    expect(attemptOrigin(null)).toBeNull();
    expect(sourceLabel("direct")).toBe("Direct");
    expect(sourceLabel(null)).toBe("Unknown / not captured");
    expect(sourceLabel("newsletter")).toBe("Unknown / not captured");
  });

  it("exports production rows and leaves contact details out until requested", () => {
    expect(enquiryPage("all").limit).toBeNull();
    expect(enquiryPage(2).offset).toBe(25);
    const rows = [sample("TEST-1", false), sample("TEST-2", false), sample("TEST-DEMO", true)];
    const csv = enquiryCsv(rows);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain("TEST-1");
    expect(csv).toContain("TEST-2");
    expect(csv).not.toContain("TEST-DEMO");
    expect(csv.startsWith("Received,Reference,Client,Website,Form,Follow-up status,Handling")).toBe(true);
    expect(csv).not.toContain("Name");
    expect(csv).not.toContain("Telephone");
    expect(csv).not.toContain("Email");
    expect(csv).not.toContain("Message");
    expect(csv).not.toContain("person@example.invalid");
    expect(csv).not.toContain("00000000");
    const detailed = enquiryCsv(rows, new Map(), { contact: true });
    expect(detailed).toContain("Name,Telephone,Email");
    expect(detailed).toContain("Test Person");
    expect(detailed).toContain("person@example.invalid");
    expect(detailed).toContain("00000000");
    expect(detailed).not.toContain("TEST-DEMO");
    expect(detailed).not.toContain("Message");
    expect(detailed).not.toContain("clinical note");
  });

  it("prefixes spreadsheet formulas and quotes carriage returns", () => {
    const row = sample("=1+1", false);
    row.clinicName = "+cmd,quoted";
    row.websiteKey = "-1";
    row.formKey = "appointment-enquiry";
    row.submitterName = "\t=HYPERLINK(\"http://example.invalid\")";
    row.email = "@sum";
    row.contactNumber = "\r000";
    const csv = enquiryCsv([row], new Map(), { contact: true });
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("\"'+cmd,quoted\"");
    expect(csv).toContain("'-1");
    expect(csv).toContain("\"'\t=HYPERLINK(\"\"http://example.invalid\"\")\"");
    expect(csv).toContain("'@sum");
    expect(csv).toContain("\"'\r000\"");
    expect(csv).not.toContain("Message");
    expect(csv).not.toMatch(/(^|,)=/);
    expect(csv).not.toMatch(/(^|,)\+/);
    expect(csv).not.toMatch(/(^|,)-/);
    expect(csv).not.toMatch(/(^|,)@/);
  });

  it("labels a Wix clinic email as unavailable and the list handling separately", () => {
    expect(enquiryNotificationLabel({ notificationStatus: null, notificationDelivery: "unavailable" })).toBe("Unavailable");
    expect(enquiryNotificationLabel({ notificationStatus: "sent" })).toBe("Sent");
    expect(enquiryHandling("new", false)).toBe("unopened");
    expect(enquiryHandling("new", true)).toBe("read");
    expect(enquiryHandling("acknowledged", false)).toBe("read");
    expect(enquiryHandling("closed", false)).toBe("resolved");
    expect(enquiryHandling("closed", true)).toBe("resolved");
    expect(handlingFilter("read")).toBe("read");
    expect(handlingFilter("sent")).toBeUndefined();
    const rows = [sample("TEST-1", false), { ...sample("TEST-2", false), id: "22222222-2222-4222-8222-222222222202", status: "closed" as const }];
    const opened = new Set([enquiryIdentity(rows[0]!)]);
    const page = pageHandledEnquiries(rows, "unopened", opened, 1);
    expect(page.total).toBe(0);
    expect(pageHandledEnquiries(rows, "read", opened, 1).items.map((row) => row.reference)).toEqual(["TEST-1"]);
    expect(pageHandledEnquiries(rows, "resolved", opened, 1).items.map((row) => row.reference)).toEqual(["TEST-2"]);
    expect(enquiryCsv(rows, new Map(), { opened })).toContain("Read");
    expect(enquiryCsv(rows, new Map(), { opened })).toContain("Resolved");
    expect(enquiryCsv(rows, new Map(), { opened })).not.toContain("Unavailable");
  });

  it("keeps a website database and a Wix form as separate enquiries", () => {
    expect(enquiryConnectorLabel("database")).toBe("Website database");
    expect(enquiryConnectorLabel("wix")).toBe("Wix Forms");
    expect(enquiryConnectorLabel(undefined)).toBe("Website database");
    expect(enquiryIdentity({ id: "same", source: "database" })).not.toBe(enquiryIdentity({ id: "same", source: "wix" }));
  });

  it("limits export to admins and managers", () => {
    expect(canExport(profile("admin"))).toBe(true);
    expect(canExport(profile("manager"))).toBe(true);
    expect(canExport(profile("specialist"))).toBe(false);
    expect(canExport(profile("reviewer"))).toBe(false);
    expect(canExport(profile("read_only"))).toBe(false);
  });

  it("counts production enquiries once per board read", () => {
    const source = readFileSync(fileURLToPath(new URL("./form-submissions.ts", import.meta.url)), "utf8");
    const board = source.slice(source.indexOf("export async function listEnquiryBoard"), source.indexOf("export async function listFormSubmissions"));
    // The list and the count are the only two reads that build a filter for the current window.
    expect(board.match(/enquiryWhere\(scope, filters, currentDates/g) ?? []).toHaveLength(2);
    // The production total is the same count, so it is reused rather than queried again.
    expect(board).not.toContain("productionWhere");
    expect(board.match(/select count\(\*\)::int as count/g) ?? []).toHaveLength(1);
    expect(board).toContain("const listProduction = true;");
  });

  it("builds a website form address from the site URL and path", () => {
    expect(formPageHref("https://meridian-skin.example.invalid", "/request-appointment")).toBe("https://meridian-skin.example.invalid/request-appointment");
    expect(formPageHref(null, "/contact")).toBeNull();
  });
});

describe("isolated enquiry fixture", () => {
  const previousUrl = process.env.ENQUIRY_DATABASE_URL;

  afterAll(async () => {
    delete process.env.ENQUIRY_DATABASE_URL;
    await enquiryConnection();
    const admin = process.env.DATABASE_ADMIN_URL;
    if (admin) {
      try {
        await disposeSuiteEnquiryDatabase(admin, "platform");
      } catch {
        // A non-local admin URL never created the suite database.
      }
    }
    if (previousUrl === undefined) delete process.env.ENQUIRY_DATABASE_URL;
    else process.env.ENQUIRY_DATABASE_URL = previousUrl;
  });

  it("refuses the platform database and the sibling clinic port before opening a connection", async () => {
    const created = vi.spyOn(pg, "Pool");
    const previous = process.env.ENQUIRY_DATABASE_URL;
    try {
      process.env.ENQUIRY_DATABASE_URL = "postgresql://local@127.0.0.1:54339/clinic_genie";
      expect(await enquiryConnection()).toEqual({ configured: true, reachable: false, refused: true, live: false });
      expect((await listEnquiryBoard(null, {})).connected).toBe(false);
      process.env.ENQUIRY_DATABASE_URL = "postgresql://local@127.0.0.1:54329/clinic_genie_enquiry_test";
      expect(await enquiryConnection()).toEqual({ configured: true, reachable: false, refused: true, live: false });
      expect(created).not.toHaveBeenCalled();
    } finally {
      created.mockRestore();
      if (previous === undefined) delete process.env.ENQUIRY_DATABASE_URL;
      else process.env.ENQUIRY_DATABASE_URL = previous;
    }
  });

  it("keeps demonstration rows out of production totals and exports", async () => {
    const admin = process.env.DATABASE_ADMIN_URL;
    if (!admin) throw new Error("DATABASE_ADMIN_URL is required for the enquiry fixture.");
    const fixture = suiteEnquiryFixtureUrl(admin, "platform");
    const target = assertEnquiryFixtureUrl(fixture);
    expect(target.database).toBe(SUITE_ENQUIRY_DATABASES.platform);
    expect(target.database).not.toBe("clinic_genie_enquiry_test");
    expect(target.host).toBe("127.0.0.1");
    process.env.ENQUIRY_DATABASE_URL = fixture;
    await resetEnquiryFixture(fixture);
    const october = enquiryWindow("2026-10-01", "2026-10-30", "2026-10-30");
    const board = await listEnquiryBoard(null, {}, october);
    expect(board.connected).toBe(true);
    expect(board.total).toBe(0);
    expect(board.items).toEqual([]);
    expect(board.currentTotal).toBe(0);
    expect(board.previousTotal).toBe(0);
    expect(board.breakdowns.client).toEqual([]);
    expect(board.breakdowns.website).toEqual([]);
    expect(board.breakdowns.form).toEqual([]);
    expect(board.breakdowns.source).toEqual([]);
    expect(board.clinics).toEqual([]);
    expect(board.websites).toEqual([]);

    expect((await listEnquiryBoard(null, { clinicId: "meridian-skin" }, october)).total).toBe(0);
    expect((await listEnquiryBoard(null, { websiteKey: "meridian-skin-staging" }, october)).items).toEqual([]);
    expect((await listEnquiryBoard(null, { formKey: "contact" }, october)).total).toBe(0);
    expect((await listEnquiryBoard(null, { status: "new" }, october)).total).toBe(0);
    expect((await listEnquiryBoard(["clinic-genie"], {}, october)).total).toBe(0);
    expect((await listEnquiryBoard(["meridian-skin"], { clinicId: "clinic-genie" }, october)).total).toBe(0);

    const empty = await listEnquiryBoard(null, {}, enquiryWindow("2020-01-01", "2020-01-31", "2026-10-30"));
    expect(empty.connected).toBe(true);
    expect(empty.total).toBe(0);
    expect(empty.currentTotal).toBe(0);
    expect(empty.previousTotal).toBe(0);

    const counts = await submissionStatusCounts(null, { from: "2026-10-01", to: "2026-10-30" });
    expect(counts).toEqual({ connected: true, counts: { new: 0, acknowledged: 0, closed: 0 } });

    expect(await getFormSubmission(null, "11111111-1111-4111-8111-111111111102")).toBeNull();

    const exported = await listEnquiryBoard(null, { page: "all", productionOnly: true, contact: true }, october);
    expect(exported.total).toBe(0);
    const csv = enquiryCsv(exported.items, new Map(), { contact: true });
    expect(csv).toBe("Received,Reference,Client,Website,Form,Name,Telephone,Email,Follow-up status,Handling");
    expect(csv).not.toContain("Synthetic test enquiry");
    expect(csv).not.toContain("example.invalid");
  });
});

function profile(role: AccessProfile["user"]["platform_role"]): AccessProfile {
  return { user: { platform_role: role } } as AccessProfile;
}

function sample(reference: string, isSynthetic = false): SubmissionListItem {
  return {
    id: "11111111-1111-4111-8111-111111111101",
    reference,
    clinicId: "meridian-skin",
    clinicName: "Meridian Skin",
    websiteKey: "meridian-skin-production",
    formKey: "appointment-enquiry",
    submittedAt: new Date("2026-10-20T02:00:00.000Z"),
    submitterName: "Test Person",
    status: "new",
    notificationStatus: "sent",
    attributionSource: "direct",
    pagePath: "/request-appointment",
    isSynthetic,
    contactNumber: "00000000",
    email: "person@example.invalid",
  };
}
