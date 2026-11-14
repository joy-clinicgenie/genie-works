import { describe, expect, it, vi } from "vitest";

// The status label helper lives in a .tsx component, which this Vitest setup does not compile.
vi.mock("@/components/ui/Badge", () => ({ label: (value: string) => value }));
import type { LiveBehaviourFacts, LiveTrafficFacts, PreviousDetailFacts } from "@/lib/analytics-board";
import { buildBreakdown } from "@/lib/breakdown-report";
import type { SiteView } from "@/lib/site-view";

const view = {
  clientId: "client-a",
  snapshots: [],
  current: { start: "2026-10-01", end: "2026-10-03" },
  previous: { start: "2026-09-28", end: "2026-09-30" },
} as unknown as SiteView;

const facts: LiveTrafficFacts = {
  connected: true,
  provider: "ga4",
  sourceNote: "Traffic is from Google Analytics.",
  updatedAt: null,
  sessions: 300,
  sessionsPrevious: 200,
  users: 150,
  usersPrevious: 100,
  channels: [
    { channel: "Organic Search", current: 200, previous: 100 },
    { channel: "Direct", current: 100, previous: null },
  ],
  landing: [],
  devices: [{ name: "Mobile", sessions: 250 }],
  countries: [],
  dailyCurrent: [
    { date: "2026-10-01", value: 100 },
    { date: "2026-10-02", value: 100 },
    { date: "2026-10-03", value: 100 },
  ],
  dailyPrevious: [
    { date: "2026-09-28", value: 50 },
    { date: "2026-09-29", value: 100 },
    { date: "2026-09-30", value: 50 },
  ],
  behaviour: null,
};

describe("breakdown report with live reports", () => {
  it("shows the previous period the analytics card compared with", () => {
    const report = buildBreakdown(view, "trends", "Traffic trends", facts);
    const totals = report.tables[0]!;
    expect(totals.columns).toEqual(["Name", "Comparison", "Reporting period", "Change"]);
    expect(totals.rows[0]).toEqual(["Site sessions", "200", "300", "+50%"]);
    expect(report.tables[1]!.columns).toContain("Previous sessions");
    expect(report.tables[1]!.rows[0]![4]).toBe("+100%");
  });

  it("compares sources by channel", () => {
    const [table] = buildBreakdown(view, "sources", "Sources", facts).tables;
    expect(table!.columns).toEqual(["Source", "Comparison", "Sessions", "Share", "Change"]);
    expect(table!.rows[0]![4]).toBe("+100%");
    expect(table!.rows[1]![4]).toBe("Not recorded");
  });

  it("says so when the previous period has not been fetched", () => {
    const [table] = buildBreakdown(view, "devices", "Devices", facts).tables;
    expect(table!.columns).not.toContain("Comparison");
    expect(table!.note).toMatch(/previous period has not been fetched/);
  });

  it("compares devices, visitors and pages with the previous window", () => {
    const withBehaviour: LiveTrafficFacts = { ...facts, behaviour: behaviour({ newVisitors: 90, returningVisitors: 60, pages: [{ name: "/", views: 120, engagementSeconds: 600, activeUsers: 10 }, { name: "/new", views: 30, engagementSeconds: null, activeUsers: null }] }) };
    const prior: PreviousDetailFacts = {
      devices: [{ name: "Mobile", sessions: 200 }],
      behaviour: behaviour({ newVisitors: 60, returningVisitors: 60, pages: [{ name: "/", views: 100, engagementSeconds: 400, activeUsers: 10 }] }),
    };
    const [devices] = buildBreakdown(view, "devices", "Devices", withBehaviour, prior).tables;
    expect(devices!.rows[0]).toEqual(["Mobile", "200", "250", "100%", "+25%"]);
    expect(devices!.note).toBeUndefined();
    const [visitors] = buildBreakdown(view, "visitors", "Visitors", withBehaviour, prior).tables;
    expect(visitors!.rows[0]![4]).toBe("+50%");
    const [views] = buildBreakdown(view, "pages", "Pages", withBehaviour, prior).tables;
    expect(views!.rows[0]![4]).toBe("+20%");
    expect(views!.rows[1]![4]).toBe("Not recorded");
  });

  it("keeps the recorded export without live reports", () => {
    const [table] = buildBreakdown(view, "trends", "Traffic trends").tables;
    expect(table!.rows.flat()).not.toContain("300");
  });
});

function behaviour(values: Partial<LiveBehaviourFacts>): LiveBehaviourFacts {
  return { engagementRate: null, averageSessionDuration: null, pagesPerSession: null, bounceRate: null, pages: [], newVisitors: null, returningVisitors: null, ...values };
}
