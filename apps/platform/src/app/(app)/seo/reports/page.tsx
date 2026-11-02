import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { Card, CardHeader } from "@/components/ui/Card";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote, formatSearchMetric } from "@/components/modules/seo/OverviewPanels";
import { googleQuery, loadSearchPerformance, loadSeoContext, loadWebsiteSeo, queryText, readGoogleControls, selectedTab, seoHref, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO reports" };

const TABS = [
  ["google-search", "Google Search"],
  ["ai-traffic", "AI Traffic"],
  ["crawler", "Crawler Activity"],
  ["saved", "Saved Reports"],
] as const;

export default async function SeoReportsPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const bundle = ctx.selected && !ctx.demo ? await loadWebsiteSeo(access, ctx.selected) : null;
  const searchConnected = bundle?.searchConsole?.status === "connected";
  const controls = readGoogleControls(query);
  const performance = searchConnected && ctx.selected
    ? await loadSearchPerformance(access, ctx.selected.clientId, ctx.selected.id, controls)
    : null;
  const tab = selectedTab(queryText(query, "tab"), TABS, "google-search");
  const contextLine = `${controls.range === "custom" ? "Custom dates" : `Last ${controls.range} days`} · ${controls.metric} · ${controls.record} · ${controls.direction} ${controls.changeMetric}`;
  return (
    <SeoFrame ctx={ctx} pathname="/seo/reports" title="Reports" description="Detailed analysis behind the overview. Export and scheduled delivery are not available." tabs={TABS} currentTab={tab} tabExtra={googleQuery(controls)}>
      {ctx.demo ? <DemoNote>Report tables do not contain sample performance.</DemoNote> : null}
      {ctx.demo && tab !== "saved" ? null : tab === "google-search" ? (
        performance ? (
          <Card>
            <CardHeader title="Search Console total" description={`${performance.start} to ${performance.end}, Pacific time. The latest three days are not published yet.`} />
            <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4">
              <div><div className="text-xs uppercase text-muted">Clicks</div><div className="mt-1 text-xl font-semibold">{formatSearchMetric("clicks", performance)}</div></div>
              <div><div className="text-xs uppercase text-muted">Impressions</div><div className="mt-1 text-xl font-semibold">{formatSearchMetric("impressions", performance)}</div></div>
              <div><div className="text-xs uppercase text-muted">CTR</div><div className="mt-1 text-xl font-semibold">{formatSearchMetric("ctr", performance)}</div></div>
              <div><div className="text-xs uppercase text-muted">Average position</div><div className="mt-1 text-xl font-semibold">{formatSearchMetric("position", performance)}</div></div>
            </div>
            <p className="px-5 pb-5 text-sm text-muted">{contextLine}. Country, device and search-type filters have no data source. Page and query comparison with the previous period is not stored. Export is not available.</p>
          </Card>
        ) : (
          <Unavailable title={searchConnected ? "Search reports are not stored for this period" : "Google Search Console is not connected"}>{searchConnected ? `Connected to ${bundle?.searchConsole?.propertyId}. ` : ""}{contextLine}. Clicks, impressions, CTR and average position are {searchConnected ? "not stored yet" : "unavailable"} for this context. Changing the overview controls only preserves this context. Country, device and search-type filters have no data source. Export is not available.</Unavailable>
        )
      ) : tab === "ai-traffic" ? (
        <Unavailable title="AI traffic is not connected">Referral sessions and retrieval activity are separate, and both are unavailable. They are not combined into one number.</Unavailable>
      ) : tab === "crawler" ? (
        <Unavailable title="Crawler activity is not connected">Bot requests, accessed pages and response errors are unavailable. Search, social and AI crawler categories are not inferred.</Unavailable>
      ) : (
        <Card>
          <CardHeader title="Saved reports" description="Use the existing reports module. This page does not create a second reporting system." />
          <div className="space-y-3 px-5 pb-5 text-sm">
            <p className="text-muted">Saved filters, file export, schedules and delivery status are not stored for SEO. A release annotation would not prove that it caused a performance change.</p>
            <Link href="/reports" className="text-action hover:underline">Open reports</Link>
            <Link href={seoHref("/seo/tasks", ctx, { tab: "recommendations" })} className="ml-4 text-action hover:underline">Create a follow-up from recommendations</Link>
          </div>
        </Card>
      )}
    </SeoFrame>
  );
}
