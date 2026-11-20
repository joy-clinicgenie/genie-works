import { canEditClient, formatDateTime, indexLabels, listSpeedChecks, listWebsiteIndex, readLatestRobots, readSiteChecks, readSitemapStatus } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { runSiteCheck } from "@/app/actions/seo";
import { CrawlSettingsPanel, TechnicalNotice, WebsiteChecksPanel } from "@/components/modules/seo/TechnicalPanels";
import { loadSeoContext, queryText, selectedTab, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Site health" };

const TABS = [
  ["checks", "Website Checks"],
  ["indexing", "Google Indexing"],
  ["speed", "Speed & Mobile"],
  ["crawl", "Crawl Settings"],
] as const;

function toneFor(label: string): Tone {
  if (label === "Index allowed" || label === "Indexable" || label === "Indexed") return "good";
  if (label === "Noindex saved" || label === "Blocked" || label === "Not indexed" || label === "Reconnect required" || label === "Unknown") return "warn";
  return "neutral";
}

function seconds(ms: number | null): string {
  return ms === null ? "Not measured" : `${(ms / 1000).toFixed(1)} s`;
}

export default async function SiteHealthPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const tab = selectedTab(queryText(query, "tab"), TABS, "checks");
  const site = ctx.selected;
  const indexRows = site && tab === "indexing" ? await staffTx(access, (db) => listWebsiteIndex(db, site.id)) : [];
  const speedRows = site && tab === "speed" ? await staffTx(access, (db) => listSpeedChecks(db, site.id)) : [];
  const canCheck = Boolean(site && canEditClient(access, site.clientId));
  // SEO-04 (D62): stored results for the selected website and environment only.
  const checks = site && tab === "checks" ? await staffTx(access, (db) => readSiteChecks(db, site.id)) : null;
  const crawl = site && tab === "crawl" ? await staffTx(access, async (db) => ({ sitemap: await readSitemapStatus(db, site.id), robots: await readLatestRobots(db, site.id) })) : null;
  const googleTab = tab === "indexing" || tab === "speed";
  return (
    <SeoFrame
      ctx={ctx}
      pathname="/seo/site-health"
      title="Site Health"
      description="Read-only checks of the selected website: page responses, sitemap, robots.txt, Google's index verdict and speed. Nothing is submitted or changed on the website, and a page that was not checked is not marked passed."
      tabs={TABS}
      currentTab={tab}
      action={!googleTab ? undefined : canCheck && site ? (
        <form action={runSiteCheck}>
          <input type="hidden" name="clientId" value={site.clientId} />
          <input type="hidden" name="websiteId" value={site.id} />
          <input type="hidden" name="tab" value={tab} />
          <Button type="submit">Run check</Button>
        </form>
      ) : <Button type="button" disabled>Run check</Button>}
    >
      <TechnicalNotice notice={queryText(query, "notice")} />
      {ctx.demo ? <DemoNote>No sample errors or speeds are shown.</DemoNote> : tab === "checks" ? (
        site && checks ? <WebsiteChecksPanel websiteId={site.id} view={checks} canCheck={canCheck} /> : null
      ) : tab === "indexing" ? (
        <Card>
          <CardHeader title="Indexing" description="Every public page is index allowed unless a noindex preference is saved. Live and Google come from a Search Console check. A draft article is not listed." />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Index status for public pages</caption>
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-[0.12em] text-muted"><th className="px-5 py-3">Page</th><th className="px-5 py-3">Configured</th><th className="px-5 py-3">Live</th><th className="px-5 py-3">Google</th></tr></thead>
              <tbody>
                {indexRows.length === 0 && <tr><td colSpan={4} className="px-5 py-4 text-muted">No public page is recorded for this website.</td></tr>}
                {indexRows.map((row) => {
                  const labels = indexLabels(row);
                  return (
                    <tr key={row.pagePath} className="border-b border-line/70">
                      <td className="px-5 py-3">{row.pagePath}</td>
                      <td className="px-5 py-3"><Badge tone={toneFor(labels.configured)}>{labels.configured}</Badge></td>
                      <td className="px-5 py-3"><Badge tone={toneFor(labels.live)}>{labels.live}</Badge></td>
                      <td className="px-5 py-3">
                        <Badge tone={toneFor(labels.google)}>{labels.google}</Badge>
                        {row.coverage && <div className="mt-1 text-xs text-muted">{row.coverage}</div>}
                        {row.failed && <div className="mt-1 text-xs text-muted">Check did not complete</div>}
                        {row.checkedAt && <div className="mt-1 text-xs text-muted">Checked {formatDateTime(row.checkedAt)}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : tab === "speed" ? (
        speedRows.length === 0 ? (
          <Unavailable title="No speed or mobile measurement is stored">A mobile lab score is stored when the worker measures a public page. Nothing is estimated, and a missing score is not a pass.</Unavailable>
        ) : (
          <Card>
            <CardHeader title="Mobile lab data" description="Scores are stored measurements. They do not change the public website." />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Stored mobile speed measurements</caption>
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-[0.12em] text-muted"><th className="px-5 py-3">Page</th><th className="px-5 py-3">Device</th><th className="px-5 py-3">Score</th><th className="px-5 py-3">Largest contentful paint</th><th className="px-5 py-3">Cumulative layout shift</th><th className="px-5 py-3">Total blocking time</th><th className="px-5 py-3">Measured</th></tr></thead>
                <tbody>
                  {speedRows.map((row) => (
                    <tr key={`${row.pagePath}-${row.strategy}`} className="border-b border-line/70">
                      <td className="px-5 py-3">{row.pagePath}</td>
                      <td className="px-5 py-3">{row.strategy === "mobile" ? "Mobile" : "Desktop"}</td>
                      <td className="px-5 py-3">{row.failed || row.score === null ? "Not measured" : <Badge tone={row.score >= 90 ? "good" : row.score >= 50 ? "warn" : "bad"}>{row.score}</Badge>}</td>
                      <td className="px-5 py-3">{row.failed ? "Not measured" : seconds(row.lcpMs)}</td>
                      <td className="px-5 py-3">{row.failed || row.cls === null ? "Not measured" : row.cls.toFixed(3)}</td>
                      <td className="px-5 py-3">{row.failed || row.tbtMs === null ? "Not measured" : `${row.tbtMs} ms`}</td>
                      <td className="px-5 py-3">{row.checkedAt ? formatDateTime(row.checkedAt) : "Not measured"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : (
        site && crawl ? <CrawlSettingsPanel websiteId={site.id} sitemap={crawl.sitemap} robots={crawl.robots} canCheck={canCheck} /> : null
      )}
    </SeoFrame>
  );
}
