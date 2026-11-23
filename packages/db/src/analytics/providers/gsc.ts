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

export function parseGscQuery(body: unknown): { rows: GscRow[]; responseAggregation?: string; invalidRows: number } {
  const record = body as { rows?: GscRow[]; responseAggregationType?: string };
  let invalidRows = 0;
  const rows: GscRow[] = [];
  for (const row of record.rows ?? []) {
    const parsed = {
      keys: row.keys ?? [],
      clicks: Number(row.clicks ?? 0),
      impressions: Number(row.impressions ?? 0),
      ctr: Number(row.ctr ?? 0),
      position: Number(row.position ?? 0),
    };
    // A row with a value that is not a number is dropped and counted, never stored as NaN.
    if ([parsed.clicks, parsed.impressions, parsed.ctr, parsed.position].every(Number.isFinite)) rows.push(parsed);
    else invalidRows += 1;
  }
  return { rows, responseAggregation: record.responseAggregationType, invalidRows };
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

/**
 * Whether a page URL is inside a Search Console property, by Google's documented rules (D61).
 * Domain property `sc-domain:example.com`: the domain and every subdomain, over http or https.
 * URL-prefix property `https://www.example.com/path/`: URLs that start with that exact prefix, so the
 * protocol, host and port must match and the path must begin with the property path.
 */
export function propertyCovers(property: string, pageUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  const value = property.trim();
  if (value.toLowerCase().startsWith("sc-domain:")) {
    const domain = value.slice("sc-domain:".length).trim().toLowerCase().replace(/\.$/, "");
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return host === domain || host.endsWith(`.${domain}`);
  }
  // Google requires a URL-prefix property to end with "/"; the URL parser would add one silently.
  if (!value.endsWith("/")) return false;
  let prefix: URL;
  try {
    prefix = new URL(value);
  } catch {
    return false;
  }
  if (prefix.protocol !== "https:" && prefix.protocol !== "http:") return false;
  if (!prefix.pathname.endsWith("/")) return false;
  if (url.protocol !== prefix.protocol || url.host.toLowerCase() !== prefix.host.toLowerCase()) return false;
  return `${url.pathname}${url.search}`.startsWith(prefix.pathname);
}

const INSPECTION_VERDICTS = new Set(["VERDICT_UNSPECIFIED", "PASS", "PARTIAL", "FAIL", "NEUTRAL"]);

export interface InspectionDetail {
  verdict: "VERDICT_UNSPECIFIED" | "PASS" | "PARTIAL" | "FAIL" | "NEUTRAL" | null;
  coverage: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  robotsTxtState: string | null;
  lastCrawlTime: Date | null;
  googleCanonical: string | null;
}

function enumValue(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

/** The stored fields of Google's indexStatusResult. Unknown or unsafe values become null. */
export function parseInspectionDetail(body: unknown): InspectionDetail {
  const result = asRecord(asRecord(asRecord(body).inspectionResult).indexStatusResult);
  const verdict = typeof result.verdict === "string" && INSPECTION_VERDICTS.has(result.verdict) ? result.verdict as InspectionDetail["verdict"] : null;
  const crawl = typeof result.lastCrawlTime === "string" ? new Date(result.lastCrawlTime) : null;
  const canonical = typeof result.googleCanonical === "string" && /^https?:\/\//.test(result.googleCanonical) ? result.googleCanonical.slice(0, 2000) : null;
  return {
    verdict,
    coverage: safeCoverage(result.coverageState),
    indexingState: enumValue(result.indexingState, /^[A-Z_]{1,60}$/),
    pageFetchState: enumValue(result.pageFetchState, /^[A-Z_0-9]{1,60}$/),
    robotsTxtState: enumValue(result.robotsTxtState, /^[A-Z_]{1,60}$/),
    lastCrawlTime: crawl && !Number.isNaN(crawl.getTime()) ? crawl : null,
    googleCanonical: canonical,
  };
}
