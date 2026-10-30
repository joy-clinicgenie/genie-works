import { createHash } from "node:crypto";
import { addDays, daysBetween } from "../services/dates";

export const PROVIDERS = ["ga4", "wix", "gsc"] as const;
export type AnalyticsProvider = (typeof PROVIDERS)[number];

export const CONTACT_EVENTS = ["whatsapp_click", "phone_click", "email_click", "booking_link_click"] as const;

export type MetricState = "available" | "unavailable" | "suppressed" | "unsupported";

export interface DatedCount {
  date: string;
  sessions: number | null;
  coverage: "complete" | "partial" | "missing";
}

/** A range total is valid only when the provider returned that exact range. Daily rows are refused. */
export function usersFromReport(report: { templateKey: string; rows: Array<{ dimensionKey: string; metrics: Array<{ key: string; value: number | null; state: string }> }> } | null): { state: "available"; value: number } | { state: "unavailable"; reason: string } {
  if (!report || report.templateKey !== "ga4.traffic_range") return exactRangeUsers();
  const metric = report.rows.find((row) => row.dimensionKey === "range")?.metrics.find((item) => item.key === "totalUsers");
  if (!metric || metric.state !== "available" || metric.value === null) return exactRangeUsers();
  return { state: "available", value: metric.value };
}

/** Distinct people cannot be recovered by adding daily, device or page user counts. */
export function exactRangeUsers(): { state: "unavailable"; reason: string } {
  return { state: "unavailable", reason: "Distinct users cannot be recovered by summing daily totals." };
}

export function refuseCombinedTraffic(left: AnalyticsProvider, right: AnalyticsProvider): void {
  if (left !== right) {
    throw new Error(`Traffic from ${left} and ${right} is not added together.`);
  }
}

export type Change =
  | { kind: "percent"; value: number }
  | { kind: "new_activity" }
  | { kind: "no_change" }
  | { kind: "unavailable" };

export function percentChange(current: number | null, previous: number | null): Change {
  if (current === null || previous === null) return { kind: "unavailable" };
  if (previous === 0 && current === 0) return { kind: "no_change" };
  if (previous === 0 && current > 0) return { kind: "new_activity" };
  return { kind: "percent", value: Number((((current - previous) / previous) * 100).toFixed(1)) };
}

/** Position uses positions. An equal value is no change, not an upward percentage. */
export function positionChange(current: number | null, previous: number | null): Change {
  if (current === null || previous === null) return { kind: "unavailable" };
  const delta = Number((current - previous).toFixed(1));
  if (delta === 0) return { kind: "no_change" };
  return { kind: "percent", value: delta };
}

export function previousWindow(start: string, end: string): { start: string; end: string } {
  const length = daysBetween(start, end) + 1;
  const previousEnd = addDays(start, -1);
  return { start: addDays(previousEnd, -(length - 1)), end: previousEnd };
}

export function weekdayAverages(rows: DatedCount[]): Array<{ weekday: string; average: number | null; covered: number; eligible: number }> {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return names.map((weekday, index) => {
    const matching = rows.filter((row) => weekdayIndex(row.date) === index);
    const covered = matching.filter((row) => row.coverage === "complete" && row.sessions !== null);
    const eligible = matching.filter((row) => row.coverage !== "missing");
    if (covered.length === 0) return { weekday, average: null, covered: 0, eligible: eligible.length };
    const sum = covered.reduce((total, row) => total + (row.sessions ?? 0), 0);
    return { weekday, average: Math.round(sum / covered.length), covered: covered.length, eligible: eligible.length };
  });
}

