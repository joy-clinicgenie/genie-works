import { formatPeriod, isValidDate, todaySgt } from "@clinic-genie/db";
import type { PeriodWindow } from "@/lib/site-metrics";
import { addIsoDays, isoDaysBetween, presetWindow, type PeriodRangeId } from "@/lib/period-options";

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

/** "23 Aug - 21 Sep 2026", or one date and its year when the window is a single day. */
export function formatCompared(period: PeriodWindow): string {
  return formatPeriod(period.start, period.end);
}
