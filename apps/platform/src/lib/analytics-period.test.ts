import { describe, expect, it } from "vitest";
import { analyticsPeriod } from "./period-range";
import { alignRecordedPeriod } from "./site-metrics";
import type { SnapshotRow } from "@clinic-genie/db";

const TODAY = "2026-11-12";

describe("analytics period selection (D51, D52)", () => {
  it("ends rolling presets on the last complete Singapore day", () => {
    expect(analyticsPeriod({ range: "last7", live: true, today: TODAY }).windows.current).toEqual({ start: "2026-11-05", end: "2026-11-11", len: 7 });
    expect(analyticsPeriod({ range: "last30", live: true, today: TODAY }).windows).toEqual({
      current: { start: "2026-10-13", end: "2026-11-11", len: 30 },
      previous: { start: "2026-09-13", end: "2026-10-12", len: 30 },
    });
    expect(analyticsPeriod({ range: "last90", live: false, today: TODAY }).windows.current).toEqual({ start: "2026-08-14", end: "2026-11-11", len: 90 });
  });

  it("keeps Today, Yesterday and This month on their calendar days", () => {
    expect(analyticsPeriod({ range: "today", live: true, today: TODAY }).windows.current).toEqual({ start: TODAY, end: TODAY, len: 1 });
    expect(analyticsPeriod({ range: "yesterday", live: true, today: TODAY }).windows.current).toEqual({ start: "2026-11-11", end: "2026-11-11", len: 1 });
    expect(analyticsPeriod({ range: "month", live: true, today: TODAY }).windows.current).toEqual({ start: "2026-11-01", end: TODAY, len: 12 });
  });

  it("uses the requested window exactly in live mode and for a custom range", () => {
    expect(analyticsPeriod({ range: "last30", live: true, today: TODAY }).exact).toBe(true);
    expect(analyticsPeriod({ range: "last30", live: false, today: TODAY }).exact).toBe(false);
    const custom = analyticsPeriod({ range: "custom", from: "2026-10-01", to: "2026-10-10", live: false, today: TODAY });
    expect(custom).toMatchObject({ rangeId: "custom", exact: true, custom: true });
    expect(custom.windows.current).toEqual({ start: "2026-10-01", end: "2026-10-10", len: 10 });
  });

  it("falls back to Last 30 when a custom range is invalid", () => {
    const invalid = analyticsPeriod({ range: "custom", from: "2026-10-10", to: "2026-10-01", live: true, today: TODAY });
    expect(invalid).toMatchObject({ rangeId: "last30", custom: false });
  });

  it("does not move a live window onto an older recorded export", () => {
    const old = { period_start: "2026-09-01", period_end: "2026-09-30", metric: "sessions", source: "ga4_export", channel: "all", dimension: "", value: 1 } as unknown as SnapshotRow;
    const live = analyticsPeriod({ range: "last30", live: true, today: TODAY });
    expect(alignRecordedPeriod([old], live.windows, live.exact).current).toEqual(live.windows.current);
    const snapshot = analyticsPeriod({ range: "last30", live: false, today: TODAY });
    expect(alignRecordedPeriod([old], snapshot.windows, snapshot.exact).current).toMatchObject({ start: "2026-09-01", end: "2026-09-30" });
  });
});
