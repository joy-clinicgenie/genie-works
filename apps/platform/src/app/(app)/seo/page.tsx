import { latestCrawlsByPlatform, loadChecklistHealth, loadSearchChanges, loadSearchReport, todaySgt } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { SeoFrame } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { SeoAssistantPanel, ToolsAndSettings } from "@/components/modules/seo/SeoAssistant";
import { GenAiVisibilityPanel, GooglePerformancePanel, type OverviewMetric } from "@/components/modules/seo/OverviewInsights";
import { loadSeoContext, readGoogleControls, searchConsoleWindow, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO" };

/**
 * SEO Overview, the SEO dashboard (D74, D76), in this order: SEO Assistant; one row with Site performance on Google
 * (2/3) and Gen AI Visibility (1/3); Tools and settings. Every figure is the selected website's own stored data.
 */
export default async function SeoOverviewPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const site = ctx.selected && !ctx.demo ? ctx.selected : null;
  // The Google panel defaults to the last 7 days and shows impressions or clicks only.
  const parsed = readGoogleControls(query);
  const controls = {
    ...parsed,
    range: query.range ? parsed.range === "custom" ? "7" as const : parsed.range : "7" as const,
    direction: query.direction === "decreased" ? "decreased" as const : "increased" as const,
  };
  // Impressions first, as on the panel; only an explicit choice selects clicks (readGoogleControls defaults to clicks).
  const metric: OverviewMetric = query.metric === "clicks" ? "clicks" : "impressions";
  const window = searchConsoleWindow(controls);
  const data = site
    ? await staffTx(access, async (db) => {
      const ids = { clientId: site.clientId, websiteId: site.id };
      const search = window ? await loadSearchReport(db, { ...ids, ...window, preset: true }) : null;
      return {
        health: await loadChecklistHealth(db, { ...ids, today: todaySgt() }),
        search,
        // Changes compare the window the totals came from (D58 fallback included) with the equal window before.
        changes: search?.window ? await loadSearchChanges(db, { ...ids, window: search.window, record: controls.record, metric }) : null,
        crawls: await latestCrawlsByPlatform(db, site.id),
      };
    })
    : null;
  return (
    <SeoFrame
      ctx={ctx}
      pathname="/seo"
      title="SEO Overview"
      description="Setup progress, work waiting, search and AI visibility for the selected website, with every SEO tool one click away."
    >
      {ctx.demo ? <DemoNote>The SEO Overview is not loaded for the demo workspace.</DemoNote> : data ? (
        <div className="space-y-6">
          <SeoAssistantPanel ctx={ctx} health={data.health} />
          {/* 2:1 when the content area is wide enough for a readable chart; otherwise Google first, then Gen AI. */}
          <div className="@container">
            <div className="grid items-start gap-4 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" data-insights-row>
              <GooglePerformancePanel ctx={ctx} controls={controls} metric={metric} report={data.search} changes={data.changes} />
              <GenAiVisibilityPanel ctx={ctx} crawls={data.crawls} />
            </div>
          </div>
          <ToolsAndSettings ctx={ctx} />
        </div>
      ) : null}
    </SeoFrame>
  );
}
