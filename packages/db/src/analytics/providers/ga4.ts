export interface Ga4ReportRow {
  dimensions: Record<string, string>;
  metrics: Record<string, number>;
}

/**
 * What GA4 says about the report itself (RunReportResponse.metadata, verified against Google's reference
 * on 13 Nov 2026). None of it changes a number; it says how far to trust the numbers.
 */
export interface Ga4ReportMeta {
  /** The property's current time zone. Dates in the report follow the property, not our setting. */
  timeZone?: string;
  /** Some dimension combinations were rolled into an "(other)" row (high-cardinality report). */
  dataLossFromOtherRow?: boolean;
  /** Only data that meets minimum aggregation thresholds was returned. */
  subjectToThresholding?: boolean;
  /** Share of events used when the report was sampled, 0 to 1. Absent when not sampled. */
  sampledShare?: number;
  emptyReason?: string;
}

export interface Ga4Report {
  rows: Ga4ReportRow[];
  quota?: { tokens?: number };
  /** Total rows in the result, independent of limit and offset. */
  rowCount?: number;
  meta: Ga4ReportMeta;
  /** Metric values that were not finite numbers. They are left out, so the metric reads as unavailable. */
  invalidValues: number;
}

export function ga4ReportBody(input: {
  start: string;
  end: string;
  metrics: string[];
  dimensions?: string[];
  limit?: number;
  offset?: number;
}): unknown {
  return {
    dateRanges: [{ startDate: input.start, endDate: input.end }],
    metrics: input.metrics.map((name) => ({ name })),
    dimensions: (input.dimensions ?? []).map((name) => ({ name })),
    limit: input.limit ?? 10000,
    offset: input.offset ?? 0,
    // Asks GA4 to report how much of the property's quota this request used (Phase 2.3).
    returnPropertyQuota: true,
    // GA4 returns a recorded zero-visit day only when asked. A day it never recorded is still
    // absent and stays unavailable; it is not filled in (D52).
    keepEmptyRows: (input.dimensions ?? []).includes("date"),
  };
}

export function parseGa4Report(body: unknown): Ga4Report {
  const record = asRecord(body);
  const headers = asArray(record.dimensionHeaders).map((item) => String(asRecord(item).name ?? ""));
  const metricHeaders = asArray(record.metricHeaders).map((item) => String(asRecord(item).name ?? ""));
  let invalidValues = 0;
  const rows = asArray(record.rows).map((item) => {
    const row = asRecord(item);
    const dimensions: Record<string, string> = {};
    asArray(row.dimensionValues).forEach((value, index) => {
      const name = headers[index];
      if (name) dimensions[name] = String(asRecord(value).value ?? "");
    });
    const metrics: Record<string, number> = {};
    asArray(row.metricValues).forEach((value, index) => {
      const name = metricHeaders[index];
      if (!name) return;
      const raw = asRecord(value).value;
      const parsed = raw === undefined || raw === null || raw === "" ? 0 : Number(raw);
      // A value that is not a number must not be stored as one: Postgres accepts NaN as "at least zero".
      if (Number.isFinite(parsed)) metrics[name] = parsed;
      else invalidValues += 1;
    });
    return { dimensions, metrics };
  });
  const quota = asRecord(record.propertyQuota);
  const tokens = asRecord(quota.tokensPerDay);
  const meta = asRecord(record.metadata);
  const sampling = asArray(meta.samplingMetadatas).map(asRecord)[0];
  const read = Number(sampling?.samplesReadCount);
  const space = Number(sampling?.samplingSpaceSize);
  const rowCount = Number(record.rowCount);
  return {
    rows,
    quota: tokens.consumed === undefined ? undefined : { tokens: Number(tokens.consumed) },
    rowCount: record.rowCount !== undefined && Number.isFinite(rowCount) ? rowCount : undefined,
    meta: {
      timeZone: typeof meta.timeZone === "string" ? meta.timeZone : undefined,
      dataLossFromOtherRow: meta.dataLossFromOtherRow === true ? true : undefined,
      subjectToThresholding: meta.subjectToThresholding === true ? true : undefined,
      sampledShare: sampling && Number.isFinite(read) && Number.isFinite(space) && space > 0 ? read / space : undefined,
      emptyReason: typeof meta.emptyReason === "string" ? meta.emptyReason : undefined,
    },
    invalidValues,
  };
}

