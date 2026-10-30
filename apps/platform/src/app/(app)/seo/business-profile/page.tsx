import { requireAccess } from "@/lib/session";
import { Badge, label } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { SeoBusinessProfileForm } from "@/components/modules/SeoSoftLaunchForms";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { loadSeoContext, loadWebsiteSeo, queryText, selectedTab, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Google Business Profile" };

const TABS = [
  ["locations", "Locations"],
  ["reviews", "Reviews"],
  ["insights", "Insights"],
] as const;

export default async function BusinessProfilePage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const bundle = ctx.selected ? await loadWebsiteSeo(access, ctx.selected) : null;
  const tab = selectedTab(queryText(query, "tab"), TABS, "locations");
  return (
    <SeoFrame ctx={ctx} pathname="/seo/business-profile" title="Google Business Profile" description="Branch references are internal records. Saving one does not change the public Google profile." tabs={TABS} currentTab={tab}>
      {ctx.demo ? <DemoNote>No sample locations, reviews or insights are shown.</DemoNote> : tab === "reviews" ? (
        <Unavailable title="Reviews are not connected">There is no review list, draft reply or reply publication. A reply cannot be sent to Google from here.</Unavailable>
      ) : tab === "insights" ? (
        <Unavailable title="Profile insights are not connected">Calls, searches and direction requests are unavailable. They are not shown as zero.</Unavailable>
      ) : bundle ? (
        <>
          <Unavailable title="Google location access is not connected">You can record the approved clinic reference. Proposed Google changes and provider results are unavailable until a profile connection exists.</Unavailable>
          {bundle.canEdit && (
            <Card className="my-5">
              <CardHeader title="Add a branch reference" description="Staff-marked verified is not confirmation from Google." />
              <div className="px-5 pb-5"><SeoBusinessProfileForm clientId={ctx.selected!.clientId} /></div>
            </Card>
          )}
          <div className="space-y-4">
            {bundle.profiles.length === 0 && <p className="text-sm text-muted">No branch references for this clinic.</p>}
            {bundle.profiles.map((profile) => (
              <Card key={profile.id} className="p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{profile.branch_name}</h2>
                  <Badge>{label(profile.setup_status)}</Badge>
                </div>
                <dl className="mb-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs uppercase text-muted">Approved clinic details</dt><dd>{profile.branch_name}</dd></div>
                  <div><dt className="text-xs uppercase text-muted">Provider result</dt><dd>Not connected</dd></div>
                </dl>
                {bundle.canEdit && <SeoBusinessProfileForm clientId={profile.client_id} profile={profile} />}
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </SeoFrame>
  );
}
