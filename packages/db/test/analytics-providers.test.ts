import { describe, expect, it } from "vitest";
import { GA4_TEMPLATES, checkCompatibility, ga4ReportBody, parseGa4AccountSummaries } from "../src/analytics/providers/ga4";
import { parseGscSites } from "../src/analytics/providers/gsc";
import { parseSemanticModel, WIX_DATA_HISTORY_DAYS, wixDataWindow, wixDueWindow } from "../src/analytics/providers/wix";
import { daysBetween } from "../src/services/dates";
import { safeSearchQuery } from "../src/analytics/measure";

describe("GA4 empty rows (D52)", () => {
  it("asks GA4 for zero-visit days on date reports so a recorded zero is stored as zero", () => {
    const body = ga4ReportBody({ start: "2026-11-01", end: "2026-11-07", ...GA4_TEMPLATES["ga4.traffic_daily"]! }) as { keepEmptyRows: boolean };
    expect(body.keepEmptyRows).toBe(true);
  });

  it("leaves empty rows out of breakdowns, where a zero row adds nothing", () => {
    for (const key of ["ga4.traffic_range", "ga4.acquisition", "ga4.landing", "ga4.device", "ga4.country"]) {
      const body = ga4ReportBody({ start: "2026-11-01", end: "2026-11-07", ...GA4_TEMPLATES[key]! }) as { keepEmptyRows: boolean };
      expect(body.keepEmptyRows, key).toBe(false);
    }
  });
});

describe("analytics provider fixtures", () => {
  it("treats fixture discovery as labelled and refuses an unknown dimension", () => {
    expect(checkCompatibility({ metrics: ["sessions"], dimensions: ["date"] }, null)).toBe("unknown");
    expect(checkCompatibility(
      { metrics: ["sessions"], dimensions: ["date", "userAgeBracket"] },
      { metrics: ["sessions"], dimensions: ["date"], status: "supported" },
    )).toBe("unsupported");
    expect(parseGa4AccountSummaries({
      accountSummaries: [{ displayName: "Fixture clinic", propertySummaries: [{ property: "properties/123456", displayName: "Fixture property" }] }],
    })).toEqual([{ id: "123456", label: "Fixture clinic · Fixture property" }]);
    expect(parseGscSites({ siteEntry: [{ siteUrl: "sc-domain:fixture.example", permissionLevel: "siteOwner" }] })).toEqual([
      { id: "sc-domain:fixture.example", label: "sc-domain:fixture.example" },
    ]);
    expect(wixDataWindow("2026-10-27", "2026-01-01", "2026-01-02")).toEqual({ error: "outside_history" });
    const due = wixDueWindow("2026-10-29");
    expect(due.end).toBe("2026-10-29");
    expect(daysBetween(due.start, due.end) + 1).toBe(WIX_DATA_HISTORY_DAYS);
    expect(parseSemanticModel({ semanticModel: { id: "fixture", slug: "fixture", measures: [{ name: "sessions" }] } })?.fields[0]?.name).toBe("sessions");
    expect(safeSearchQuery("person@example.invalid")).toBeNull();
  });
});
