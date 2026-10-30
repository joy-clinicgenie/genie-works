import { requireAccess } from "@/lib/session";
import { Card, CardHeader } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { SeoRedirectForm } from "@/components/modules/SeoSoftLaunchForms";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { loadSeoContext, loadWebsiteSeo, queryText, selectedTab, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "URL redirects" };

const TABS = [
  ["redirects", "Redirects"],
  ["import", "Import & Export"],
  ["migration", "Migration"],
] as const;

export default async function SeoRedirectsPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const bundle = ctx.selected ? await loadWebsiteSeo(access, ctx.selected) : null;
  const tab = selectedTab(queryText(query, "tab"), TABS, "redirects");
  const q = queryText(query, "q")?.toLowerCase();
  const rules = (bundle?.redirects ?? []).filter((rule) => !q || rule.source_path.toLowerCase().includes(q) || rule.destination_path.toLowerCase().includes(q));
  const codeManaged = ctx.selected?.platform.toLowerCase().includes("next") ?? false;
  return (
    <SeoFrame ctx={ctx} pathname="/seo/redirects" title="URL Redirects" description="Keep individual permanent redirects understandable. Imports and live tests do not run from this screen." tabs={TABS} currentTab={tab}>
      {ctx.demo ? <DemoNote>No sample redirects are listed.</DemoNote> : !codeManaged && ctx.selected ? (
        <Unavailable title="This website platform is not editable here">Individual redirects are published only to active Next.js websites. Wix and other platforms are not changed.</Unavailable>
      ) : bundle && tab === "redirects" ? (
        <>
          <Notice tone="neutral">Only local paths are accepted. Self-redirects and loops are rejected when you save. A saved rule reaches a connected Next.js site through the settings API; this screen does not call the live URL.</Notice>
          {bundle.canPublish && (
            <Card className="my-5" >
              <CardHeader title="Add a redirect" description="Permanent 301 is the supported type. Temporary redirects are not implemented." />
              <div id="new-redirect" className="px-5 pb-5">
                <SeoRedirectForm clientId={ctx.selected!.clientId} websiteId={ctx.selected!.id} initialSource={queryText(query, "from") ?? ""} initialDestination={queryText(query, "to") ?? ""} />
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Redirects" description={`${rules.length} matching rules.`} />
            <form method="get" className="px-5 pb-4">
              <input type="hidden" name="client" value={ctx.client} />
              <input type="hidden" name="website" value={ctx.website} />
              <input type="hidden" name="tab" value="redirects" />
              <label className="text-xs text-muted">Search paths <input name="q" defaultValue={queryText(query, "q")} className="mt-1 block min-h-10 w-full max-w-sm rounded-xl border border-line px-3" /></label>
            </form>
            <div className="space-y-3 px-5 pb-5">
              {rules.length === 0 && <p className="text-sm text-muted">No redirects match this website.</p>}
              {rules.map((rule) => (
                <div key={rule.id}>
                  <p className="mb-1 text-xs text-muted">{rule.active ? "Saved and active" : "Saved and inactive"} · Live test: not run · Pattern rules are under Advanced and are not available.</p>
                  {bundle.canPublish ? <SeoRedirectForm clientId={rule.client_id} websiteId={rule.website_id} redirect={rule} /> : <p className="text-sm">{rule.source_path} → {rule.destination_path}</p>}
                </div>
              ))}
            </div>
            <details className="px-5 pb-5 text-sm">
              <summary className="cursor-pointer font-medium">Advanced redirect</summary>
              <p className="mt-2 text-muted">Group and pattern rules, precedence previews and chain detection beyond the current save-time loop check are not available. Adding one here would not publish it.</p>
            </details>
          </Card>
        </>
      ) : tab === "import" ? (
        <Unavailable title="Import and export are not available">A CSV will not be accepted or applied. Download, dry-run and export actions are withheld so they cannot report a false success.</Unavailable>
      ) : (
        <Unavailable title="Migration inventory is not connected">Old URL decisions such as Keep, Redirect, Retire and Review need a source inventory. None has been imported, and no launch check has been run.</Unavailable>
      )}
    </SeoFrame>
  );
}
