import { analyticsSearch, type PeriodRangeId } from "@/lib/period-options";

export const BREAKDOWN_REPORTS = [
  { id: "trends", title: "Traffic trends", section: "traffic" },
  { id: "sources", title: "Sources", section: "traffic" },
  { id: "visitors", title: "New and returning visitors", section: "traffic" },
  { id: "devices", title: "Devices", section: "traffic" },
  { id: "pages", title: "Page performance", section: "behavior" },
  { id: "clicks", title: "Button clicks", section: "behavior" },
  { id: "paths", title: "Navigation paths", section: "behavior" },
  { id: "forms", title: "Form funnel", section: "behavior" },
] as const;

export type BreakdownKind = (typeof BREAKDOWN_REPORTS)[number]["id"];
export type BreakdownLinks = Record<BreakdownKind, string>;

export function breakdownKind(value: string): BreakdownKind | null {
  return BREAKDOWN_REPORTS.some((report) => report.id === value) ? value as BreakdownKind : null;
}

export function breakdownTitle(kind: BreakdownKind): string {
  return BREAKDOWN_REPORTS.find((report) => report.id === kind)!.title;
}

export function breakdownSection(kind: BreakdownKind): "traffic" | "behavior" {
  return BREAKDOWN_REPORTS.find((report) => report.id === kind)!.section;
}

/** Each analytics card opens the report of that breakdown, for the clinic and period already on screen. */
export function breakdownLinks(clientId: string, range: PeriodRangeId, from?: string, to?: string, websiteId?: string): BreakdownLinks {
  const search = analyticsSearch(clientId, range, from, to, websiteId);
  return Object.fromEntries(BREAKDOWN_REPORTS.map((report) => [report.id, `/reports/breakdown/${report.id}?${search}`])) as BreakdownLinks;
}
