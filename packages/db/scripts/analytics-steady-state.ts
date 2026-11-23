/**
 * Steady-state jobs a day for the production-sized connection set, from the planner and the reuse rule
 * alone (no database, no provider). A window the plan asks for again is fetched again only if it had not
 * settled when it was fetched (GA4, Wix) and is skipped if it had (Search Console). Day 0 is the first day.
 *
 *   npm run analytics:steady -w @clinic-genie/db
 */
import { planDueJobs } from "../src/analytics/scheduling";
import { windowWasSettledWhenFetched } from "../src/analytics/sync";
import { civilDate } from "../src/analytics/sync";

const DAYS = 400;
const start = Date.parse("2026-11-30T16:00:00.000Z"); // midnight Singapore
const connections = [
  { provider: "ga4" as const, zone: "Asia/Singapore", n: 1 },
  { provider: "gsc" as const, zone: "America/Los_Angeles", n: 10 },
  { provider: "wix" as const, zone: "Asia/Singapore", n: 10 },
];
const fetched = new Map<string, number>(); // window -> time fetched (ms)
const perDay: number[] = [];
for (let day = 0; day < DAYS; day += 1) {
  let jobs = 0;
  // Sample the day at the planning moments that matter: after both the Singapore and the Pacific rollover.
  for (const hour of [1, 17]) {
    const now = new Date(start + day * 86_400_000 + hour * 3_600_000);
    for (const { provider, zone, n } of connections) {
      const today = civilDate(zone, now);
      for (const job of planDueJobs(provider, now, zone)) {
        const key = `${provider}|${job.templateKey}|${job.start}|${job.end}`;
        const at = fetched.get(key);
        if (at !== undefined) {
          const partial = job.end >= today;
          const sameDay = civilDate(zone, new Date(at)) === today;
          if (partial || sameDay || windowWasSettledWhenFetched(provider, job.end, new Date(at))) continue;
        }
        fetched.set(key, now.getTime() + 3_600_000);
        jobs += n;
      }
    }
  }
  perDay.push(jobs);
}
const at = (day: number) => perDay[day];
const mean = (from: number, to: number) => +(perDay.slice(from, to).reduce((a, b) => a + b, 0) / (to - from)).toFixed(1);
console.log(JSON.stringify({
  note: "jobs per day for 1 GA4 + 10 Search Console + 10 Wix, planner version 2, rolled-over days only counted once",
  day10: mean(10, 11), mean_days_10_to_29: mean(10, 30), mean_days_40_to_89: mean(40, 90), mean_days_100_to_399: mean(100, 400),
  firstDaysSample: perDay.slice(0, 10), day: { 7: at(7), 8: at(8), 29: at(29), 30: at(30), 31: at(31), 89: at(89), 90: at(90), 91: at(91), 200: at(200) },
}, null, 2));
