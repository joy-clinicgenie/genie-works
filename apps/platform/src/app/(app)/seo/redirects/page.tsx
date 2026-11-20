import { canEditClient, formatDateTime, listRedirectChecks } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Badge } from "@/components/ui/Badge";
import { RedirectCheckForm, RedirectCheckResult } from "@/components/modules/seo/RedirectChecks";
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
  const site = ctx.selected;
  // SEO-04.4 (D62): checks run for every platform; publishing rules stays with each website.
  const checks = site && tab === "redirects" ? await staffTx(access, (db) => listRedirectChecks(db, site.id)) : [];
  const checkFor = (source: string) => checks.find((check) => check.sourcePath === source);
  const canCheck = Boolean(site && canEditClient(access, site.clientId));
  const notice = queryText(query, "notice");
  const checked = queryText(query, "checked");
  const checker = site && canCheck ? (
    <Card className="mb-5">
      <CardHeader title="Check a redirect" description="Requests the old URL on this website and records every hop until the final page. Nothing on the website changes. Fix a failing redirect on the website, then check again." />
      <div className="px-5 pb-5"><RedirectCheckForm websiteId={site.id} sourcePath={queryText(query, "check_from") ?? ""} expectedPath={queryText(query, "check_to") ?? ""} /></div>
    </Card>
  ) : null;
  const recent = checks.length > 0 ? (
    <Card className="mb-5">
      <CardHeader title="Redirect check results" description="The latest check for each old path." />
      <ul className="divide-y divide-line">
        {checks.map((check) => (
          <li key={check.sourcePath} className="px-5 py-4" data-redirect-check={check.sourcePath}>
            <RedirectCheckResult check={check} websiteId={site!.id} canCheck={canCheck} highlight={check.sourcePath === checked} />
          </li>
        ))}
      </ul>
    </Card>
  ) : null;
  const notices: Record<string, string> = {
    redirect_checked: "The redirect was checked. The result is below.",
    invalid_path: "Enter the old path and the expected destination as paths on this website, for example /old-page and /new-page.",
    missing_url: "This website has no public address recorded, so the redirect could not be requested.",
    denied: "Checking redirects needs edit access to this clinic.",
  };
  return (
    <SeoFrame ctx={ctx} pathname="/seo/redirects" title="URL Redirects" description="Keep individual permanent redirects understandable and check that old URLs lead to the intended live page. Imports do not run from this screen." tabs={TABS} currentTab={tab}>
      {notice && notices[notice] && <div className="mb-4"><Notice tone="neutral">{notices[notice]}</Notice></div>}
      {ctx.demo ? <DemoNote>No sample redirects are listed.</DemoNote> : !codeManaged && ctx.selected && tab === "redirects" ? (
        <>
          {checker}
          {recent}
          <Unavailable title="Redirect rules are not edited here for this platform">This website publishes its own redirects. Individual rules are published from Genie Works only to active Next.js websites; Wix and other platforms are not changed. Use the check above to verify the website&apos;s redirects.</Unavailable>
        </>
      ) : bundle && tab === "redirects" ? (
        <>
          {checker}
          {recent}
          <Notice tone="neutral">Only local paths are accepted. Self-redirects and loops are rejected when you save. A saved rule reaches a connected Next.js site through the settings API; use Check a redirect to confirm the live behaviour.</Notice>
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
                  <p className="mb-1 text-xs text-muted">
                    {rule.active ? "Saved and active" : "Saved and inactive"} · Live check:{" "}
                    {checkFor(rule.source_path) ? (
                      <><Badge tone={checkFor(rule.source_path)!.result === "passed" ? "good" : "bad"}>{checkFor(rule.source_path)!.result === "passed" ? "Passed" : "Failed"}</Badge> {formatDateTime(checkFor(rule.source_path)!.checkedAt)}</>
                    ) : "not run"}
                    {canCheck && <> · <a className="text-action hover:underline" href={`/seo/redirects?${new URLSearchParams({ website: site!.id, tab: "redirects", check_from: rule.source_path, check_to: rule.destination_path })}#check-redirect`}>Check this redirect</a></>}
                  </p>
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
