/** Operational date helpers. Boundaries are Asia/Singapore. Dates are YYYY-MM-DD strings. */
export const OPERATIONAL_TIME_ZONE = "Asia/Singapore";

export function todaySgt(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: OPERATIONAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function isValidDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Calendar date as "23 Aug". The stored value is a YYYY-MM-DD date, read in UTC so the day does not shift. */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "";
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""}`;
}

/** A period as "23 Aug - 21 Sep 2026". The year is written once, after the whole period. */
export function formatPeriod(start: string, end: string, separator = " - "): string {
  const startLabel = formatDate(start);
  const endLabel = formatDate(end);
  if (!startLabel || !endLabel) return startLabel || endLabel;
  const startYear = start.slice(0, 4);
  const endYear = end.slice(0, 4);
  if (start.slice(0, 10) === end.slice(0, 10)) return `${startLabel} ${endYear}`;
  if (startYear === endYear) return `${startLabel}${separator}${endLabel} ${endYear}`;
  return `${startLabel} ${startYear}${separator}${endLabel} ${endYear}`;
}

function singaporeParts(date: Date): { day: string; month: string; hour: string; minute: string } | null {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: OPERATIONAL_TIME_ZONE, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const month = MONTHS[Number(value("month")) - 1];
  if (!month) return null;
  return { day: String(Number(value("day"))), month, hour: value("hour"), minute: value("minute") };
}

/** "23 Aug, 15:33" in Asia/Singapore. */
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const parts = singaporeParts(date);
  if (!parts) return "";
  return `${parts.day} ${parts.month}, ${parts.hour}:${parts.minute}`;
}
