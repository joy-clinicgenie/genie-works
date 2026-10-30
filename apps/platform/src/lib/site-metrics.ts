import { daysBetween, type SnapshotRow } from "@clinic-genie/db";

export function day(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function asNumber(value: number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface PeriodWindow {
  start: string;
  end: string;
  len: number;
}

export function periodWindows(rows: SnapshotRow[]): PeriodWindow[] {
  return [...new Map(rows.map((row) => {
    const start = day(row.period_start);
    const end = day(row.period_end);
    return [`${start}|${end}`, { start, end, len: daysBetween(start, end) + 1 }] as const;
  })).values()].sort((a, b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start));
}

export function matchedPeriods(rows: SnapshotRow[]): { current?: PeriodWindow; previous?: PeriodWindow } {
  const periods = periodWindows(rows);
  const current = periods[0];
  const previous = current ? periods.find((period) => period.end < current.start && period.len === current.len) : undefined;
  return { current, previous };
}

function covers(rows: SnapshotRow[], period: PeriodWindow): boolean {
  return rows.some((row) => day(row.period_start) === period.start && day(row.period_end) === period.end);
}

/**
 * Uses the selected calendar window when an export exists for it.
 * Otherwise uses the latest saved window of the same length that has already ended,
 * so a new day does not hide the last export.
 */
export function alignRecordedPeriod(rows: SnapshotRow[], requested: { current: PeriodWindow; previous: PeriodWindow }, exact = false): { current: PeriodWindow; previous?: PeriodWindow; aligned: boolean } {
  if (exact || covers(rows, requested.current)) return { ...requested, aligned: false };
  const current = periodWindows(rows).find((period) => period.len === requested.current.len && period.end <= requested.current.end);
  if (!current) return { ...requested, aligned: false };
  const previous = periodWindows(rows).find((period) => period.len === current.len && period.end < current.start);
  return { current, previous, aligned: true };
}

export interface MetricPair {
  current: number | null;
  previous: number | null;
  percent: number | null;
}

export function sumMetric(rows: SnapshotRow[], period: PeriodWindow | undefined, metric: string, source: string, channel?: string): number | null {
  if (!period) return null;
  const numbers = rows
    .filter((row) => day(row.period_start) === period.start && day(row.period_end) === period.end && row.metric === metric && row.source === source && (row.dimension ?? "") === "" && (channel === undefined || row.channel === channel))
    .map((row) => asNumber(row.value))
    .filter((value): value is number => value !== null);
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0);
}

export function pairMetric(rows: SnapshotRow[], periods: { current?: PeriodWindow; previous?: PeriodWindow }, metric: string, source: string, channel?: string): MetricPair {
  const current = sumMetric(rows, periods.current, metric, source, channel);
  const previous = sumMetric(rows, periods.previous, metric, source, channel);
  const percent = current === null || previous === null || previous === 0 ? null : Number((((current - previous) / previous) * 100).toFixed(1));
  return { current, previous, percent };
}

export function channelsFor(rows: SnapshotRow[], period: PeriodWindow | undefined, metric: string, source: string, previous?: PeriodWindow): Array<{ channel: string; current: number; previous: number | null }> {
  if (!period) return [];
  const channels = [...new Set(rows.filter((row) => row.metric === metric && row.source === source && row.channel !== "all").map((row) => row.channel))];
  const previousPeriod = previous ?? matchedPeriods(rows).previous;
  return channels.flatMap((channel) => {
    const current = sumMetric(rows, period, metric, source, channel);
    if (current === null) return [];
    return [{ channel, current, previous: sumMetric(rows, previousPeriod, metric, source, channel) }];
  });
}

export interface DimensionValue {
  name: string;
  current: number;
}

export function dimensionPairs(rows: SnapshotRow[], periods: { current?: PeriodWindow; previous?: PeriodWindow }, metric: string, source: string, channel = "all"): Array<{ name: string; current: number | null; previous: number | null; percent: number | null }> {
  const currentRows = dimensionRows(rows, periods.current, metric, source, channel);
  const previousRows = dimensionRows(rows, periods.previous, metric, source, channel);
  const names = [...new Set([...currentRows.map((row) => row.name), ...previousRows.map((row) => row.name)])];
  return names.map((name) => {
    const current = currentRows.find((row) => row.name === name)?.current ?? null;
    const previous = periods.previous ? previousRows.find((row) => row.name === name)?.current ?? null : null;
    const percent = current === null || previous === null || previous === 0 ? null : Number((((current - previous) / previous) * 100).toFixed(1));
    return { name, current, previous, percent };
  }).sort((a, b) => (b.current ?? -1) - (a.current ?? -1) || a.name.localeCompare(b.name));
}

export function dimensionRows(rows: SnapshotRow[], period: PeriodWindow | undefined, metric: string, source: string, channel = "all"): DimensionValue[] {
  if (!period) return [];
  return rows
    .filter((row) => day(row.period_start) === period.start && day(row.period_end) === period.end && row.metric === metric && row.source === source && row.channel === channel && (row.dimension ?? "") !== "")
    .flatMap((row) => {
      const current = asNumber(row.value);
      return current === null ? [] : [{ name: row.dimension, current }];
    })
    .sort((a, b) => b.current - a.current);
}

export function latestUpdate(rows: SnapshotRow[]): Date | null {
  return rows.reduce<Date | null>((latest, row) => (!latest || row.created_at > latest ? row.created_at : latest), null);
}

export function formatCount(value: number | null): string {
  if (value === null) return "Not recorded";
  return new Intl.NumberFormat("en-SG", { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 }).format(value);
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Not recorded";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes === 0 ? `${rest}s` : `${minutes}m ${rest}s`;
}

export function formatPercentPoint(value: number | null): string {
  if (value === null) return "Not recorded";
  return `${new Intl.NumberFormat("en-SG", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}%`;
}

export function formatMove(percent: number | null): string | null {
  if (percent === null) return null;
  return `${percent < 0 ? "↓" : "↑"} ${Math.abs(percent)}%`;
}
