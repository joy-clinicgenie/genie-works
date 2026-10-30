import { addIsoDays, analyticsSearch, todayIso, type PeriodRangeId } from "@/lib/period-options";

export const DASHBOARD_RANGES = [
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "last90", label: "Last 90 days" },
  { id: "month", label: "This month" },
] as const;

export type DashboardRangeId = (typeof DASHBOARD_RANGES)[number]["id"];

export function dashboardRangeId(value: string | undefined): DashboardRangeId {
  return DASHBOARD_RANGES.some((item) => item.id === value) ? value as DashboardRangeId : "last30";
}

export function dashboardRangeLabel(id: string): string {
  return DASHBOARD_RANGES.find((item) => item.id === id)?.label ?? "Last 30 days";
}

export function enquiryDashboardHref(input: { status?: "new" | "acknowledged" | "closed"; from: string; to: string; clinic?: string | null }): string {
  const params = new URLSearchParams({ from: input.from, to: input.to });
  if (input.status) params.set("status", input.status);
  if (input.clinic) params.set("clinic", input.clinic);
  return `/enquiries?${params.toString()}`;
}

/** The notifications page defaults to this month. A wide window keeps older failures that the dashboard still counts. */
export function notificationFailureHref(clinic?: string | null, today = todayIso()): string {
  const params = new URLSearchParams({
    notification: "failed",
    from: addIsoDays(today, -730),
    to: today,
  });
  if (clinic) params.set("clinic", clinic);
  return `/enquiries/notifications?${params.toString()}`;
}

export function sessionComparison(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null) return null;
  if (previous === 0 && current === 0) return "No change from the previous period";
  if (previous === 0 && current > 0) return "New activity in this period";
  const value = Number((((current - previous) / previous) * 100).toFixed(1));
  if (value === 0) return "No change from the previous period";
  const amount = Math.abs(value);
  const shown = Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
  return `${shown}% ${value > 0 ? "higher" : "lower"} than the previous period`;
}

export function analyticsDashboardHref(range: PeriodRangeId | string, clientId?: string | null, websiteId?: string | null): string {
  if (!clientId) return `/analytics?range=${encodeURIComponent(range)}`;
  return `/analytics?${analyticsSearch(clientId, range, undefined, undefined, websiteId || undefined)}`;
}

export function reportsLibraryHref(clientId?: string | null): string {
  return clientId ? `/reports?client=${encodeURIComponent(clientId)}` : "/reports";
}
