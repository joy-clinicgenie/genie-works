import { addDays } from "../../services/dates";

/** Documented history of Get Analytics Data. This limit is not applied to the Semantic Model. */
export const WIX_DATA_HISTORY_DAYS = 62;

export const WIX_DATA_MEASURES = ["TOTAL_SESSIONS", "TOTAL_UNIQUE_VISITORS", "CLICKS_TO_CONTACT", "TOTAL_FORMS_SUBMITTED"] as const;

/** Inclusive window of every day this endpoint can still return. Stored days are kept after they age out of it. */
export function wixDueWindow(today: string): { start: string; end: string } {
  return { start: addDays(today, -(WIX_DATA_HISTORY_DAYS - 1)), end: today };
}

export function wixDataWindow(today: string, start: string, end: string): { start: string; end: string; clipped: boolean } | { error: "outside_history" } {
  const oldest = addDays(today, -(WIX_DATA_HISTORY_DAYS - 1));
  if (end < oldest) return { error: "outside_history" };
  const clippedStart = start < oldest ? oldest : start;
  return { start: clippedStart, end, clipped: clippedStart !== start };
}

/** start is inclusive. end is inclusive here and is sent as the following day because the Data API end is exclusive. */
export function wixDataUrl(start: string, inclusiveEnd: string): string {
  const params = new URLSearchParams();
  params.set("dateRange.startDate", start);
  params.set("dateRange.endDate", addDays(inclusiveEnd, 1));
  for (const measure of WIX_DATA_MEASURES) params.append("measurementTypes", measure);
  return `https://www.wixapis.com/analytics/v2/site-analytics/data?${params.toString()}`;
}

export interface WixDailyPoint {
  measure: string;
  date: string;
  value: number;
}

/** The Data API end date is exclusive. A requested end of 3 January returns 1 and 2 January. */
export function parseWixData(body: unknown): WixDailyPoint[] {
  const data = Array.isArray((body as { data?: unknown })?.data) ? (body as { data: unknown[] }).data : [];
  const points: WixDailyPoint[] = [];
  for (const item of data) {
    const row = item as { type?: string; values?: Array<{ date?: string; value?: number }> };
    for (const value of row.values ?? []) {
      if (row.type && value.date) points.push({ measure: row.type, date: value.date, value: Number(value.value ?? 0) });
    }
  }
  return points;
}

export interface WixModelField {
  name: string;
  kind: "measure" | "dimension";
  dependencies: string[];
}

export function parseSemanticModel(body: unknown): { id: string; slug: string; fields: WixModelField[] } | null {
  const model = (body as { semanticModel?: { id?: string; slug?: string; measures?: unknown[]; dimensions?: unknown[] } }).semanticModel;
  if (!model?.id) return null;
  const fields = (list: unknown[] | undefined, kind: WixModelField["kind"]) =>
    (list ?? []).flatMap((item) => {
      const field = item as { name?: string; dependencies?: Array<{ name?: string }> };
      if (!field.name) return [];
      return [{ name: field.name, kind, dependencies: (field.dependencies ?? []).flatMap((dep) => (dep.name ? [dep.name] : [])) }];
    });
  return { id: model.id, slug: model.slug ?? "", fields: [...fields(model.measures, "measure"), ...fields(model.dimensions, "dimension")] };
}

export function semanticQueryBody(modelId: string, start: string, end: string, fields: string[], offset = 0): unknown {
  return {
    semanticModelId: modelId,
    interval: { startDate: start, endDate: end },
    fields,
    paging: { limit: 1000, offset },
  };
}
