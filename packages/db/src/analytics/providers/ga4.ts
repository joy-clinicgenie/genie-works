export interface Ga4ReportRow {
  dimensions: Record<string, string>;
  metrics: Record<string, number>;
}

export interface Ga4Report {
  rows: Ga4ReportRow[];
  quota?: { tokens?: number };
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
    keepEmptyRows: false,
  };
}

export function parseGa4Report(body: unknown): Ga4Report {
  const record = asRecord(body);
  const headers = asArray(record.dimensionHeaders).map((item) => String(asRecord(item).name ?? ""));
  const metricHeaders = asArray(record.metricHeaders).map((item) => String(asRecord(item).name ?? ""));
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
      if (name) metrics[name] = Number(asRecord(value).value ?? 0);
    });
    return { dimensions, metrics };
  });
  const quota = asRecord(record.propertyQuota);
  const tokens = asRecord(quota.tokensPerDay);
  return { rows, quota: tokens.consumed === undefined ? undefined : { tokens: Number(tokens.consumed) } };
}

export const GA4_TEMPLATES: Record<string, { metrics: string[]; dimensions: string[] }> = {
  "ga4.traffic_daily": { metrics: ["sessions"], dimensions: ["date"] },
  "ga4.traffic_range": { metrics: ["sessions", "totalUsers"], dimensions: [] },
  "ga4.acquisition": { metrics: ["sessions"], dimensions: ["sessionDefaultChannelGroup"] },
  "ga4.landing": { metrics: ["sessions"], dimensions: ["landingPage"] },
  "ga4.device": { metrics: ["sessions"], dimensions: ["deviceCategory"] },
  "ga4.country": { metrics: ["sessions"], dimensions: ["country"] },
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
