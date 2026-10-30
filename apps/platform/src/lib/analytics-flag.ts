import { envFlag } from "@clinic-genie/db";

/** Existing snapshot reports stay on until this is explicitly enabled. */
export function analyticsLiveReports(): boolean {
  return envFlag("ANALYTICS_LIVE_REPORTS", false);
}
