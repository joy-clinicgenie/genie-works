import { AnalyticsShell, NoWebsites, UnavailableClient } from "@/components/modules/AnalyticsShell";
import { AnalyticsBehaviour, analyticsHrefs } from "@/components/modules/AnalyticsPanels";
import { loadAnalyticsOverview } from "@/lib/load-analytics-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Behaviour" };

export default async function BehaviourPage({ searchParams }: { searchParams: Promise<{ client?: string; website?: string; range?: string; from?: string; to?: string }> }) {
  const params = await searchParams;
  const { denied, view, rangeId, from, to, reportLinks, board } = await loadAnalyticsOverview(params);
  if (denied) return <UnavailableClient />;
  if (!view || !reportLinks || !board) return <NoWebsites />;
  const hrefs = analyticsHrefs(view.clientId, view.clientSlug, view.websiteId);
  return (
    <AnalyticsShell view={view} range={rangeId} from={from} to={to} title="Behaviour">
      <AnalyticsBehaviour board={board} links={reportLinks} leadsHref={hrefs.leadsHref} seoHref={hrefs.seoHref} />
    </AnalyticsShell>
  );
}
