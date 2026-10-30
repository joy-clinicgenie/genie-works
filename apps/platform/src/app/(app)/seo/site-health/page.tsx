import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { loadSeoContext, loadWebsiteSeo, queryText, selectedTab, seoHref, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Site health" };

const TABS = [
  ["checks", "Website Checks"],
  ["indexing", "Google Indexing"],
  ["speed", "Speed & Mobile"],
  ["crawl", "Crawl Settings"],
] as const;

export default async function SiteHealthPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const bundle = ctx.selected ? await loadWebsiteSeo(access, ctx.selected) : null;
  const tab = selectedTab(queryText(query, "tab"), TABS, "checks");
  return (
    <SeoFrame ctx={ctx} pathname="/seo/site-health" title="Site Health" description="Technical findings will appear here after a real check. Nothing on this page has been crawled." tabs={TABS} currentTab={tab} action={<Button type="button" disabled>Run check</Button>}>
      {ctx.demo ? <DemoNote>No sample errors or speeds are shown.</DemoNote> : tab === "checks" ? (
        <Unavailable title="No scan results">Broken links, response errors, duplicate metadata, headings, canonical conflicts and schema findings are unavailable. A page that was not scanned is not marked Passed.</Unavailable>
      ) : tab === "indexing" ? (
        <Card>
          <CardHeader title="Configured indexing" description="This is the saved preference. It is not live indexability and it is not Google's reported index." />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Configured indexing preferences</caption>
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-[0.12em] text-muted"><th className="px-5 py-3">Page</th><th className="px-5 py-3">Configured</th><th className="px-5 py-3">Live</th><th className="px-5 py-3">Google</th></tr></thead>
              <tbody>
                {(bundle?.settings.length ?? 0) === 0 && <tr><td colSpan={4} className="px-5 py-4 text-muted">No indexing preference is saved for this website.</td></tr>}
                {bundle?.settings.map((setting) => (
                  <tr key={setting.id} className="border-b border-line/70">
                    <td className="px-5 py-3">{setting.page_path}</td>
                    <td className="px-5 py-3"><Badge tone={setting.indexable ? "good" : "warn"}>{setting.indexable ? "Index allowed" : "Noindex saved"}</Badge></td>
                    <td className="px-5 py-3">Not checked</td>
                    <td className="px-5 py-3">Not connected</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : tab === "speed" ? (
        <Unavailable title="No speed or mobile measurement">Lab data and real-user data are both unavailable. No scores are estimated.</Unavailable>
      ) : (
        <div className="space-y-4">
          <Unavailable title="Sitemap and robots.txt have not been generated here">A supported clinic website may generate its own files. This screen has not fetched them, counted URLs or submitted a sitemap.</Unavailable>
          <Card>
            <CardHeader title="Robots rules" description="Plain-language summary. Raw editing is not available." />
            <div className="space-y-3 px-5 pb-5 text-sm">
              <p>Crawl blocking and noindex are different controls. A saved noindex preference does not by itself change robots.txt.</p>
              <details>
                <summary className="cursor-pointer font-medium">Advanced</summary>
                <p className="mt-2 text-muted">Raw robots.txt editing, rule comparison and restore are not implemented. Preview protection must not rely on robots.txt alone.</p>
              </details>
              <Link href={seoHref("/seo/tasks", ctx, { tab: "issues" })} className="text-action hover:underline">Create or review a task</Link>
            </div>
          </Card>
        </div>
      )}
    </SeoFrame>
  );
}
