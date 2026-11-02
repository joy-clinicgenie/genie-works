import { requireAccess } from "@/lib/session";
import { Button, LinkButton } from "@/components/ui/Button";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { AiPanel, AssistantPanel, GooglePanel, QuickActions, RecentChanges } from "@/components/modules/seo/OverviewPanels";
import { loadSearchPerformance, loadSeoOverview, readGoogleControls, seoHref, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO" };

export default async function SeoOverviewPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const { ctx, bundle } = await loadSeoOverview(access, query);
  const controls = readGoogleControls(query);
  const performance = bundle?.searchConsole?.status === "connected" && ctx.selected
    ? await loadSearchPerformance(access, ctx.selected.clientId, ctx.selected.id, controls)
    : null;
  const drafts = bundle?.changes.filter((change) => !change.verification_on).length ?? 0;
  return (
    <SeoFrame
      ctx={ctx}
      pathname="/seo"
      title="SEO Overview"
      description="What needs attention, how the site is performing, and what to do next."
      action={ctx.selected ? (
        <>
          <Button type="button" disabled aria-describedby="check-unavailable">Run website check</Button>
          <LinkButton href={seoHref("/seo/settings", ctx, { tab: "publishing" })} variant="secondary">Review changes{drafts ? ` (${drafts})` : ""}</LinkButton>
        </>
      ) : undefined}
    >
      <div className="space-y-4">
        <p id="check-unavailable" className="text-xs text-muted">Run website check is unavailable because no crawler is connected.</p>
        <AssistantPanel ctx={ctx} bundle={bundle} />
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2"><GooglePanel ctx={ctx} controls={controls} search={bundle?.searchConsole} performance={performance} /></div>
          <AiPanel ctx={ctx} />
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <QuickActions ctx={ctx} />
          {bundle ? <RecentChanges ctx={ctx} bundle={bundle} /> : <Unavailable title="Recent changes">Choose a website to see its saved change records.</Unavailable>}
        </div>
      </div>
    </SeoFrame>
  );
}
