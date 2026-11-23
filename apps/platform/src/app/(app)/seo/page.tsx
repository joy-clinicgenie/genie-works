import { addDays, loadAiReport, loadChecklistHealth, loadRecentChanges, loadSearchReport, todaySgt } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { LinkButton } from "@/components/ui/Button";
import { SeoFrame } from "@/components/modules/seo/SeoFrame";
import { AiPanel, ChecklistHealthPanel, DemoNote, GooglePanel, QuickActions, RecentChanges } from "@/components/modules/seo/OverviewPanels";
import { loadSeoContext, readGoogleControls, searchConsoleWindow, seoHref, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO" };

/** AI Visibility on the overview is always the last 30 days ending yesterday, Asia/Singapore (SEO-01.4). */
const AI_DAYS = 30;

export default async function SeoOverviewPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const site = ctx.selected && !ctx.demo ? ctx.selected : null;
  // SEO-01.3: the full report's date logic, defaulting to the last 30 days.
  const controls = readGoogleControls(query);
  const window = searchConsoleWindow(controls);
  const today = todaySgt();
  const aiEnd = addDays(today, -1);
  // Every card reads the loader its destination reads (D67), in one transaction for this website.
  const data = site
    ? await staffTx(access, async (db) => ({
      health: await loadChecklistHealth(db, { websiteId: site.id, clientId: site.clientId, today }),
      search: window ? await loadSearchReport(db, { clientId: site.clientId, websiteId: site.id, ...window, preset: controls.range !== "custom" }) : null,
      ai: await loadAiReport(db, { clientId: site.clientId, websiteId: site.id, start: addDays(aiEnd, 1 - AI_DAYS), end: aiEnd }),
      changes: await loadRecentChanges(db, site.id, 5),
    }))
    : null;
  return (
    <SeoFrame
      ctx={ctx}
      pathname="/seo"
      title="SEO Overview"
      description="Setup and health, search performance, AI visibility and recent changes for the selected website."
      action={site ? <LinkButton href={seoHref("/seo/site-health", ctx, { tab: "checks" })} variant="secondary">Website checks</LinkButton> : undefined}
    >
      {ctx.demo ? <DemoNote>The overview cards are not loaded for the demo workspace.</DemoNote> : data ? (
        <div className="space-y-4">
          <ChecklistHealthPanel ctx={ctx} health={data.health} />
          <div className="grid items-start gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2"><GooglePanel ctx={ctx} controls={controls} report={data.search} /></div>
            <AiPanel ctx={ctx} report={data.ai} days={AI_DAYS} />
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <QuickActions ctx={ctx} />
            <RecentChanges ctx={ctx} changes={data.changes} />
          </div>
        </div>
      ) : null}
    </SeoFrame>
  );
}
