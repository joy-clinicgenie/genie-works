export interface PageSpeedReading {
  score: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
}

export function pageSpeedUrl(pageUrl: string, apiKey?: string): string {
  const url = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  url.searchParams.set("url", pageUrl);
  url.searchParams.set("strategy", "mobile");
  url.searchParams.set("category", "performance");
  if (apiKey) url.searchParams.set("key", apiKey);
  return url.toString();
}

export function parsePageSpeed(body: unknown): PageSpeedReading {
  const lighthouse = asRecord(asRecord(body).lighthouseResult);
  const categories = asRecord(lighthouse.categories);
  const performance = asRecord(categories.performance);
  const audits = asRecord(lighthouse.audits);
  const scoreRaw = performance.score;
  const score = typeof scoreRaw === "number" && scoreRaw >= 0 && scoreRaw <= 1 ? Math.round(scoreRaw * 100) : null;
  return {
    score,
    lcpMs: millis(asRecord(audits["largest-contentful-paint"]).numericValue),
    cls: round3(asRecord(audits["cumulative-layout-shift"]).numericValue),
    tbtMs: millis(asRecord(audits["total-blocking-time"]).numericValue),
  };
}

function millis(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function round3(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