export const GA4_TEMPLATES: Record<string, { metrics: string[]; dimensions: string[] }> = {
  "ga4.traffic_daily": { metrics: ["sessions"], dimensions: ["date"] },
  "ga4.traffic_range": { metrics: ["sessions", "totalUsers"], dimensions: [] },
  "ga4.acquisition": { metrics: ["sessions"], dimensions: ["sessionDefaultChannelGroup"] },
  "ga4.landing": { metrics: ["sessions"], dimensions: ["landingPage"] },
  "ga4.device": { metrics: ["sessions"], dimensions: ["deviceCategory"] },
  "ga4.country": { metrics: ["sessions"], dimensions: ["country"] },
  // Behaviour (D53). GA4 returns the two rates as fractions; the board shows them as percentages.
  "ga4.engagement": { metrics: ["engagementRate", "averageSessionDuration", "screenPageViewsPerSession", "bounceRate"], dimensions: [] },
  "ga4.pages": { metrics: ["screenPageViews", "userEngagementDuration", "activeUsers"], dimensions: ["pagePath"] },
  "ga4.visitor_type": { metrics: ["activeUsers"], dimensions: ["newVsReturning"] },
  // AI referral sessions (D63). Prepared on demand for one preset window; not part of the scheduled run.
  "ga4.session_source": { metrics: ["sessions"], dimensions: ["sessionSource"] },
  // Phase 2.1 bundles: sessions by day and one dimension, fetched once and summed into the exact
  // windows the report templates above are read by. Sessions add across days; users do not.
  "ga4.bundle.channel": { metrics: ["sessions"], dimensions: ["date", "sessionDefaultChannelGroup"] },
  "ga4.bundle.landing": { metrics: ["sessions"], dimensions: ["date", "landingPage"] },
  "ga4.bundle.device": { metrics: ["sessions"], dimensions: ["date", "deviceCategory"] },
  "ga4.bundle.country": { metrics: ["sessions"], dimensions: ["date", "country"] },
};

export function ga4Template(template: string): { metrics: string[]; dimensions: string[] } {
  const spec = GA4_TEMPLATES[template];
  if (!spec) throw new Error("unsupported");
  return spec;
}

/** A stored discovery must already name every requested field. An empty discovery is unknown, not a pass. */
export function checkCompatibility(
  requested: { metrics: string[]; dimensions: string[] },
  known: { metrics: string[]; dimensions: string[]; status: string } | null,
): "unknown" | "supported" | "unsupported" {
  if (!known) return "unknown";
  if (known.status === "unsupported") return "unsupported";
  const metricsOk = requested.metrics.every((metric) => known.metrics.includes(metric));
  const dimensionsOk = requested.dimensions.every((dimension) => known.dimensions.includes(dimension));
  return metricsOk && dimensionsOk ? "supported" : "unsupported";
}

export function parseGa4AccountSummaries(body: unknown): Array<{ id: string; label: string }> {
  const properties: Array<{ id: string; label: string }> = [];
  for (const account of asArray(asRecord(body).accountSummaries)) {
    const accountName = String(asRecord(account).displayName ?? "Account");
    for (const property of asArray(asRecord(account).propertySummaries)) {
      const record = asRecord(property);
      const raw = String(record.property ?? "");
      const id = raw.replace(/^properties\//, "");
      if (!/^\d{4,12}$/.test(id)) continue;
      properties.push({ id, label: `${accountName} · ${String(record.displayName ?? id)}` });
    }
  }
  return properties;
}

export function ga4PropertyPath(propertyId: string): string {
  if (!/^\d{4,12}$/.test(propertyId)) throw new Error("GA4 property id is not a numeric property.");
  return `properties/${propertyId}`;
}

export function isInvalidGrant(body: unknown): boolean {
  const record = asRecord(body);
  const nested = asRecord(record.error);
  return record.error === "invalid_grant" || (nested.status === "UNAUTHENTICATED" && String(nested.message ?? "").toLowerCase().includes("invalid"));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
