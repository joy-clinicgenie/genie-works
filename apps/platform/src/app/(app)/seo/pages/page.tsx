import Link from "next/link";
import { CONTENT_STATUSES } from "@clinic-genie/contracts";
import { todaySgt } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { FilterBar, FilterSelect } from "@/components/ui/Filters";
import { label } from "@/components/ui/Badge";
import { SeoPageTable } from "@/components/modules/SeoList";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { loadSeoContext, loadWebsiteSeo, queryText, selectedTab, seoHref, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pages and content" };

const TABS = [
  ["pages", "Pages"],
  ["images", "Images"],
  ["keywords", "Keywords & Planning"],
  ["templates", "Templates"],
] as const;

export default async function SeoPagesPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const bundle = ctx.selected ? await loadWebsiteSeo(access, ctx.selected) : null;
  const tab = selectedTab(queryText(query, "tab"), TABS, "pages");
  const status = queryText(query, "status");
  const missing = queryText(query, "missing");
  const pages = (bundle?.pages ?? []).filter((page) => !status || page.content_status === status).filter((page) => missing !== "1" || !page.page_title || !page.primary_keyword);
  return (
    <SeoFrame
      ctx={ctx}
      pathname="/seo/pages"
      title="Pages & Content"
      description="Manage SEO for mapped public pages. The blog editor remains the article source."
      tabs={TABS}
      currentTab={tab}
      action={bundle?.canEdit ? <LinkButton href={seoHref("/seo/new", ctx)}>Map a page</LinkButton> : undefined}
    >
      {ctx.demo ? <DemoNote>Page, image, keyword and template samples are not shown.</DemoNote> : bundle && tab === "pages" ? (
        <>
          <FilterBar action="/seo/pages" clearHref={seoHref("/seo/pages", ctx, { tab })}>
            <input type="hidden" name="client" value={ctx.client} />
            <input type="hidden" name="website" value={ctx.website} />
            <input type="hidden" name="tab" value="pages" />
            <FilterSelect name="status" label="Publication status" value={status} options={CONTENT_STATUSES.map((item) => ({ value: item, label: label(item) }))} />
            <FilterSelect name="missing" label="Missing fields" value={missing} allLabel="All pages" options={[{ value: "1", label: "Missing title or keyword" }]} />
          </FilterBar>
          {bundle.unassignedPages > 0 && <p className="mb-3 text-sm text-muted">{bundle.unassignedPages} mapped page(s) belong to another website or have no website, so they are not listed here.</p>}
          <Card><SeoPageTable pages={pages} today={todaySgt()} showClient={false} emptyMessage="No pages are mapped to this website." /></Card>
          <p className="mt-3 text-xs text-muted">{pages.length} page(s) match the current filters. Indexing and description status are on each page. Select a page to review its changes.</p>
        </>
      ) : tab === "images" ? (
        <Unavailable title="Image descriptions are not connected">The platform does not yet read images from the website. Missing alt text, decorative images and oversized files cannot be detected. CSS backgrounds have no HTML alt text. No descriptions have been changed.</Unavailable>
      ) : tab === "keywords" ? (
        <Card>
          <CardHeader title="Keywords and planning" description="No keyword provider is connected, so volume, difficulty and trend are unavailable rather than estimated." />
          <div className="space-y-3 px-5 pb-5 text-sm text-muted">
            <p>Saved keyword lists, topic-to-page maps, observed questions and content briefs have no store yet.</p>
            <p>Mapped pages already record a primary keyword. Open a page before creating a new article.</p>
            <Link href="/blog" className="text-action hover:underline">Open the blog module</Link>
          </div>
        </Card>
      ) : (
        <Unavailable title="Templates are not stored">Defaults by page type, variables, social patterns and schema templates are not configured. Individual page mappings are unchanged. Applying a template cannot be simulated.</Unavailable>
      )}
    </SeoFrame>
  );
}
