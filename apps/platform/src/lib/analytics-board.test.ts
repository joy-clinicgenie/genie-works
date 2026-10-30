import { describe, expect, it } from "vitest";
import type { SnapshotRow } from "@clinic-genie/db";
import { boardFromSnapshots, organicFromChannels, trendFrom, visitorToLeadRate } from "@/lib/analytics-board";

const current = { start: "2026-10-01", end: "2026-10-30", len: 30 };
const previous = { start: "2026-09-01", end: "2026-09-30", len: 30 };

function row(overrides: { source: string; channel: string; metric: string; value: number; period?: "current" | "previous"; dimension?: string }): SnapshotRow {
  const period = overrides.period === "previous" ? previous : current;
  return {
    id: "1",
    client_id: "c",
    client_name: "Clinic",
    source: overrides.source,
    channel: overrides.channel,
    metric: overrides.metric as SnapshotRow["metric"],
    dimension: overrides.dimension ?? "",
    period_start: period.start,
    period_end: period.end,
    value: overrides.value,
    unit: "count",
    note: null,
    entered_by: "u",
    entered_by_name: "A",
    created_at: new Date("2026-10-31T00:00:00Z"),
    supersedes_id: null,
    superseded_by_id: null,
  };
}

describe("visitor to lead rate", () => {
  it("divides stored leads by visitors", () => {
    expect(visitorToLeadRate(14, 972)).toBe(1.4);
    expect(visitorToLeadRate(11, 905)).toBe(1.2);
  });

  it("stays unrecorded when visitors are missing or zero", () => {
    expect(visitorToLeadRate(14, null)).toBeNull();
    expect(visitorToLeadRate(null, 972)).toBeNull();
    expect(visitorToLeadRate(14, 0)).toBeNull();
  });
});

describe("organic sessions", () => {
  it("sums organic search sessions and leaves other channels out", () => {
    expect(organicFromChannels([
      { channel: "organic_search", current: 684, previous: 612 },
      { channel: "Organic Search", current: 10, previous: 8 },
      { channel: "paid_search", current: 221, previous: 248 },
      { channel: "organic social", current: 40, previous: 30 },
    ])).toEqual({ current: 694, previous: 620 });
  });

  it("is unrecorded when no organic channel is present", () => {
    expect(organicFromChannels([{ channel: "direct", current: 12, previous: 0 }])).toEqual({ current: null, previous: null });
    expect(organicFromChannels([])).toEqual({ current: null, previous: null });
  });
});

describe("analytics board from snapshots", () => {
  const snapshots = [
    row({ source: "ga4_export", channel: "organic_search", metric: "sessions", value: 684 }),
    row({ source: "ga4_export", channel: "organic_search", metric: "sessions", value: 612, period: "previous" }),
    row({ source: "ga4_export", channel: "paid_search", metric: "sessions", value: 221 }),
    row({ source: "ga4_export", channel: "direct", metric: "sessions", value: 204 }),
    row({ source: "search_console_export", channel: "organic_search", metric: "clicks", value: 531 }),
    row({ source: "manual", channel: "all", metric: "unique_visitors", value: 972 }),
    row({ source: "manual", channel: "all", metric: "unique_visitors", value: 905, period: "previous" }),
    row({ source: "clinic_records", channel: "all", metric: "enquiries", value: 14 }),
    row({ source: "clinic_records", channel: "all", metric: "enquiries", value: 11, period: "previous" }),
    row({ source: "ga4_export", channel: "all", metric: "bounce_rate", value: 42 }),
    row({ source: "manual", channel: "all", metric: "landing_sessions", value: 100, dimension: "/a" }),
    row({ source: "manual", channel: "all", metric: "landing_sessions", value: 50, dimension: "/b" }),
    row({ source: "manual", channel: "all", metric: "landing_contacts", value: 2, dimension: "/a" }),
    row({ source: "manual", channel: "all", metric: "landing_contacts", value: 10, dimension: "/b" }),
  ];

  const board = boardFromSnapshots({ snapshots, current, previous, updatedAt: null });

  it("uses organic search sessions, not search clicks", () => {
    expect(board.organic.current).toBe(684);
    expect(board.organic.previous).toBe(612);
    expect(board.sessions.current).toBe(684 + 221 + 204);
  });

  it("computes visitor-to-lead from enquiries and visitors", () => {
    expect(board.leads.current).toBe(14);
    expect(board.users.current).toBe(972);
    expect(board.conversionRate.current).toBe(1.4);
    expect(board.conversionRate.previous).toBe(1.2);
    expect(board.conversionRate.percent).toBe(16.7);
  });

  it("does not invent engagement rate from bounce rate", () => {
    expect(board.bounceRate.current).toBe(42);
    expect(board.engagementRate.current).toBeNull();
  });

  it("ranks converting pages by contact actions", () => {
    expect(board.converting.map((row) => row.name)).toEqual(["/b", "/a"]);
    expect(board.converting[0]?.contacts).toBe(10);
    expect(board.landing[0]?.name).toBe("/a");
  });

  it("compares two period totals when no daily rows exist", () => {
    expect(trendFrom(10, 8, [], [])).toEqual({
      mode: "period",
      points: [
        { label: "Previous period", current: 8, previous: null },
        { label: "Current period", current: 10, previous: null },
      ],
    });
    expect(board.trend.mode).toBe("period");
  });

  it("draws a daily line only from recorded days", () => {
    const trend = trendFrom(10, 8, [{ date: "2026-10-01", value: 4 }, { date: "2026-10-02", value: null }], [{ date: "2026-09-01", value: 3 }]);
    expect(trend.mode).toBe("daily");
    expect(trend.points[0]).toMatchObject({ current: 4, previous: 3 });
    expect(trend.points[1]?.current).toBeNull();
  });
});
