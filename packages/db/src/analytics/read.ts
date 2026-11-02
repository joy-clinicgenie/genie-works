import type { Queryable } from "../client";
import { csvLine, weekdayAverages, type DatedCount } from "./measure";

export interface ReportMetric {
  key: string;
  value: number | null;
  state: string;
}

export interface ReportRow {
  dimensionKey: string;
  dimensions: Record<string, string>;
  metrics: ReportMetric[];
}

export interface PublishedReport {
  id: string;
  templateKey: string;
  start: string;
  end: string;
  timezone: string;
  provenance: string;
  completeness: string;
  generation: number;
  fetchedAt: Date;
  measuredThrough: string | null;
  rows: ReportRow[];
}

export async function publishedReport(db: Queryable, input: {
  clientId: string;
  websiteId: string;
  templateKey: string;
  start: string;
  end: string;
}): Promise<PublishedReport | null> {
  const { rows } = await db.query<{
    id: string;
    template_key: string;
    start_date: string;
    end_date: string;
    source_timezone: string;
    provenance: string;
    completeness: string;
    generation: number;
    fetched_at: Date;
    measured_through: string | null;
  }>(
    `select id, template_key, start_date::text, end_date::text, source_timezone, provenance, completeness, generation, fetched_at, measured_through::text
     from analytics_report_partitions
     where client_id = $1 and website_id = $2 and template_key = $3 and start_date = $4 and end_date = $5 and published
     order by generation desc limit 1`,
    [input.clientId, input.websiteId, input.templateKey, input.start, input.end],
  );
  const partition = rows[0];
  if (!partition) return null;
  const body = await db.query<{ dimension_key: string; dimensions: Record<string, string>; metric_key: string; value_numeric: number | null; value_state: string }>(
    `select r.dimension_key, r.dimensions, m.metric_key, m.value_numeric, m.value_state
     from analytics_report_rows r
     join analytics_metric_values m on m.report_row_id = r.id
     where r.partition_id = $1
     order by r.dimension_key, m.metric_key`,
    [partition.id],
  );
  const grouped = new Map<string, ReportRow>();
  for (const row of body.rows) {
    const current = grouped.get(row.dimension_key) ?? { dimensionKey: row.dimension_key, dimensions: row.dimensions, metrics: [] };
    current.metrics.push({ key: row.metric_key, value: row.value_numeric, state: row.value_state });
    grouped.set(row.dimension_key, current);
  }
  return {
    id: partition.id,
    templateKey: partition.template_key,
    start: partition.start_date,
    end: partition.end_date,
    timezone: partition.source_timezone,
    provenance: partition.provenance,
    completeness: partition.completeness,
    generation: partition.generation,
    fetchedAt: partition.fetched_at,
    measuredThrough: partition.measured_through,
    rows: [...grouped.values()],
  };
}

export async function dailySessionsForWeekday(db: Queryable, input: { clientId: string; websiteId: string; templateKey: string; start: string; end: string }): Promise<ReturnType<typeof weekdayAverages>> {
  const { rows } = await db.query<{ source_date: string; state: DatedCount["coverage"]; value_numeric: number | null }>(
    `select c.source_date::text, c.state, m.value_numeric
     from analytics_coverage c
     join analytics_report_partitions p on p.connection_id = c.connection_id and p.template_key = c.template_key and p.published
       and c.source_date between p.start_date and p.end_date
     left join analytics_report_rows r on r.partition_id = p.id and r.dimension_key = c.source_date::text
     left join analytics_metric_values m on m.report_row_id = r.id and m.metric_key = 'sessions'
     where c.client_id = $1 and c.website_id = $2 and c.template_key = $3 and c.source_date between $4 and $5`,
    [input.clientId, input.websiteId, input.templateKey, input.start, input.end],
  );
  return weekdayAverages(rows.map((row) => ({ date: row.source_date, sessions: row.state === "complete" ? row.value_numeric : null, coverage: row.state })));
}

