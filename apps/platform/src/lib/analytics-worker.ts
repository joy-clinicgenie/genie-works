import { bearerMatches } from "@clinic-genie/db";

/** Accepts the worker bearer or the bearer a Vercel Cron sends as CRON_SECRET. Either match is enough. An empty secret never matches. */
export function workerAuthorized(
  header: string | null,
  env: { workerSecret?: string; cronSecret?: string } = {
    workerSecret: process.env.ANALYTICS_WORKER_SECRET,
    cronSecret: process.env.CRON_SECRET,
  },
): boolean {
  return bearerMatches(header, env.workerSecret) || bearerMatches(header, env.cronSecret);
}
