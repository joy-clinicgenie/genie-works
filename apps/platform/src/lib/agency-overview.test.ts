import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { enquiryStatusCountQuery } from "@clinic-genie/db";
import {
  analyticsDashboardHref,
  dashboardRangeId,
  enquiryDashboardHref,
  notificationFailureHref,
  reportsLibraryHref,
  sessionComparison,
} from "./agency-overview";
import { submissionStatusCounts, combineEnquiryCounts } from "./form-submissions";

describe("dashboard enquiry and navigation helpers", () => {
  it("keeps dashboard enquiry counts free of personal details and treats a missing database as disconnected", async () => {
    const query = enquiryStatusCountQuery(["meridian-skin"], { from: "2026-10-01", to: "2026-10-07", clinicId: "meridian-skin" });
    expect(query.sql).toContain("is_synthetic = false");
    expect(query.sql).not.toMatch(/\b(name|email|contact_number|message|phone)\b/i);
    expect(query.params).toEqual([["meridian-skin"], true, "2026-10-01", "2026-10-07", "meridian-skin"]);
    const previous = process.env.ENQUIRY_DATABASE_URL;
    delete process.env.ENQUIRY_DATABASE_URL;
    try {
      expect(await submissionStatusCounts(["meridian-skin"], { from: "2026-10-01", to: "2026-10-07" })).toEqual({ connected: false });
    } finally {
      if (previous === undefined) delete process.env.ENQUIRY_DATABASE_URL;
      else process.env.ENQUIRY_DATABASE_URL = previous;
    }
  });

  it("adds production Wix counts and leaves a failed empty Wix read off the total", () => {
    const database = { connected: true as const, counts: { new: 1, acknowledged: 0, closed: 2 } };
    const wix = { configured: true, failed: false, counts: { new: 4, acknowledged: 1, closed: 0 } };
    expect(combineEnquiryCounts(database, wix)).toEqual({ connected: true, counts: { new: 5, acknowledged: 1, closed: 2 } });
    expect(combineEnquiryCounts(
      { connected: false },
      { configured: true, failed: true, counts: { new: 0, acknowledged: 0, closed: 0 } },
    )).toEqual({ connected: false });
    expect(combineEnquiryCounts(
      { connected: false },
      { configured: true, failed: false, counts: { new: 3, acknowledged: 0, closed: 0 } },
    )).toEqual({ connected: true, counts: { new: 3, acknowledged: 0, closed: 0 } });
  });

  it("opens enquiries, analytics and the exact report from the dashboard filters", () => {
    expect(dashboardRangeId(undefined)).toBe("last30");
    expect(dashboardRangeId("today")).toBe("last30");
    expect(dashboardRangeId("last7")).toBe("last7");
    expect(enquiryDashboardHref({ status: "new", from: "2026-10-01", to: "2026-10-30", clinic: "meridian-skin" })).toBe(
      "/enquiries?from=2026-10-01&to=2026-10-30&status=new&clinic=meridian-skin",
    );
    expect(notificationFailureHref("meridian-skin", "2026-10-30")).toContain("notification=failed");
    expect(notificationFailureHref("meridian-skin", "2026-10-30")).toContain("clinic=meridian-skin");
    expect(analyticsDashboardHref("last30", "client-1", "site-1")).toBe("/analytics?client=client-1&range=last30&website=site-1");
    expect(reportsLibraryHref("client-1")).toBe("/reports?client=client-1");
    expect(sessionComparison(8, 4)).toBe("100% higher than the previous period");
    expect(sessionComparison(0, 0)).toBe("No change from the previous period");
    expect(sessionComparison(null, 4)).toBeNull();
  });

  it("does not load enquiry rows or legacy session exports on the home page", () => {
    const page = readFileSync(fileURLToPath(new URL("../app/(app)/page.tsx", import.meta.url)), "utf8");
    expect(page).not.toContain("listFormSubmissions");
    expect(page).not.toContain("listEnquiryBoard");
    expect(page).toContain("dashboardEnquiryCounts");
    expect(page).not.toContain("report_snapshots");
    expect(page).not.toContain("127.0.0.1:7835");
    expect(page).not.toContain("LaunchDashboard");
  });

  it("does not call the temporary debug ingest host", () => {
    const sources = [
      new URL("../app/(app)/layout.tsx", import.meta.url),
      new URL("./session.ts", import.meta.url),
      new URL("../components/shell/Shell.tsx", import.meta.url),
      new URL("../components/shell/BackButton.tsx", import.meta.url),
      new URL("../../../../packages/db/src/client.ts", import.meta.url),
    ];
    for (const source of sources) {
      const text = readFileSync(fileURLToPath(source), "utf8");
      expect(text, source.pathname).not.toContain("127.0.0.1:7835");
      expect(text, source.pathname).not.toContain("X-Debug-Session-Id");
    }
  });
});
