export const GSC_TIME_ZONE = "America/Los_Angeles";
export const GSC_ROW_LIMIT = 25000;
export const GSC_EXPOSED_ROWS_PER_DAY = 50000;

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export function gscQueryBody(input: { start: string; end: string; dimensions: string[]; startRow?: number }): unknown {
  return {
    startDate: input.start,
    endDate: input.end,
    dimensions: input.dimensions,
    type: "web",
    rowLimit: GSC_ROW_LIMIT,
    startRow: input.startRow ?? 0,
    dataState: "final",
  };
}

export function parseGscQuery(body: unknown): { rows: GscRow[]; responseAggregation?: string } {
  const record = body as { rows?: GscRow[]; responseAggregationType?: string };
  return {
    rows: (record.rows ?? []).map((row) => ({
      keys: row.keys ?? [],
      clicks: Number(row.clicks ?? 0),
      impressions: Number(row.impressions ?? 0),
      ctr: Number(row.ctr ?? 0),
      position: Number(row.position ?? 0),
    })),
    responseAggregation: record.responseAggregationType,
  };
}

export function gscHasAnotherPage(rowCount: number): boolean {
  return rowCount === GSC_ROW_LIMIT;
}

export function parseGscSites(body: unknown): Array<{ id: string; label: string }> {
  const record = body && typeof body === "object" ? body as { siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> } : {};
  return (record.siteEntry ?? [])
    .filter((site) => site.siteUrl && site.permissionLevel !== "siteUnverifiedUser")
    .map((site) => ({ id: site.siteUrl!, label: site.siteUrl! }));
}

export function encodeSiteUrl(siteUrl: string): string {
  return encodeURIComponent(siteUrl);
}

export interface InspectionReading {
  live: "not_checked" | "indexable" | "blocked";
  google: "indexed" | "not_indexed" | "unknown";
  coverage: string | null;
}

/** A public page URL on the website origin. Paths stay on that origin. */
export function publicPageUrl(websiteUrl: string, pagePath: string): string | null {
  let base: URL;
  try {
    base = new URL(websiteUrl);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;
  const path = normalizeIndexPath(pagePath);
  if (!path) return null;
  const url = new URL(path, `${base.origin}/`);
  if (url.origin !== base.origin) return null;
  return url.toString();
}

export function normalizeIndexPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return null;
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.startsWith("//") || withSlash.includes("..") || withSlash.includes("\\") || withSlash.includes("?") || withSlash.includes("#") || /\s/.test(withSlash)) return null;
  if (withSlash.length > 1 && withSlash.endsWith("/")) return withSlash.slice(0, -1);
  return withSlash;
}

export function parseInspection(body: unknown): InspectionReading {
  const result = asRecord(asRecord(asRecord(body).inspectionResult).indexStatusResult);
  const verdict = String(result.verdict ?? "");
  const indexingState = String(result.indexingState ?? "");
  const coverage = safeCoverage(result.coverageState);
  const coverageLower = (coverage ?? "").toLowerCase();
  const blocked = indexingState.startsWith("BLOCKED") || verdict === "FAIL";
  const allowed = indexingState === "INDEXING_ALLOWED";
  const indexed = verdict === "PASS" && coverageLower.includes("indexed") && !coverageLower.includes("not indexed");
  const notIndexed = !indexed && (verdict === "FAIL" || verdict === "NEUTRAL" || verdict === "PARTIAL" || coverageLower.includes("not indexed") || coverageLower.includes("unknown to google"));
  return {
    live: blocked ? "blocked" : allowed ? "indexable" : "not_checked",
    google: indexed ? "indexed" : notIndexed ? "not_indexed" : "unknown",
    coverage,
  };
}

function safeCoverage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, 120);
  return /^[\w .,'’\-–—/()]{1,120}$/.test(text) ? text : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
