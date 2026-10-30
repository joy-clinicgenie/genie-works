import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { Card, CardHeader } from "@/components/ui/Card";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { googleQuery, loadSeoContext, loadWebsiteSeo, queryText, readGoogleControls, selectedTab, seoHref, type SeoSearch } from "@/lib/seo-workspace";

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
  const tab = selectedTab(queryText(query, "tab"), TABS, "google-search");
  const contextLine = `${controls.range === "custom" ? "Custom dates" : `Last ${controls.range} days`} · ${controls.metric} · ${controls.record} · ${controls.direction} ${controls.changeMetric}`;
  return (
    <SeoFrame ctx={ctx} pathname="/seo/reports" title="Reports" description="Detailed analysis behind the overview. Export and scheduled delivery are not available." tabs={TABS} currentTab={tab} tabExtra={googleQuery(controls)}>
      {ctx.demo ? <DemoNote>Report tables do not contain sample performance.</DemoNote> : null}
      {ctx.demo && tab !== "saved" ? null : tab === "google-search" ? (
        <Unavailable title={searchConnected ? "Search reports are not stored for this period" : "Google Search Console is not connected"}>{searchConnected ? `Connected to ${bundle?.searchConsole?.propertyId}. ` : ""}{contextLine}. Clicks, impressions, CTR and average position are {searchConnected ? "not stored yet" : "unavailable"} for this context. Changing the overview controls only preserves this context. Country, device and search-type filters have no data source. Export is not available.</Unavailable>
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
