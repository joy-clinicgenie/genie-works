import { AnalyticsShell, NoWebsites, UnavailableClient } from "@/components/modules/AnalyticsShell";
import { AnalyticsTraffic, analyticsHrefs } from "@/components/modules/AnalyticsPanels";
import { loadAnalyticsOverview } from "@/lib/load-analytics-board";
import { AnalyticsRangeNotice } from "@/components/modules/AnalyticsRangeNotice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Traffic" };

export default async function TrafficPage({ searchParams }: { searchParams: Promise<{ client?: string; website?: string; range?: string; from?: string; to?: string }> }) {
  const params = await searchParams;
  const { denied, view, rangeId, from, to, reportLinks, board, range } = await loadAnalyticsOverview(params);
  if (denied) return <UnavailableClient />;
  if (!view || !reportLinks || !board) return <NoWebsites />;
  const hrefs = analyticsHrefs(view.clientId, view.clientSlug, view.websiteId);
  return (
    <AnalyticsShell view={view} range={rangeId} from={from} to={to} title="Traffic">
      <AnalyticsRangeNotice range={range} clientId={view.clientId} websiteId={view.websiteId} from={from} to={to} tab="/analytics/traffic" />
      <AnalyticsTraffic board={board} links={reportLinks} leadsHref={hrefs.leadsHref} seoHref={hrefs.seoHref} />
    </AnalyticsShell>
  );
}
