import { describe, expect, it } from "vitest";
import { checkCompatibility, parseGa4AccountSummaries } from "../src/analytics/providers/ga4";
import { parseGscSites } from "../src/analytics/providers/gsc";
import { parseSemanticModel, WIX_DATA_HISTORY_DAYS, wixDataWindow, wixDueWindow } from "../src/analytics/providers/wix";
import { daysBetween } from "../src/services/dates";
import { safeSearchQuery } from "../src/analytics/measure";

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
