import { requireAccess } from "@/lib/session";
import { Card, CardHeader } from "@/components/ui/Card";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
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
  return (
    <SeoFrame ctx={ctx} pathname="/seo/ai-visibility" title="AI Visibility" description="Sampled answers, AI traffic and public AI access are separate. No provider is connected." tabs={TABS} currentTab={tab}>
      {ctx.demo ? <DemoNote>No sample mentions, citations or crawler totals are shown.</DemoNote> : tab === "visibility" ? (
        <Unavailable title="No visibility test has been run">Direct mentions, citations and referral sessions are unavailable. A missing test is not a negative mention, and no platform is listed without a connected result.</Unavailable>
      ) : tab === "questions" ? (
        <Unavailable title="No question library">Questions, branded or unbranded classification, model, cost and run history are not stored. Run test is unavailable, so it cannot spend a provider budget or report success.</Unavailable>
      ) : tab === "sources" ? (
        <Unavailable title="No saved answers">Source links, competitor appearances and descriptions of the clinic are unavailable. Nothing has been flagged for factual review.</Unavailable>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Crawler summary" description="A crawler visit is not a citation and not a user question." />
            <p className="px-5 pb-5 text-sm text-muted">No crawler log is connected, so ChatGPT, Gemini, Perplexity and Claude are not listed.</p>
          </Card>
          <Unavailable title="llms.txt is not managed here">View, edit, custom mode, publication and verification are unavailable.</Unavailable>
          <Unavailable title="NLWeb is not implemented">Compatibility, public sources and query tests are unavailable. Private enquiries and unpublished content are not sent anywhere from this screen.</Unavailable>
        </div>
      )}
    </SeoFrame>
  );
}