function weekdayIndex(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

export function contactSplit(events: Array<{ type: string; count: number }>): { contact: number; other: number } {
  return events.reduce(
    (totals, event) => {
      const contact = (CONTACT_EVENTS as readonly string[]).includes(event.type);
      return { contact: totals.contact + (contact ? event.count : 0), other: totals.other + (contact ? 0 : event.count) };
    },
    { contact: 0, other: 0 },
  );
}

/** Side-by-side event counts are not a cohort completion rate. */
export function submissionEventRatio(successes: number | null, starts: number | null): { label: string; ratio: number | null } {
  if (successes === null || starts === null || starts <= 0) return { label: "Submission events / start events", ratio: null };
  return { label: "Submission events / start events", ratio: successes / starts };
}

export function gscDetailIncomplete(detailClicks: number, propertyClicks: number): boolean {
  return detailClicks < propertyClicks;
}

export function coverageForRange(trackingStart: string | null, rangeStart: string, rangeEnd: string): "not_tracked" | "partial" | "complete" {
  if (!trackingStart || trackingStart > rangeEnd) return "not_tracked";
  if (trackingStart > rangeStart) return "partial";
  return "complete";
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function queryHash(templateKey: string, version: number, body: unknown): string {
  return stableHash({ templateKey, version, body });
}

const SENSITIVE_KEY = /email|e-mail|phone|tel|mobile|name|symptom|message|token|secret|password|patient|utm_|gclid|fbclid|msclkid/i;
const SENSITIVE_VALUE = /[@]|^\+?\d[\d\s()-]{6,}$|bearer\s/i;

/** Keep a path. Drop queries, fragments, contact schemes and sensitive segments. */
export function safeAnalyticsPath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /^(mailto:|tel:|sms:|whatsapp:)/i.test(trimmed)) return null;
  let path = trimmed;
  try {
    if (/^https?:\/\//i.test(trimmed)) path = new URL(trimmed).pathname;
  } catch {
    return null;
  }
  path = path.split("#")[0]?.split("?")[0] ?? "";
  if (!path.startsWith("/")) path = `/${path}`;
  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => SENSITIVE_KEY.test(decodeURIComponentSafe(segment)) || SENSITIVE_VALUE.test(decodeURIComponentSafe(segment)))) return null;
  const cleaned = `/${segments.map((segment) => decodeURIComponentSafe(segment)).join("/")}`.replace(/\/{2,}/g, "/");
  return cleaned === "/" ? "/" : cleaned.replace(/\/$/, "");
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function safeSearchQuery(value: string): string | null {
  const trimmed = value.trim().slice(0, 200);
  if (!trimmed || SENSITIVE_KEY.test(trimmed) || SENSITIVE_VALUE.test(trimmed)) return null;
  return trimmed;
}

export function sensitiveQueryKeys(search: string): string[] {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return [...params.keys()].filter((key) => SENSITIVE_KEY.test(key) || [...params.getAll(key)].some((value) => SENSITIVE_VALUE.test(value)));
}

export function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replaceAll('"', '""')}"`;
  return guarded;
}

export function csvLine(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

export interface ImportRow {
  date: string;
  metric: string;
  value: number;
}

export type ImportDecision = "replay" | "overlap" | "accept" | "reject";

export function classifyImport(input: {
  checksum: string;
  start: string;
  end: string;
  existing: Array<{ checksum: string; start: string; end: string; provenance: string }>;
  replace: boolean;
}): ImportDecision {
  if (input.existing.some((row) => row.checksum === input.checksum)) return "replay";
  const overlaps = input.existing.some((row) => row.start <= input.end && input.start <= row.end);
  if (!overlaps) return "accept";
  if (input.existing.some((row) => row.provenance === "api") && !input.replace) return "reject";
  return input.replace ? "overlap" : "reject";
}

export function parseMetricCsv(text: string): { rows: ImportRow[] } | { error: string } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  const header = lines[0]?.split(",").map((cell) => cell.trim().toLowerCase()) ?? [];
  if (header.some((cell) => SENSITIVE_KEY.test(cell))) return { error: "The file contains a column that is not allowed in analytics." };
  if (header.join(",") !== "date,metric,value") return { error: "The file must use the columns date, metric and value." };
  const rows: ImportRow[] = [];
  for (const line of lines.slice(1)) {
    const [date, metric, raw] = splitCsv(line);
    if (!date || !metric || raw === undefined) return { error: "A row is missing a column." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "A date is not in YYYY-MM-DD form." };
    if (SENSITIVE_KEY.test(metric) || SENSITIVE_VALUE.test(metric)) return { error: "A metric name is not allowed." };
    if (!/^\d+(\.\d+)?$/.test(raw)) return { error: "A value is not a number." };
    rows.push({ date, metric, value: Number(raw) });
  }
  return { rows };
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}
