import { describe, expect, it } from "vitest";
import { dueJobs } from "@clinic-genie/db";
import { analyticsPeriod } from "./period-range";
import { searchConsoleWindow } from "./seo-workspace";

/**
 * The pages read range reports by exact start and end date. Every window a page asks for
 * must be one the worker queues, or the page stays empty (D52).
 */
const NOW = new Date("2026-11-12T02:05:00.000Z"); // 10:05 Asia/Singapore, just after the cron.
const TODAY = "2026-11-12";
/** Reports the pages read for the selected window. */
const GA4_RANGE_TEMPLATES = ["ga4.traffic_range", "ga4.acquisition", "ga4.landing", "ga4.device", "ga4.country", "ga4.engagement", "ga4.pages", "ga4.visitor_type"];
/** Reports the pages also read for the previous window, to show a change. */
const GA4_COMPARED_TEMPLATES = ["ga4.traffic_range", "ga4.acquisition"];

function windowsFor(jobs: Array<{ templateKey: string; start: string; end: string }>, templateKey: string): string[] {
  return jobs.filter((job) => job.templateKey === templateKey).map((job) => `${job.start}..${job.end}`);
}

describe("analytics window contract (D52)", () => {
  for (const timezone of ["Asia/Singapore", "America/Los_Angeles"]) {
    it(`queues every GA4 range report the Last 7, 30 and 90 presets read (${timezone} property)`, () => {
      const jobs = dueJobs("ga4", NOW, timezone);
      for (const range of ["last7", "last30", "last90"]) {
        const { windows } = analyticsPeriod({ range, live: true, today: TODAY });
        for (const templateKey of GA4_RANGE_TEMPLATES) {
          expect(windowsFor(jobs, templateKey), `${range} ${templateKey}`).toContain(`${windows.current.start}..${windows.current.end}`);
        }
        for (const templateKey of GA4_COMPARED_TEMPLATES) {
          expect(windowsFor(jobs, templateKey), `${range} previous ${templateKey}`).toContain(`${windows.previous.start}..${windows.previous.end}`);
        }
      }
    });
  }

  it("stays within one worker run for a GA4 connection", () => {
    // The worker takes up to 40 jobs a run and the hosted cron runs once a day.
    expect(dueJobs("ga4", NOW, "Asia/Singapore").length).toBeLessThanOrEqual(40);
  });

  it("covers the daily sessions Last 90 and its previous period need", () => {
    const daily = dueJobs("ga4", NOW, "Asia/Singapore").filter((job) => job.templateKey === "ga4.traffic_daily");
    expect(daily).toHaveLength(1);
    const { windows } = analyticsPeriod({ range: "last90", live: true, today: TODAY });
    expect(daily[0]!.start <= windows.previous.start).toBe(true);
    expect(daily[0]!.end >= windows.current.end).toBe(true);
  });

  it("queues every Search Console total the SEO 7, 30 and 90 day views read", () => {
    const jobs = dueJobs("gsc", NOW, null);
    for (const range of ["7", "30", "90"] as const) {
      const window = searchConsoleWindow({ range } as Parameters<typeof searchConsoleWindow>[0], NOW)!;
      for (const templateKey of ["gsc.totals", "gsc.pages", "gsc.queries"]) {
        expect(windowsFor(jobs, templateKey), `${range} ${templateKey}`).toContain(`${window.start}..${window.end}`);
      }
    }
  });

  it("keeps Wix on its daily history window only", () => {
    const jobs = dueJobs("wix", NOW, "Asia/Singapore");
    expect(jobs.map((job) => job.templateKey)).toEqual(["wix.data_daily"]);
  });
});
