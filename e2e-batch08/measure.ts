/**
 * Measurement helpers for the signed-in performance baselines.
 *
 * Recorded separately: browser navigation and primary-data-visible timings, the server's own response
 * time, and — during concurrency runs — the number of application backends actually connected.
 *
 * Database query and transaction counts are deliberately **not** measured here. Two instruments were
 * tried and rejected:
 *
 * - `pg_stat_statements` needs `shared_preload_libraries`, which the embedded server does not set, and
 *   this work did not change the shared development cluster's configuration.
 * - `pg_stat_database.xact_commit` is flushed on a timer, not at commit, and the lag is longer than any
 *   reasonable settle delay. Measured on this fixture: 50 statements produced a delta of 1, and the
 *   next window of 6 statements produced a delta of 52 as the earlier batch finally flushed. It cannot
 *   attribute transactions to a request.
 *
 * Exact per-path query and round-trip counts come from `e2e-batch08/perf-query-counts.mts` instead,
 * which wraps the `pg` client's `query` method around the real service functions.
 *
 * `pg_stat_activity` is a live view rather than a cumulative counter, so sampling it during a burst is
 * sound; that is what the concurrency sampler uses.
 */
import pg from "pg";
import type { Page } from "@playwright/test";
import { adminUrl, suiteTargets, type SuiteName } from "./targets.ts";

export interface NavigationSample {
  /** Wall clock around goto. */
  navigationMs: number;
  /** Wall clock from before goto until the page's own primary data is visible. */
  primaryDataVisibleMs: number;
  /** From the browser's navigation entry. responseStart is the server's time to first byte. */
  ttfbMs: number | null;
  responseEndMs: number | null;
  domContentLoadedMs: number | null;
  firstContentfulPaintMs: number | null;
  /** Layout shift accumulated up to the point the primary data appeared. */
  cumulativeLayoutShift: number | null;
  requestCount: number | null;
  transferredBytes: number | null;
  status: number | null;
}

/**
 * Samples how many application backends are connected to the isolated database during a burst.
 * `pg_stat_activity` is a live view, so a sample is the state at that instant; the peak across samples
 * is what a concurrency run reports.
 */
export class BackendSampler {
  private pool: pg.Pool;
  private timer: ReturnType<typeof setInterval> | undefined;
  private samples: Array<{ total: number; active: number; idleInTransaction: number }> = [];

  constructor(suite: SuiteName) {
    this.pool = new pg.Pool({ connectionString: adminUrl(suiteTargets(suite).platformDb), max: 1 });
  }

  start(everyMs = 50): void {
    this.samples = [];
    this.timer = setInterval(() => {
      void this.pool
        .query<{ total: string; active: string; idle_in_transaction: string }>(
          `select count(*) as total,
                  count(*) filter (where state = 'active') as active,
                  count(*) filter (where state = 'idle in transaction') as idle_in_transaction
           from pg_stat_activity
           where datname = current_database() and usename = 'cg_app'`,
        )
        .then(({ rows }) => {
          const row = rows[0];
          if (row) {
            this.samples.push({
              total: Number(row.total),
              active: Number(row.active),
              idleInTransaction: Number(row.idle_in_transaction),
            });
          }
        })
        .catch(() => {
          /* a dropped sample is not worth failing a run over */
        });
    }, everyMs);
  }

  stop(): { samples: number; peakTotal: number | null; peakActive: number | null; peakIdleInTransaction: number | null } {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.samples.length === 0) return { samples: 0, peakTotal: null, peakActive: null, peakIdleInTransaction: null };
    return {
      samples: this.samples.length,
      peakTotal: Math.max(...this.samples.map((s) => s.total)),
      peakActive: Math.max(...this.samples.map((s) => s.active)),
      peakIdleInTransaction: Math.max(...this.samples.map((s) => s.idleInTransaction)),
    };
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pool.end();
  }
}

/** Installs observers before navigation so layout shift is collected from the first paint. */
export async function installObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = { cls: 0 };
    (window as unknown as { __perf: typeof store }).__perf = store;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
          if (!entry.hadRecentInput && typeof entry.value === "number") store.cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      /* layout-shift is not supported in every engine */
    }
  });
}

/**
 * Navigates and waits for the selector that proves the page's primary data is on screen, then reads
 * the browser's own timings.
 */
export async function measureNavigation(page: Page, url: string, primarySelector: string, timeout = 60_000): Promise<NavigationSample> {
  const started = Date.now();
  const response = await page.goto(url, { waitUntil: "commit", timeout });
  const afterNavigation = Date.now();
  await page.locator(primarySelector).first().waitFor({ state: "visible", timeout });
  const primaryDataVisibleMs = Date.now() - started;

  const timings = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const store = (window as unknown as { __perf?: { cls: number } }).__perf;
    return {
      ttfbMs: nav ? Math.round(nav.responseStart) : null,
      responseEndMs: nav ? Math.round(nav.responseEnd) : null,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      firstContentfulPaintMs: paint ? Math.round(paint.startTime) : null,
      cumulativeLayoutShift: store ? Number(store.cls.toFixed(4)) : null,
      requestCount: resources.length + 1,
      transferredBytes: resources.reduce((sum, item) => sum + (item.transferSize || 0), 0) + (nav?.transferSize ?? 0),
    };
  });

  return {
    navigationMs: afterNavigation - started,
    primaryDataVisibleMs,
    status: response?.status() ?? null,
    ...timings,
  };
}

export function summarise(values: number[]): { n: number; min: number; p50: number; p95: number; max: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    n: sorted.length,
    min: Math.round(sorted[0]!),
    p50: Math.round(at(0.5)),
    p95: Math.round(at(0.95)),
    max: Math.round(sorted[sorted.length - 1]!),
  };
}
