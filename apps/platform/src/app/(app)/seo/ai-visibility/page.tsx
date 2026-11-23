import { AI_PROVIDERS, addDays, canEditClient, canManageRegistry, canPublishClient, canWriteConnectionSecrets, listAiAccessChecks, listCrawlerEvents, listCrawlerSources, loadAiActivity, readNlweb, todaySgt, type AiProvider } from "@clinic-genie/db";
import { Card, CardHeader } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { AI_NOTICES, AiActivityPanel, AnswerTestForm, NlwebPanel } from "@/components/modules/seo/AiActivity";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { AiAccessPanel } from "@/components/modules/seo/AiAccessPanel";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { AI_SECTION_TABS } from "@/lib/seo-sections";
import { loadSeoContext, queryText, selectedTab, type SeoSearch } from "@/lib/seo-workspace";

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
  // SEO-05.3 (D63): GA4 preset ranges ending yesterday, Asia/Singapore.
  const days = [7, 30, 90].includes(Number(queryText(query, "range"))) ? Number(queryText(query, "range")) : 30;
  const end = addDays(todaySgt(), -1);
  const start = addDays(end, 1 - days);
  const providerParam = queryText(query, "provider");
  const provider = AI_PROVIDERS.includes(providerParam as AiProvider) ? providerParam as AiProvider : null;
  const activity = site && !ctx.demo && (tab === "visibility" || tab === "questions")
    ? await staffTx(access, async (db) => {
      const summary = await loadAiActivity(db, { clientId: site.clientId, websiteId: site.id, start, end });
      return {
        summary,
        events: tab === "visibility" && summary.crawlers.status === "covered" ? await listCrawlerEvents(db, { websiteId: site.id, start, end, provider: provider ?? undefined, limit: 100 }) : [],
        sources: tab === "visibility" ? await listCrawlerSources(db, site.id) : [],
      };
    })
    : null;
  const nlweb = site && !ctx.demo && tab === "access" ? await staffTx(access, (db) => readNlweb(db, site.id)) : null;
  const notice = queryText(query, "notice");
  const reason = queryText(query, "reason");
  const ingestUrl = site ? `${process.env.AUTH_URL ?? ""}/api/public/crawler-events/${site.id}` : "";
  return (
    <SeoFrame
      ctx={ctx}
      pathname="/seo/ai-visibility"
      currentTab={tab}
      title="AI Visibility"
      description="Crawler visits, AI referral sessions and saved answer tests are separate measures. AI Access reads the website’s robots.txt and llms.txt and tests its NLWeb endpoint."
      // D79: the AI visibility group: these tabs plus the AI Report, which lives on the Reports route.
      tabs={AI_SECTION_TABS}
    >
      {notice && AI_NOTICES[notice] && <div className="mb-4"><Notice tone="neutral">{AI_NOTICES[notice]}{reason ? ` ${reason}` : ""}</Notice></div>}
      {ctx.demo ? <DemoNote>No sample mentions, citations or crawler totals are shown.</DemoNote> : tab === "visibility" ? (
        site && activity ? (
          <AiActivityPanel
            websiteId={site.id}
            days={days}
            activity={activity.summary}
            events={activity.events}
            provider={provider}
            sources={activity.sources}
            canManageSources={canWriteConnectionSecrets(access)}
            canPrepare={canManageRegistry(access)}
            ingestUrl={ingestUrl}
          />
        ) : null
      ) : tab === "questions" ? (
        site && activity ? (
          <div className="space-y-5">
            {canEditClient(access, site.clientId) && (
              <Card>
                <CardHeader title="Save an external answer test" description="Record a question asked in ChatGPT, Gemini or Claude and whether the answer mentioned the clinic. A positive test counts as a tracked mention." />
                <div className="px-5 pb-5"><AnswerTestForm websiteId={site.id} today={todaySgt()} /></div>
              </Card>
            )}
            <Unavailable title="Automated answer tests are not connected">Questions are not sent to any AI provider from Genie Works, so no provider budget is spent. Saved tests are recorded by staff.</Unavailable>
          </div>
        ) : null
      ) : tab === "sources" ? (
        <Unavailable title="No saved answers">Source links, competitor appearances and descriptions of the clinic are unavailable. Nothing has been flagged for factual review.</Unavailable>
      ) : (
        <div className="space-y-4">
          {site ? (
            <AiAccessPanel clientId={site.clientId} websiteId={site.id} canCheck={canEditClient(access, site.clientId)} checks={checks} notice={queryText(query, "notice")} />
          ) : <Unavailable title="Choose a website">Select a client website to see its AI crawler access.</Unavailable>}
          {site && nlweb && <NlwebPanel websiteId={site.id} nlweb={nlweb} canEdit={canEditClient(access, site.clientId)} canConfigure={canPublishClient(access, site.clientId)} />}
          <Unavailable title="llms.txt is not edited here">Editing, custom mode and publication stay on the website itself.</Unavailable>
        </div>
      )}
    </SeoFrame>
  );
}
