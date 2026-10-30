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
