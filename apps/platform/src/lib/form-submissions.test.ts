import { describe, expect, it } from "vitest";
import { canExport, type AccessProfile } from "@clinic-genie/db";
import { formPageHref } from "./form-catalogue";
import { attemptOrigin, enquiryChange, enquiryCsv, enquiryPage, enquiryWindow, notificationFailure, notificationLabel, sourceLabel, type SubmissionListItem } from "./form-submissions";

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

  it("defaults the enquiry window to this month and the period before it", () => {
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
    expect(csv.startsWith("Received,Reference,Client,Website,Form,Follow-up status,Notification")).toBe(true);
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

  it("limits export to admins and managers", () => {
    expect(canExport(profile("admin"))).toBe(true);
    expect(canExport(profile("manager"))).toBe(true);
    expect(canExport(profile("specialist"))).toBe(false);
    expect(canExport(profile("reviewer"))).toBe(false);
    expect(canExport(profile("read_only"))).toBe(false);
  });

  it("builds a website form address from the site URL and path", () => {
    expect(formPageHref("https://harbourview-dental.example.invalid", "/request-appointment")).toBe("https://harbourview-dental.example.invalid/request-appointment");
    expect(formPageHref(null, "/contact")).toBeNull();
  });
});

function profile(role: AccessProfile["user"]["platform_role"]): AccessProfile {
  return { user: { platform_role: role } } as AccessProfile;
}

function sample(reference: string, isSynthetic = false): SubmissionListItem {
  return {
    id: "11111111-1111-4111-8111-111111111101",
    reference,
    clinicId: "harbourview-dental",
    clinicName: "Harbourview Dental",
    websiteKey: "harbourview-dental-wix",
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
