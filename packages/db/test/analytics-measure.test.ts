import { describe, expect, it } from "vitest";
import {
  classifyImport,
  contactSplit,
  coverageForRange,
  csvCell,
  exactRangeUsers,
  gscDetailIncomplete,
  parseMetricCsv,
  percentChange,
  positionChange,
  previousWindow,
  refuseCombinedTraffic,
  safeAnalyticsPath,
  submissionEventRatio,
  usersFromReport,
  weekdayAverages,
} from "../src/analytics/measure";

describe("analytics measurement rules", () => {
  it("does not recover distinct users by adding days", () => {
    expect(exactRangeUsers().state).toBe("unavailable");
    expect(usersFromReport({
      templateKey: "ga4.traffic_daily",
      rows: [{ dimensionKey: "2026-10-01", metrics: [{ key: "totalUsers", value: 10, state: "available" }] }],
    }).state).toBe("unavailable");
    expect(usersFromReport({
      templateKey: "ga4.traffic_range",
      rows: [{ dimensionKey: "range", metrics: [{ key: "totalUsers", value: 40, state: "available" }] }],
    })).toEqual({ state: "available", value: 40 });
  });

  it("refuses to add Wix and GA4 traffic", () => {
    expect(() => refuseCombinedTraffic("wix", "ga4")).toThrow(/not added/);
    expect(() => refuseCombinedTraffic("ga4", "ga4")).not.toThrow();
  });

  it("keeps contact clicks separate from other clicks", () => {
    const split = contactSplit([
      { type: "whatsapp_click", count: 19 },
      { type: "phone_click", count: 11 },
      { type: "email_click", count: 6 },
      { type: "booking_link_click", count: 5 },
      { type: "cta_click", count: 101 },
      { type: "directions", count: 14 },
    ]);
    expect(split).toEqual({ contact: 41, other: 115 });
  });

  it("does not call an event ratio a conversion rate", () => {
    expect(submissionEventRatio(13, 31).label).toBe("Submission events / start events");
    expect(submissionEventRatio(13, 31).ratio).toBeCloseTo(13 / 31);
  });

  it("handles a missing previous period, a zero baseline and an unchanged position", () => {
    expect(percentChange(4, null).kind).toBe("unavailable");
    expect(percentChange(4, 0)).toEqual({ kind: "new_activity" });
    expect(percentChange(0, 0)).toEqual({ kind: "no_change" });
    expect(positionChange(8.2, 8.2)).toEqual({ kind: "no_change" });
    expect(positionChange(9, 8.2).kind).toBe("percent");
  });

  it("keeps the leap day in the previous window and flags partial tracking", () => {
    expect(previousWindow("2024-03-01", "2024-03-01")).toEqual({ start: "2024-02-29", end: "2024-02-29" });
    expect(coverageForRange("2026-10-10", "2026-10-01", "2026-10-20")).toBe("partial");
    expect(coverageForRange(null, "2026-10-01", "2026-10-20")).toBe("not_tracked");
  });

  it("averages only complete weekday dates, including zeros", () => {
    const averages = weekdayAverages([
      { date: "2026-10-05", sessions: 10, coverage: "complete" },
      { date: "2026-10-12", sessions: 0, coverage: "complete" },
      { date: "2026-10-19", sessions: null, coverage: "missing" },
      { date: "2026-10-26", sessions: 30, coverage: "partial" },
    ]);
    expect(averages.find((row) => row.weekday === "Mon")).toEqual({ weekday: "Mon", average: 5, covered: 2, eligible: 3 });
  });

  it("warns when Search Console detail rows are below the property total", () => {
    expect(gscDetailIncomplete(10, 25)).toBe(true);
    expect(gscDetailIncomplete(25, 25)).toBe(false);
  });

  it("strips contact-bearing urls and guards csv formulas", () => {
    expect(safeAnalyticsPath("https://clinic.example/contact?email=person@example.invalid")).toBe("/contact");
    expect(safeAnalyticsPath("mailto:person@example.invalid")).toBeNull();
    expect(safeAnalyticsPath("/patients/person@example.invalid")).toBeNull();
    expect(csvCell("=cmd()")).toBe("'=cmd()");
    expect(parseMetricCsv("date,email,value\n2026-10-01,sessions,1")).toEqual({ error: "The file contains a column that is not allowed in analytics." });
    expect(classifyImport({
      checksum: "a".repeat(64),
      start: "2026-10-01",
      end: "2026-10-02",
      existing: [{ checksum: "b".repeat(64), start: "2026-10-02", end: "2026-10-03", provenance: "api" }],
      replace: false,
    })).toBe("reject");
  });
});
