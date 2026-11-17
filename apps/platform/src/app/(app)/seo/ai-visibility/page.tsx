import { canEditClient, listAiAccessChecks } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { AiAccessPanel } from "@/components/modules/seo/AiAccessPanel";
import { AiReferralsPanel } from "@/components/modules/seo/AiReferralsPanel";
import { aiReferralRange, loadAiReferrals } from "@/lib/ai-referrals";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { loadSeoContext, queryText, selectedTab, seoHref, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI visibility" };

const TABS = [
  ["visibility", "Visibility"],
  ["questions", "Questions & Tests"],
  ["sources", "Sources & Perception"],
  ["access", "AI Access"],
] as const;

export default async function AiVisibilityPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const tab = selectedTab(queryText(query, "tab"), TABS, "visibility");
  const site = ctx.selected;
  const checks = site && !ctx.demo && tab === "access" ? await staffTx(access, (db) => listAiAccessChecks(db, site.id, 10)) : [];
  const range = aiReferralRange(queryText(query, "range"));
  const referrals = site && !ctx.demo && tab === "visibility" ? await staffTx(access, (db) => loadAiReferrals(db, site, range)) : null;
  return (
    <SeoFrame ctx={ctx} pathname="/seo/ai-visibility" title="AI Visibility" description="Sampled answers, AI traffic and public AI access are separate. Visibility shows AI referral sessions from GA4. AI Access reads the website’s robots.txt and llms.txt. No answer-test provider is connected." tabs={TABS} currentTab={tab}>
      {ctx.demo ? <DemoNote>No sample mentions, citations or crawler totals are shown.</DemoNote> : tab === "visibility" ? (
        <div className="space-y-4">
          {site && referrals ? (
            <AiReferralsPanel view={referrals} range={range} hrefFor={(id) => seoHref("/seo/ai-visibility", ctx, { tab: "visibility", range: id })} />
          ) : <Unavailable title="Choose a website">Select a client website to see its AI referral sessions.</Unavailable>}
          <Unavailable title="No visibility test has been run">Direct mentions and citations in AI answers are unavailable. A missing test is not a negative mention, and no platform is listed without a connected result.</Unavailable>
        </div>
      ) : tab === "questions" ? (
        <Unavailable title="No question library">Questions, branded or unbranded classification, model, cost and run history are not stored. Run test is unavailable, so it cannot spend a provider budget or report success.</Unavailable>
      ) : tab === "sources" ? (
        <Unavailable title="No saved answers">Source links, competitor appearances and descriptions of the clinic are unavailable. Nothing has been flagged for factual review.</Unavailable>
      ) : (
        <div className="space-y-4">
          {site ? (
            <AiAccessPanel clientId={site.clientId} websiteId={site.id} canCheck={canEditClient(access, site.clientId)} checks={checks} notice={queryText(query, "notice")} />
          ) : <Unavailable title="Choose a website">Select a client website to see its AI crawler access.</Unavailable>}
          <Unavailable title="Crawler visits are not connected">No server log is connected, so visits by GPTBot, ClaudeBot, PerplexityBot and others are not counted. A crawler visit is not a citation and not a user question.</Unavailable>
          <Unavailable title="llms.txt is not edited here">Editing, custom mode and publication stay on the website itself.</Unavailable>
          <Unavailable title="NLWeb is not implemented">Compatibility, public sources and query tests are unavailable. Private enquiries and unpublished content are not sent anywhere from this screen.</Unavailable>
        </div>
      )}
    </SeoFrame>
  );
}
