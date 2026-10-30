export const PERIOD_RANGES = [
  { id: "custom", label: "Custom" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 days" },
  { id: "last14", label: "Last 14 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "last90", label: "Last 90 days" },
  { id: "last365", label: "Last 365 days" },
  { id: "month", label: "This month" },
] as const;

export type PeriodRangeId = (typeof PERIOD_RANGES)[number]["id"] | "week" | "last12";

const RANGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(PERIOD_RANGES.map((item) => [item.id, item.label])),
  week: "This week",
  last12: "Last 365 days",
};

export function periodLabel(id: string): string {
  return RANGE_LABELS[id] ?? "Last 30 days";
}

export function periodRangeId(value: string | undefined): PeriodRangeId {
  if (value === "last12") return "last365";
  if (value === "week" || PERIOD_RANGES.some((item) => item.id === value)) return value as PeriodRangeId;
  return "last30";
}

export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addIsoDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function isoDaysBetween(from: string, to: string): number {
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((end - start) / 86_400_000);
}

function weekStart(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const fromMonday = day === 0 ? 6 : day - 1;
  return addIsoDays(iso, -fromMonday);
}

/** Inclusive start and end for a named preset. Custom has no fixed window. */
export function presetWindow(id: string, today = todayIso()): { start: string; end: string } | null {
  const end = id === "yesterday" ? addIsoDays(today, -1) : today;
  const start = id === "today" || id === "yesterday"
    ? end
    : id === "last7"
      ? addIsoDays(end, -6)
      : id === "last14"
        ? addIsoDays(end, -13)
        : id === "last90"
          ? addIsoDays(end, -89)
          : id === "last365" || id === "last12"
            ? addIsoDays(end, -364)
            : id === "week"
              ? weekStart(end)
              : id === "month"
                ? `${end.slice(0, 8)}01`
                : id === "last30"
                  ? addIsoDays(end, -29)
                  : null;
  return start ? { start, end } : null;
}

export function matchingPreset(start: string, end: string, today = todayIso()): PeriodRangeId {
  for (const item of PERIOD_RANGES) {
    if (item.id === "custom") continue;
    const window = presetWindow(item.id, today);
    if (window && window.start === start && window.end === end) return item.id;
  }
  return "custom";
}

export function analyticsSearch(clientId: string, range: string, from?: string, to?: string, websiteId?: string): string {
  const params = new URLSearchParams({ client: clientId, range });
  if (websiteId) params.set("website", websiteId);
  if (range === "custom" && from && to) {
    params.set("from", from);
    params.set("to", to);
  }
  return params.toString();
}
