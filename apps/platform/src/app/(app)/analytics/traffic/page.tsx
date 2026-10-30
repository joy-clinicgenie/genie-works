import { AnalyticsShell, loadAnalytics, NoWebsites, UnavailableClient } from "@/components/modules/AnalyticsShell";
import { AnalyticsTraffic, analyticsHrefs } from "@/components/modules/AnalyticsPanels";
import { loadAnalyticsBoard } from "@/lib/load-analytics-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Traffic" };

export default async function TrafficPage({ searchParams }: { searchParams: Promise<{ client?: string; website?: string; range?: string; from?: string; to?: string }> }) {
  const params = await searchParams;
  const { denied, view, rangeId, from, to, reportLinks } = await loadAnalytics(params.client, params.range, params.from, params.to, params.website);
  if (denied) return <UnavailableClient />;
  if (!view || !reportLinks) return <NoWebsites />;
  const board = await loadAnalyticsBoard(view);
  const hrefs = analyticsHrefs(view.clientId, view.clientSlug, view.websiteId);
  return (
    <AnalyticsShell view={view} range={rangeId} from={from} to={to} title="Traffic">
      <AnalyticsTraffic board={board} links={reportLinks} leadsHref={hrefs.leadsHref} seoHref={hrefs.seoHref} />
    </AnalyticsShell>
  );
}
