import { describe, expect, it } from "vitest";
import { gscDueWindow } from "@clinic-genie/db";
import { pickSearchConsole, searchConsoleCapability, searchConsoleWindow, setupChecks } from "@/lib/seo-workspace";

const property = "https://www.example.invalid/";

describe("Search Console connection status", () => {
  it("uses the active connected property and ignores a disconnected row", () => {
    const picked = pickSearchConsole([
      { website_id: "w", provider: "gsc", status: "disconnected", external_property_id: property, disconnected_at: new Date() },
      { website_id: "w", provider: "wix", status: "connected", external_property_id: "site", disconnected_at: null },
      { website_id: "w", provider: "gsc", status: "connected", external_property_id: property, disconnected_at: null },
    ], "w");
    expect(picked).toEqual({ status: "connected", propertyId: property });
    expect(searchConsoleCapability(picked, null)).toBe(`Connected to ${property}. Can read search reports and check whether a known page is indexed.`);
  });

  it("keeps an unconnected site unavailable", () => {
    expect(searchConsoleCapability(null, null)).toBe("Not connected. Cannot read search reports or check index status.");
    const check = setupChecks({
      codeManaged: false,
      connected: false,
      pageSettingCount: 0,
      redirectCount: 0,
      verification: null,
      searchConsole: null,
      profiles: [],
    }).find((item) => item.title === "Google Search Console");
    expect(check?.status).toBe("attention");
  });

  it("reads the previous 30 published Search Console days", () => {
    const now = new Date("2026-10-30T16:30:00.000Z");
    const controls = { range: "30" as const, metric: "clicks" as const, record: "pages" as const, direction: "decreased" as const, changeMetric: "clicks" as const };
    expect(searchConsoleWindow(controls, now)).toEqual({ start: "2026-09-28", end: "2026-10-27" });
    expect(searchConsoleWindow(controls, now)).toEqual(gscDueWindow(now));
  });

  it("marks a connected property ready on the setup checklist", () => {
    const check = setupChecks({
      codeManaged: false,
      connected: false,
      pageSettingCount: 0,
      redirectCount: 0,
      verification: null,
      searchConsole: { status: "connected", propertyId: property },
      profiles: [],
    }).find((item) => item.title === "Google Search Console");
    expect(check?.status).toBe("ready");
    expect(check?.detail).toContain(property);
  });
});
