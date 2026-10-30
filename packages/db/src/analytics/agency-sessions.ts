import type { Queryable } from "../client";
import { addDays, daysBetween, formatDateTime } from "../services/dates";

const STALE_MS = { ga4: 12 * 60 * 60 * 1000, wix: 36 * 60 * 60 * 1000 } as const;

export type AgencyTrafficState = "available" | "partial" | "not_connected" | "not_synchronised" | "unavailable";

export interface AgencyTrafficNotice {
  id: string;
  kind: "not_connected" | "not_synchronised" | "disconnected" | "reconnect_required" | "stale" | "conflict" | "unavailable";
  message: string;
}

export interface AgencyTrafficWebsite {
  clientId: string;
  clientName: string;
  websiteId: string;
  websiteName: string;
  sessions: number;
}

export interface AgencySessionSummary {
  state: AgencyTrafficState;
  total: number | null;
  previous: number | null;
  series: Array<{ date: string; value: number }> | null;
  top: AgencyTrafficWebsite[];
  fetchedAt: Date | null;
  notices: AgencyTrafficNotice[];
  websiteCount: number;
  unconnectedCount: number;
}

interface SiteRow {
  website_id: string;
  website_name: string;
  client_id: string;
  client_name: string;
}

interface ConnectionRow {
  id: string;
  website_id: string;
  provider: "ga4" | "wix";
  status: string;
  disconnected_at: Date | null;
}

interface CoverageRow {
  connection_id: string;
  source_date: string;
  state: string;
  value_numeric: number | null;
  fetched_at: Date | null;
}

export async function agencySessionSummary(db: Queryable, input: {
  clientId?: string | null;
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  now?: Date;
}): Promise<AgencySessionSummary> {
  const clientId = input.clientId ?? null;
  const sites = await db.query<SiteRow>(
    `select w.id as website_id, w.name as website_name, w.client_id, c.name as client_name
     from websites w
     join clients c on c.id = w.client_id
     where c.status = 'active'
       and ($1::uuid is null or w.client_id = $1)
     order by c.name, w.name`,
    [clientId],
  );
  const connections = await db.query<ConnectionRow>(
    `select id, website_id, provider, status, disconnected_at
     from analytics_connections
     where provider in ('ga4', 'wix')
       and ($1::uuid is null or client_id = $1)`,
    [clientId],
  );
  const chosen = chooseConnections(sites.rows, connections.rows);
  const coverage = chosen.ids.length === 0
    ? []
    : (await db.query<CoverageRow>(
      `select distinct on (c.connection_id, c.source_date)
         c.connection_id, c.source_date::text as source_date, c.state, m.value_numeric, p.fetched_at
       from analytics_coverage c
       join analytics_connections conn on conn.id = c.connection_id
       join analytics_report_partitions p
         on p.connection_id = c.connection_id
        and p.template_key = c.template_key
        and p.published
        and c.source_date between p.start_date and p.end_date
       left join analytics_report_rows r
         on r.partition_id = p.id and r.dimension_key = c.source_date::text
       left join analytics_metric_values m
         on m.report_row_id = r.id
        and m.metric_key = case conn.provider when 'ga4' then 'sessions' else 'total_sessions' end
        and m.value_state = 'available'
       where c.connection_id = any($1::uuid[])
         and c.template_key = case conn.provider when 'ga4' then 'ga4.traffic_daily' else 'wix.data_daily' end
         and c.source_date between $2::date and $3::date
       order by c.connection_id, c.source_date, p.generation desc`,
      [chosen.ids, input.previousStart < input.start ? input.previousStart : input.start, input.end > input.previousEnd ? input.end : input.previousEnd],
    )).rows;
  return summarise({
    sites: sites.rows,
    connections: connections.rows,
    chosen: chosen.byWebsite,
    coverage,
    start: input.start,
    end: input.end,
    previousStart: input.previousStart,
    previousEnd: input.previousEnd,
    now: input.now ?? new Date(),
  });
}

function chooseConnections(sites: SiteRow[], connections: ConnectionRow[]): { ids: string[]; byWebsite: Map<string, ConnectionRow> } {
  const byWebsite = new Map<string, ConnectionRow>();
  const ids: string[] = [];
  for (const site of sites) {
    const rows = connections.filter((row) => row.website_id === site.website_id);
    const usable = rows.filter((row) => row.disconnected_at == null && row.status === "connected");
    if (usable.length === 1) {
      byWebsite.set(site.website_id, usable[0]!);
      ids.push(usable[0]!.id);
    }
  }
  return { ids, byWebsite };
}

