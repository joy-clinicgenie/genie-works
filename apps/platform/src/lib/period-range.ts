import { formatPeriod, isValidDate, todaySgt } from "@clinic-genie/db";
import type { PeriodWindow } from "@/lib/site-metrics";
import { addIsoDays, isoDaysBetween, periodRangeId as periodRangeIdFor, presetWindow, type PeriodRangeId } from "@/lib/period-options";

export type { PeriodRangeId } from "@/lib/period-options";

function windowFor(start: string, end: string): PeriodWindow {
  return { start, end, len: isoDaysBetween(start, end) + 1 };
}

function withPrevious(start: string, end: string): { current: PeriodWindow; previous: PeriodWindow } {
  const current = windowFor(start, end);
  const previousEnd = addIsoDays(start, -1);
  return { current, previous: windowFor(addIsoDays(previousEnd, -(current.len - 1)), previousEnd) };
}

/** The selected window and the equal-length window immediately before it. */
export function periodRange(id: PeriodRangeId, today = todaySgt()): { current: PeriodWindow; previous: PeriodWindow } {
  const span = presetWindow(id, today) ?? presetWindow("last30", today)!;
  return withPrevious(span.start, span.end);
}

/** A chosen calendar range. Rejects inverted dates, future ends, and spans longer than two years. */
export function customWindow(from?: string, to?: string, today = todaySgt()): { current: PeriodWindow; previous: PeriodWindow } | null {
  if (!from || !to || !isValidDate(from) || !isValidDate(to) || to < from || to > today) return null;
  if (isoDaysBetween(from, to) + 1 > 731) return null;
  return withPrevious(from, to);
}

/** Rolling presets end on the last complete day: today's provider figures are still partial (D52). */
const ROLLING_PRESETS = new Set(["last7", "last14", "last30", "last90", "last365", "last12"]);

export interface AnalyticsPeriod {
  rangeId: PeriodRangeId;
  windows: { current: PeriodWindow; previous: PeriodWindow };
  /** True when the window must be used as requested and not moved onto a recorded export. */
  exact: boolean;
  custom: boolean;
}

/**
 * The analytics window for a request. A custom range and live reports use the requested
 * dates exactly (D51). Rolling presets end yesterday, Asia/Singapore (D52).
 */
export function analyticsPeriod(input: { range?: string; from?: string; to?: string; live: boolean; today?: string }): AnalyticsPeriod {
  const today = input.today ?? todaySgt();
  const requested = periodRangeIdFor(input.range);
  const custom = requested === "custom" ? customWindow(input.from, input.to, today) : null;
  if (custom) return { rangeId: "custom", windows: custom, exact: true, custom: true };
  const rangeId: PeriodRangeId = requested === "custom" ? "last30" : requested;
  const anchor = ROLLING_PRESETS.has(rangeId) ? addIsoDays(today, -1) : today;
  return { rangeId, windows: periodRange(rangeId, anchor), exact: input.live, custom: false };
}

/** "23 Aug - 21 Sep 2026", or one date and its year when the window is a single day. */
export function formatCompared(period: PeriodWindow): string {
  return formatPeriod(period.start, period.end);
}
