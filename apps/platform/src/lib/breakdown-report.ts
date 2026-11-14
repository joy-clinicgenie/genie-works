import { addDays, daysBetween, formatDate, formatPeriod } from "@clinic-genie/db";
import { label } from "@/components/ui/Badge";
import { channelName, percentChange, type LiveTrafficFacts, type PreviousDetailFacts } from "@/lib/analytics-board";
import type { BreakdownKind } from "@/lib/report-link";
import { dailySessions, sessionSeed } from "@/lib/session-shape";
import { channelsFor, dimensionPairs, formatCount, formatDuration, formatPercentPoint, pairMetric } from "@/lib/site-metrics";
import type { SiteView } from "@/lib/site-view";

const SOURCE_NAMES: Record<string, string> = {
  paid_search: "Google (Paid)",
  organic_search: "Google (Organic)",
  direct: "Direct",
  referral: "Referral",
  social: "Social",
  email: "Email",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface BreakdownTable {
  title: string;
  note?: string;
  columns: string[];
  rows: string[][];
  empty?: string;
}

export interface BreakdownReport {
  title: string;
  period: string;
  comparison: string | null;
  tables: BreakdownTable[];
}

type Row = { name: string; current: number | null; previous: number | null; percent: number | null };

function sourceName(channel: string) {
  return SOURCE_NAMES[channel] ?? label(channel);
}

function changeText(row: Row, compared: boolean): string {
  if (!compared) return "";
  if (row.percent !== null) return `${row.percent > 0 ? "+" : ""}${row.percent}%`;
  if (row.previous === 0) return "Zero baseline, no %";
  return "Not recorded";
}

function figure(value: number | null, unit: "count" | "duration" | "percent" = "count"): string {
  if (unit === "duration") return formatDuration(value);
  if (unit === "percent") return formatPercentPoint(value);
  return formatCount(value);
}

function shares(rows: Row[]): string[] {
  const result = rows.map(() => "");
  const indexes = rows.flatMap((row, index) => (row.current === null ? [] : [index]));
  const values = indexes.map((index) => rows[index]!.current ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return result;
  const exact = values.map((value) => (value / total) * 100);
  const rounded = exact.map((value) => Math.round(value));
  const drift = 100 - rounded.reduce((sum, value) => sum + value, 0);
  if (drift !== 0) {
    const target = exact.reduce((best, value, index) => (value - Math.round(value) > exact[best]! - Math.round(exact[best]!) ? index : best), 0);
    rounded[target] = (rounded[target] ?? 0) + drift;
  }
  indexes.forEach((rowIndex, shareIndex) => {
    result[rowIndex] = `${rounded[shareIndex] ?? 0}%`;
  });
  return result;
}

function listTable(title: string, rows: Row[], options: { share?: boolean; unit?: "count" | "duration" | "percent"; name?: string; value?: string; empty: string; note?: string; compared: boolean }): BreakdownTable {
  const share = options.share ? shares(rows) : [];
  const columns = [options.name ?? "Name", ...(options.compared ? ["Comparison"] : []), options.value ?? "Reporting period", ...(options.share ? ["Share"] : []), ...(options.compared ? ["Change"] : [])];
  return {
    title,
    note: options.note,
    empty: rows.length === 0 ? options.empty : undefined,
    columns,
    rows: rows.map((row, index) => [
      row.name,
      ...(options.compared ? [figure(row.previous, options.unit)] : []),
      figure(row.current, options.unit),
      ...(options.share ? [share[index] || ""] : []),
      ...(options.compared ? [changeText(row, true)] : []),
    ]),
  };
}

function channelRows(view: SiteView, metric: string, source: string): Row[] {
  return channelsFor(view.snapshots, view.current, metric, source, view.previous)
    .map((row) => ({
      name: sourceName(row.channel),
      current: row.current,
      previous: row.previous,
      percent: row.previous === null || row.previous === 0 ? null : Number((((row.current - row.previous) / row.previous) * 100).toFixed(1)),
    }))
    .filter((row) => row.current > 0 || (row.previous !== null && row.previous > 0))
    .sort((a, b) => b.current - a.current);
}

function dimensionRows(view: SiteView, metric: string): Row[] {
  return dimensionPairs(view.snapshots, { current: view.current, previous: view.previous }, metric, "manual");
}

function weekdayRows(total: number, start: string, end: string, seed: number): Row[] {
  const days = daysBetween(start, end) + 1;
  const values = dailySessions(total, start, days, seed);
  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (let index = 0; index < days; index += 1) {
    const dow = new Date(`${addDays(start, index)}T00:00:00Z`).getUTCDay();
    const slot = dow === 0 ? 6 : dow - 1;
    sums[slot] = (sums[slot] ?? 0) + (values[index] ?? 0);
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  return WEEKDAYS.flatMap((name, index) => (counts[index] ? [{ name, current: Math.round((sums[index] ?? 0) / (counts[index] ?? 1)), previous: null, percent: null }] : []));
}

function build(view: SiteView, kind: BreakdownKind): BreakdownTable[] {
  const compared = Boolean(view.previous);
  const periods = { current: view.current, previous: view.previous };
  if (kind === "trends") {
    const sessions = pairMetric(view.snapshots, periods, "sessions", "ga4_export");
    const visitors = pairMetric(view.snapshots, periods, "unique_visitors", "manual", "all");
    const totals = listTable("Recorded totals", [
      { name: "Site sessions", ...sessions },
      { name: "Unique visitors", ...visitors },
    ], { compared, empty: "Not recorded.", value: "Reporting period" });
    if (sessions.current === null || !view.current) {
      return [totals, { title: "Sessions by day", columns: [], rows: [], empty: "Not recorded." }];
    }
    const seed = sessionSeed(view.clientId);
    const days = daysBetween(view.current.start, view.current.end) + 1;
    const daily = dailySessions(sessions.current, view.current.start, days, seed);
    return [
      totals,
      {
        title: "Sessions by day",
        note: "Each day is a share of the recorded session total. The export does not list a separate count for each day.",
        columns: ["Date", "Sessions"],
        rows: daily.map((value, index) => [formatDate(addDays(view.current!.start, index)), formatCount(value)]),
      },
      listTable("Average sessions by weekday", weekdayRows(sessions.current, view.current.start, view.current.end, seed), {
        compared: false,
        empty: "Not recorded.",
        name: "Weekday",
        value: "Average sessions",
        note: "Averages use that same daily share.",
      }),
    ];
  }
  if (kind === "sources") {
    return [
      listTable("Sessions by source and category", channelRows(view, "sessions", "ga4_export"), { compared, share: true, empty: "No session export for this period.", name: "Source", value: "Sessions" }),
      listTable("Visitors by source and category", channelRows(view, "unique_visitors", "manual"), { compared, share: true, empty: "Not recorded. Visitors are not split by source.", name: "Source", value: "Visitors" }),
    ];
  }
  if (kind === "visitors") {
    const slices = [
      { name: "New", ...pairMetric(view.snapshots, periods, "new_visitors", "manual", "all") },
      { name: "Returning", ...pairMetric(view.snapshots, periods, "returning_visitors", "manual", "all") },
    ];
    if (slices.some((slice) => slice.current === null)) return [{ title: "New and returning visitors", columns: [], rows: [], empty: "Not recorded. Visitors are not split into new and returning." }];
    return [listTable("New and returning visitors", slices, { compared, share: true, empty: "Not recorded.", name: "Visitors", value: "Unique visitors" })];
  }
  if (kind === "devices") {
    const slices = [
      { name: "Mobile", ...pairMetric(view.snapshots, periods, "device_sessions", "manual", "mobile") },
      { name: "Desktop", ...pairMetric(view.snapshots, periods, "device_sessions", "manual", "desktop") },
      { name: "Tablet", ...pairMetric(view.snapshots, periods, "device_sessions", "manual", "tablet") },
    ];
    if (slices.some((slice) => slice.current === null)) return [{ title: "Sessions by device", columns: [], rows: [], empty: "Not recorded. Sessions are not split by mobile, desktop, or tablet." }];
    return [listTable("Sessions by device", slices, { compared, share: true, empty: "Not recorded.", name: "Device", value: "Sessions" })];
  }
  if (kind === "pages") {
    return [
      listTable("Visits", dimensionRows(view, "page_visits"), { compared, share: true, empty: "Not recorded. Visits are not split by page.", name: "Page", value: "Visits" }),
      listTable("Button clicks by page", dimensionRows(view, "page_clicks"), { compared, share: true, empty: "Not recorded. Button clicks are not split by page.", name: "Page", value: "Clicks" }),
      listTable("Average time on page", dimensionRows(view, "page_time"), { compared, unit: "duration", empty: "Not recorded. Time on page is not split by page.", name: "Page", value: "Average time" }),
      listTable("Exit rate", dimensionRows(view, "page_exit_rate"), { compared, unit: "percent", empty: "Not recorded. Exit rate is not split by page.", name: "Page", value: "Exit rate" }),
    ];
  }
  if (kind === "clicks") {
    return [listTable("Button clicks", dimensionRows(view, "click_target"), { compared, share: true, empty: "Not recorded. Clicks are not split by button or link.", name: "Button or link", value: "Clicks" })];
  }
  if (kind === "paths") {
    return [listTable("Navigation paths", dimensionRows(view, "nav_flow"), { compared, share: true, empty: "Not recorded. The export does not include the path from one page to the next.", name: "Path", value: "Sessions" })];
  }
  const metrics = [
    { name: "Form views", ...pairMetric(view.snapshots, periods, "form_views", "manual", "all") },
    { name: "Submissions started", ...pairMetric(view.snapshots, periods, "form_starts", "manual", "all") },
    { name: "Total submissions", ...pairMetric(view.snapshots, periods, "form_submissions", "manual", "all") },
    { name: "Enquiries", ...pairMetric(view.snapshots, periods, "enquiries", "clinic_records", "all") },
  ];
  return [
    listTable("Form funnel", metrics, { compared, empty: "Not recorded.", name: "Step", value: "Reporting period" }),
    listTable("Submissions by traffic source", channelRows(view, "form_submissions", "manual"), { compared, share: true, empty: "Not recorded. Form submissions are not split by source.", name: "Source", value: "Submissions" }),
    listTable("Submissions by location", dimensionRows(view, "form_location"), { compared, share: true, empty: "Not recorded. Form submissions are not split by location.", name: "Location", value: "Submissions" }),
  ];
}

const NOT_COMPARED = "The previous period has not been fetched for this report yet, so there is no comparison.";

/** Pairs this period's rows with the previous window's rows by name. A name missing last period has no baseline. */
function pairByName<T>(current: T[], previous: T[] | null, name: (row: T) => string, value: (row: T) => number | null): Row[] {
  const prior = previous ? new Map(previous.map((row) => [name(row), value(row)])) : null;
  return current.map((row) => liveRow(name(row), value(row), prior?.get(name(row)) ?? null));
}

function engagementPerUser(row: { engagementSeconds: number | null; activeUsers: number | null }): number | null {
  return row.engagementSeconds !== null && row.activeUsers ? Number((row.engagementSeconds / row.activeUsers).toFixed(1)) : null;
}

function liveRow(name: string, current: number | null, previous: number | null): Row {
  return { name, current, previous, percent: percentChange(current, previous) };
}

function averageByWeekday(daily: Array<{ date: string; value: number | null }>): Row[] {
  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const point of daily) {
    if (point.value === null) continue;
    const dow = new Date(`${point.date}T00:00:00Z`).getUTCDay();
    const slot = dow === 0 ? 6 : dow - 1;
    sums[slot] = (sums[slot] ?? 0) + point.value;
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  return WEEKDAYS.flatMap((name, index) => (counts[index] ? [{ name, current: Math.round((sums[index] ?? 0) / (counts[index] ?? 1)), previous: null, percent: null }] : []));
}

/**
 * Traffic reports drawn from the same provider data as the analytics cards (live reports on), so the
 * report shows the comparison the card showed. Returns null for reports that stay on the recorded export.
 */
function buildLive(view: SiteView, kind: BreakdownKind, facts: LiveTrafficFacts, prior: PreviousDetailFacts | null): BreakdownTable[] | null {
  const compared = Boolean(view.previous);
  const unconnected = facts.connected ? undefined : facts.sourceNote;
  if (kind === "trends") {
    const totals = listTable("Recorded totals", facts.connected ? [
      liveRow("Site sessions", facts.sessions, facts.sessionsPrevious),
      liveRow("Unique visitors", facts.users, facts.usersPrevious),
    ] : [], { compared, empty: unconnected ?? "Not recorded.", value: "Reporting period" });
    if (!facts.connected || facts.dailyCurrent.length === 0) return [totals, { title: "Sessions by day", columns: [], rows: [], empty: unconnected ?? "Not recorded." }];
    const previous = compared && facts.dailyPrevious.length > 0;
    return [
      totals,
      {
        title: "Sessions by day",
        note: previous ? "The previous period follows the same day order." : undefined,
        columns: previous ? ["Date", "Sessions", "Previous period date", "Previous sessions", "Change"] : ["Date", "Sessions"],
        rows: facts.dailyCurrent.map((point, index) => {
          const cells = [formatDate(point.date), formatCount(point.value)];
          if (!previous) return cells;
          const prior = facts.dailyPrevious[index];
          return [...cells, prior ? formatDate(prior.date) : "", formatCount(prior?.value ?? null), changeText(liveRow("", point.value, prior?.value ?? null), true)];
        }),
      },
      listTable("Average sessions by weekday", averageByWeekday(facts.dailyCurrent), { compared: false, empty: "Not recorded.", name: "Weekday", value: "Average sessions" }),
    ];
  }
  if (kind === "sources") {
    const rows = (facts.channels ?? [])
      .map((row) => liveRow(channelName(row.channel), row.current, row.previous))
      .sort((a, b) => (b.current ?? 0) - (a.current ?? 0));
    return [listTable("Sessions by source and category", rows, { compared, share: true, empty: unconnected ?? "Not recorded. Sessions are not split by channel.", name: "Source", value: "Sessions" })];
  }
  if (kind === "devices") {
    const previous = compared ? prior?.devices ?? null : null;
    const rows = pairByName(facts.devices ?? [], previous, (row) => row.name, (row) => row.sessions);
    return [listTable("Sessions by device", rows, { compared: previous !== null, share: true, empty: unconnected ?? "Not recorded. Sessions are not split by device.", name: "Device", value: "Sessions", note: compared && previous === null ? NOT_COMPARED : undefined })];
  }
  const behaviour = facts.provider === "ga4" ? facts.behaviour : null;
  if (!behaviour) return null;
  const priorBehaviour = compared ? prior?.behaviour ?? null : null;
  if (kind === "visitors") {
    if (behaviour.newVisitors === null || behaviour.returningVisitors === null) return [{ title: "New and returning visitors", columns: [], rows: [], empty: "Not recorded. Visitors are not split into new and returning." }];
    const split = priorBehaviour !== null && priorBehaviour.newVisitors !== null && priorBehaviour.returningVisitors !== null;
    const rows = [
      liveRow("New", behaviour.newVisitors, split ? priorBehaviour.newVisitors : null),
      liveRow("Returning", behaviour.returningVisitors, split ? priorBehaviour.returningVisitors : null),
    ];
    return [listTable("New and returning visitors", rows, { compared: split, share: true, empty: "Not recorded.", name: "Visitors", value: "Active users", note: compared && !split ? NOT_COMPARED : undefined })];
  }
  if (kind === "pages") {
    const pages = [...behaviour.pages].sort((a, b) => b.views - a.views || a.name.localeCompare(b.name));
    const priorPages = priorBehaviour && priorBehaviour.pages.length > 0 ? priorBehaviour.pages : null;
    const pageCompared = priorPages !== null;
    const note = compared && !pageCompared ? NOT_COMPARED : undefined;
    return [
      listTable("Page views", pairByName(pages, priorPages, (row) => row.name, (row) => row.views), { compared: pageCompared, share: true, empty: "Not recorded. Page views are not split by page.", name: "Page", value: "Views", note }),
      listTable("Button clicks by page", dimensionRows(view, "page_clicks"), { compared, share: true, empty: "Not recorded. Button clicks are not split by page.", name: "Page", value: "Clicks", note: "From the recorded export." }),
      listTable("Engagement time per active user", pairByName(pages, priorPages, (row) => row.name, engagementPerUser), { compared: pageCompared, unit: "duration", empty: "Not recorded.", name: "Page", value: "Average time", note }),
      listTable("Exit rate", dimensionRows(view, "page_exit_rate"), { compared, unit: "percent", empty: "Not recorded. Exit rate is not split by page.", name: "Page", value: "Exit rate", note: "From the recorded export." }),
    ];
  }
  return null;
}

export function buildBreakdown(view: SiteView, kind: BreakdownKind, title: string, facts: LiveTrafficFacts | null = null, prior: PreviousDetailFacts | null = null): BreakdownReport {
  const current = view.current;
  return {
    title,
    period: current ? formatPeriod(current.start, current.end, " to ") : "Not recorded",
    comparison: view.previous ? formatPeriod(view.previous.start, view.previous.end, " to ") : null,
    tables: current ? (facts ? buildLive(view, kind, facts, prior) : null) ?? build(view, kind) : [{ title, columns: [], rows: [], empty: "Not recorded. Choose a period in Analytics, then open the report again." }],
  };
}

export function breakdownCsv(report: BreakdownReport, clinicCode: string | null, clientName: string): string {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const line = (values: string[]) => values.map(cell).join(",");
  const rows = [
    line(["Clinic code", clinicCode ?? ""]),
    line(["Report", report.title]),
    line(["Client", clientName]),
    line(["Reporting period", report.period]),
    line(["Comparison period", report.comparison ?? ""]),
  ];
  for (const table of report.tables) {
    rows.push("", line([table.title]), table.rows.length === 0 ? line([table.empty ?? "Not recorded"]) : line(table.columns));
    for (const row of table.rows) rows.push(line(row));
    if (table.note) rows.push(line([table.note]));
  }
  return `${rows.join("\n")}\n`;
}