function summarise(input: {
  sites: SiteRow[];
  connections: ConnectionRow[];
  chosen: Map<string, ConnectionRow>;
  coverage: CoverageRow[];
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  now: Date;
}): AgencySessionSummary {
  const byConnection = new Map<string, Map<string, CoverageRow>>();
  let fetchedAt: Date | null = null;
  for (const row of input.coverage) {
    const days = byConnection.get(row.connection_id) ?? new Map<string, CoverageRow>();
    days.set(row.source_date.slice(0, 10), row);
    byConnection.set(row.connection_id, days);
    const fetched = row.fetched_at ? new Date(row.fetched_at) : null;
    if (fetched && !Number.isNaN(fetched.getTime()) && (!fetchedAt || fetched > fetchedAt)) fetchedAt = fetched;
  }
  const currentDates = datesBetween(input.start, input.end);
  const previousDates = datesBetween(input.previousStart, input.previousEnd);
  const notices: AgencyTrafficNotice[] = [];
  const measured: Array<AgencyTrafficWebsite & { previous: number | null; series: Array<{ date: string; value: number }> | null; provider: "ga4" | "wix"; fetchedAt: Date | null }> = [];
  let incomplete = 0;
  let conflict = 0;
  let reconnect = 0;
  let disconnected = 0;
  let unconnected = 0;

  for (const site of input.sites) {
    const rows = input.connections.filter((row) => row.website_id === site.website_id);
    const usable = rows.filter((row) => row.disconnected_at == null && row.status === "connected");
    if (usable.length > 1) {
      conflict += 1;
      notices.push({ id: `conflict:${site.website_id}`, kind: "conflict", message: `${site.website_name} has two traffic connections. Sessions stay unavailable until one is disconnected.` });
      continue;
    }
    const chosen = input.chosen.get(site.website_id);
    if (!chosen) {
      if (rows.some((row) => row.disconnected_at == null && row.status === "reconnect_required")) {
        reconnect += 1;
        notices.push({ id: `reconnect:${site.website_id}`, kind: "reconnect_required", message: `${site.website_name} needs its analytics connection restored.` });
      } else if (rows.some((row) => row.disconnected_at != null || row.status === "disconnected")) {
        disconnected += 1;
        notices.push({ id: `disconnected:${site.website_id}`, kind: "disconnected", message: `${site.website_name} analytics is disconnected.` });
      } else {
        unconnected += 1;
      }
      continue;
    }
    const days = byConnection.get(chosen.id) ?? new Map<string, CoverageRow>();
    const current = periodTotal(days, currentDates);
    if (!current) {
      incomplete += 1;
      notices.push({ id: `sync:${site.website_id}`, kind: "not_synchronised", message: `${site.website_name} is not yet synchronised for this period.` });
      continue;
    }
    const previous = periodTotal(days, previousDates);
    const latest = latestFetch(days, currentDates);
    if (latest && input.now.getTime() - latest.getTime() > STALE_MS[chosen.provider]) {
      notices.push({
        id: `stale:${site.website_id}`,
        kind: "stale",
        message: `${site.website_name} was last synchronised ${formatDateTime(latest)}. The figures are older than the usual refresh.`,
      });
    }
    measured.push({
      clientId: site.client_id,
      clientName: site.client_name,
      websiteId: site.website_id,
      websiteName: site.website_name,
      sessions: current.total,
      previous: previous ? previous.total : null,
      series: current.series,
      provider: chosen.provider,
      fetchedAt: latest,
    });
  }

  if (input.sites.length > 0 && measured.length === 0 && incomplete === 0 && conflict === 0 && reconnect === 0 && disconnected === 0) {
    notices.push({ id: "analytics-not-connected", kind: "not_connected", message: "Website analytics is not connected." });
  }

  const total = measured.length === 0 ? null : measured.reduce((sum, site) => sum + site.sessions, 0);
  const previous = measured.length > 0 && measured.every((site) => site.previous !== null)
    ? measured.reduce((sum, site) => sum + (site.previous ?? 0), 0)
    : null;
  const series = measured.length > 0 && measured.every((site) => site.series)
    ? currentDates.map((date, index) => ({ date, value: measured.reduce((sum, site) => sum + (site.series?.[index]?.value ?? 0), 0) }))
    : null;
  const state: AgencyTrafficState = measured.length === 0 && incomplete > 0 && conflict === 0
    ? "not_synchronised"
    : measured.length === 0 && (conflict > 0 || reconnect > 0)
      ? "unavailable"
      : measured.length === 0
        ? "not_connected"
        : incomplete > 0 || conflict > 0
          ? "partial"
          : "available";
  const top = [...measured]
    .sort((a, b) => b.sessions - a.sessions || a.websiteName.localeCompare(b.websiteName))
    .slice(0, 3)
    .map(({ clientId, clientName, websiteId, websiteName, sessions }) => ({ clientId, clientName, websiteId, websiteName, sessions }));
  return { state, total, previous, series, top, fetchedAt, notices, websiteCount: input.sites.length, unconnectedCount: unconnected };
}

function periodTotal(days: Map<string, CoverageRow>, dates: string[]): { total: number; series: Array<{ date: string; value: number }> } | null {
  if (dates.length === 0) return null;
  const series: Array<{ date: string; value: number }> = [];
  for (const date of dates) {
    const row = days.get(date);
    if (!row || row.state !== "complete" || row.value_numeric === null || row.value_numeric === undefined) return null;
    series.push({ date, value: Number(row.value_numeric) });
  }
  return { total: series.reduce((sum, point) => sum + point.value, 0), series };
}

function latestFetch(days: Map<string, CoverageRow>, dates: string[]): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    const fetched = days.get(date)?.fetched_at;
    if (!fetched) continue;
    const value = new Date(fetched);
    if (!Number.isNaN(value.getTime()) && (!latest || value > latest)) latest = value;
  }
  return latest;
}

function datesBetween(start: string, end: string): string[] {
  if (!start || !end || start > end) return [];
  const count = daysBetween(start, end) + 1;
  const dates: string[] = [];
  for (let index = 0; index < count; index += 1) dates.push(addDays(start, index));
  return dates;
}
