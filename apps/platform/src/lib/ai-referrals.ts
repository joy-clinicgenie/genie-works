import { listConnections, publishedReport, summariseAiReferrals, type AiReferralSummary, type Queryable } from "@clinic-genie/db";
import { periodRange } from "@/lib/period-range";

export const AI_REFERRAL_RANGES = [
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
] as const;

export type AiReferralRange = (typeof AI_REFERRAL_RANGES)[number][0];

export function aiReferralRange(value: string | undefined): AiReferralRange {
  return value === "7" || value === "90" ? value : "30";
}

export type AiReferralView =
  | { state: "no_ga4"; start: string; end: string }
  | { state: "ga4_not_connected"; status: string; start: string; end: string }
  | { state: "not_fetched"; start: string; end: string }
  | { state: "ready"; start: string; end: string; fetchedAt: Date; summary: AiReferralSummary };

/**
 * AI assistant referral sessions for the selected website (D60). Reads the stored GA4
 * `ga4.ai_referrals` report for the exact preset window the worker queues, ending yesterday
 * on the Asia/Singapore reporting calendar. Nothing is filled in when the report is missing.
 */
export async function loadAiReferrals(
  db: Queryable,
  site: { clientId: string; id: string },
  range: AiReferralRange,
  today?: string,
): Promise<AiReferralView> {
  const { current } = periodRange(`last${range}` as Parameters<typeof periodRange>[0], today);
  const window = { start: current.start, end: current.end };
  const connections = await listConnections(db, site.clientId);
  const ga4 = connections.find((row) => row.website_id === site.id && row.provider === "ga4" && row.disconnected_at === null);
  if (!ga4) return { state: "no_ga4", ...window };
  if (ga4.status !== "connected") return { state: "ga4_not_connected", status: ga4.status, ...window };
  const report = await publishedReport(db, { clientId: site.clientId, websiteId: site.id, templateKey: "ga4.ai_referrals", ...window });
  if (!report) return { state: "not_fetched", ...window };
  const rows = report.rows.map((row) => {
    const sessions = row.metrics.find((metric) => metric.key === "sessions" && metric.state === "available");
    return { source: row.dimensions.sessionSource ?? row.dimensionKey, sessions: sessions?.value ?? null };
  });
  return { state: "ready", ...window, fetchedAt: report.fetchedAt, summary: summariseAiReferrals(rows) };
}