export function reportCsv(report: PublishedReport, title: string): string {
  const lines = [
    csvLine([`# ${title}`]),
    csvLine([`# source ${report.provenance}`, report.timezone, report.start, report.end, `generation ${report.generation}`]),
    csvLine(["dimension", "metric", "value", "state"]),
  ];
  for (const row of report.rows) {
    for (const metric of row.metrics) {
      lines.push(csvLine([row.dimensionKey, metric.key, metric.value === null ? "" : String(metric.value), metric.state]));
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Complete days only. A missing or incomplete day stays null and is not filled in. */
export async function dailySessionSeries(db: Queryable, input: {
  clientId: string;
  websiteId: string;
  templateKey: string;
  metric: string;
  start: string;
  end: string;
}): Promise<Array<{ date: string; value: number | null }>> {
  return (await dailySessionSeriesWithPeriod(db, input)).series;
}

/** Reads chart points and the complete-period total from the same daily rows. */
export async function dailySessionSeriesWithPeriod(db: Queryable, input: {
  clientId: string;
  websiteId: string;
  templateKey: string;
  metric: string;
  start: string;
  end: string;
}): Promise<{
  series: Array<{ date: string; value: number | null }>;
  period: { value: number | null; state: "available" | "unavailable"; covered: number; expected: number };
}> {
  const { daysBetween } = await import("../services/dates");
  const { rows } = await db.query<{ source_date: string; state: string; value_numeric: number | null; value_state: string | null }>(
    `select distinct on (c.source_date) c.source_date::text, c.state, m.value_numeric, m.value_state
     from analytics_coverage c
     join analytics_report_partitions p on p.connection_id = c.connection_id and p.template_key = c.template_key and p.published
       and c.source_date between p.start_date and p.end_date
     left join analytics_report_rows r on r.partition_id = p.id and r.dimension_key = c.source_date::text
     left join analytics_metric_values m on m.report_row_id = r.id and m.metric_key = $4
     where c.client_id = $1 and c.website_id = $2 and c.template_key = $3 and c.source_date between $5 and $6
     order by c.source_date, p.generation desc`,
    [input.clientId, input.websiteId, input.templateKey, input.metric, input.start, input.end],
  );
  const series = rows.map((row) => ({
    date: row.source_date,
    value: row.state === "complete" && row.value_state === "available" && row.value_numeric !== null ? Number(row.value_numeric) : null,
  }));
  const expected = daysBetween(input.start, input.end) + 1;
  const complete = rows.filter((row) => row.state === "complete" && row.value_numeric !== null);
  const period = complete.length === expected
    ? { value: complete.reduce((sum, row) => sum + Number(row.value_numeric), 0), state: "available" as const, covered: expected, expected }
    : { value: null, state: "unavailable" as const, covered: complete.length, expected };
  return { series, period };
}

export async function additivePeriod(db: Queryable, input: {
  clientId: string;
  websiteId: string;
  templateKey: string;
  metric: string;
  start: string;
  end: string;
}): Promise<{ value: number | null; state: "available" | "unavailable"; covered: number; expected: number }> {
  const { daysBetween } = await import("../services/dates");
  const expected = daysBetween(input.start, input.end) + 1;
  const { rows } = await db.query<{ source_date: string; state: string; value_numeric: number | null }>(
    `select distinct on (c.source_date) c.source_date::text, c.state, m.value_numeric
     from analytics_coverage c
     join analytics_report_partitions p on p.connection_id = c.connection_id and p.template_key = c.template_key and p.published
       and c.source_date between p.start_date and p.end_date
     left join analytics_report_rows r on r.partition_id = p.id and r.dimension_key = c.source_date::text
     left join analytics_metric_values m on m.report_row_id = r.id and m.metric_key = $4 and m.value_state = 'available'
     where c.client_id = $1 and c.website_id = $2 and c.template_key = $3 and c.source_date between $5 and $6
     order by c.source_date, p.generation desc`,
    [input.clientId, input.websiteId, input.templateKey, input.metric, input.start, input.end],
  );
  const complete = rows.filter((row) => row.state === "complete" && row.value_numeric !== null);
  if (complete.length !== expected) return { value: null, state: "unavailable", covered: complete.length, expected };
  return { value: complete.reduce((sum, row) => sum + Number(row.value_numeric), 0), state: "available", covered: expected, expected };
}

export async function recordImport(db: Queryable, input: {
  clientId: string;
  websiteId: string;
  reportType: string;
  timezone: string;
  text: string;
  actorUserId: string;
  replace: boolean;
}): Promise<{ decision: "replay" | "overlap" | "accept" | "reject"; error?: string; rows?: number }> {
  const { sha256 } = await import("../services/references");
  const { classifyImport, parseMetricCsv } = await import("./measure");
  const parsed = parseMetricCsv(input.text);
  if ("error" in parsed) return { decision: "reject", error: parsed.error };
  if (parsed.rows.length === 0) return { decision: "reject", error: "The file has no rows." };
  const dates = parsed.rows.map((row) => row.date).sort();
  const start = dates[0]!;
  const end = dates[dates.length - 1]!;
  const checksum = sha256(input.text);
  const existing = await db.query<{ checksum: string; start: string; end: string; provenance: string }>(
    `select '' as checksum, start_date::text as start, end_date::text as end, provenance
     from analytics_report_partitions where website_id = $1 and published
     union all
     select file_checksum, date_start::text, date_end::text, 'import'
     from analytics_imports where website_id = $1 and state = 'accepted'`,
    [input.websiteId],
  );
  const decision = classifyImport({ checksum, start, end, existing: existing.rows, replace: input.replace });
  if (decision === "replay") return { decision, rows: parsed.rows.length };
  const state = decision === "accept" || decision === "overlap" ? "accepted" : "rejected";
  if (decision === "reject" || (decision === "overlap" && !input.replace)) {
    await db.query(
      `insert into analytics_imports (client_id, website_id, file_checksum, report_type, source_timezone, date_start, date_end, row_count, state, created_by, provenance_ref)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'rejected', $9, 'csv')`,
      [input.clientId, input.websiteId, checksum, input.reportType, input.timezone, start, end, parsed.rows.length, input.actorUserId],
    );
    return { decision: "reject", error: "This file overlaps a provider partition and was not imported.", rows: parsed.rows.length };
  }
  await db.query(
    `insert into analytics_imports (client_id, website_id, file_checksum, report_type, source_timezone, date_start, date_end, row_count, state, created_by, provenance_ref)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'csv')`,
    [input.clientId, input.websiteId, checksum, input.reportType, input.timezone, start, end, parsed.rows.length, state, input.actorUserId],
  );
  return { decision, rows: parsed.rows.length };
}
