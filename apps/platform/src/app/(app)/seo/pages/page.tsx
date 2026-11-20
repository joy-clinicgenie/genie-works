import Link from "next/link";
import { effectivePageSeo, listLatestInspections, listPageInventory, loadWebsiteConnections, searchInventory } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { FilterBar, FilterInput } from "@/components/ui/Filters";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { Table, Td, Th } from "@/components/ui/Table";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { loadSeoContext, loadWebsiteSeo, queryText, selectedTab, seoHref, type SeoSearch } from "@/lib/seo-workspace";
import { indexingLabel, pageSourceLabel, verdictLabel, verdictTone } from "@/lib/seo-pages-view";

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
  const search = queryText(query, "q");
  const site = ctx.selected;
  // SEO-03.1: the inventory of the selected website and environment only (D61).
  const inventory = site && tab === "pages"
    ? await staffTx(access, async (db) => ({
      pages: await listPageInventory(db, site.id),
      google: await listLatestInspections(db, site.id),
      searchState: (await loadWebsiteConnections(db, site.id))?.cards.search.state ?? "not_connected",
    }))
    : null;
  // SEO-01.5 (D67): a quick action that needs a target page opens this list as the page picker.
  const pick = queryText(query, "pick") === "inspect" ? "inspect" : queryText(query, "pick") === "settings" ? "settings" : null;
  const pages = inventory ? searchInventory(inventory.pages, search) : [];
  const pageHref = (id: string, view: "" | "/inspection") => `/seo/pages/${id}${view}?${new URLSearchParams({ website: site?.id ?? "" })}`;
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
      {ctx.demo ? <DemoNote>Page, image, keyword and template samples are not shown.</DemoNote> : bundle && site && inventory && tab === "pages" ? (
        <>
          {pick && (
            <div className="mb-4" data-pick={pick}>
              <Notice tone="neutral" title={pick === "inspect" ? "Choose a page to inspect" : "Choose a page to edit"}>
                {pick === "inspect" ? "Use Inspect on a row below to read Google's indexing status for that page." : "Use Settings on a row below to edit that page's title, description and indexing preference."}
                {pick === "inspect" && inventory.searchState !== "connected" && <> Search Console is not connected for this website, so Google cannot be asked yet. <Link href={seoHref("/seo/settings", ctx, { tab: "connections" })} className="text-action hover:underline">Open Website Connections</Link></>}
              </Notice>
            </div>
          )}
          {queryText(query, "notice") === "page_unavailable" && <div className="mb-4"><Notice tone="neutral">That page is not part of the selected website and environment.</Notice></div>}
          <FilterBar action="/seo/pages" clearHref={seoHref("/seo/pages", ctx, { tab })}>
            <input type="hidden" name="website" value={site.id} />
            <input type="hidden" name="tab" value="pages" />
            <FilterInput name="q" label="Search by page title or URL path" value={search} placeholder="Consultation or /services/consultation" className="sm:min-w-80" />
          </FilterBar>
          {inventory.pages.length === 0 ? (
            <EmptyState
              title="No known pages for this website"
              action={bundle.canEdit ? <LinkButton href={seoHref("/seo/new", ctx)}>Map a page</LinkButton> : undefined}
            >
              Pages appear here when they are mapped in Genie Works, have saved page settings or are live blog articles. The home page appears once the website has a public address. Genie Works does not crawl the website for other routes.
            </EmptyState>
          ) : pages.length === 0 ? (
            <EmptyState title="No page matches that search">Search by part of the page title or the URL path, for example /services.</EmptyState>
          ) : (
            <Card>
              <Table caption="Known pages for the selected website">
                <thead>
                  <tr><Th>Page</Th><Th>Source</Th><Th>SEO title</Th><Th>Indexing preference</Th><Th>Google</Th><Th>Actions</Th></tr>
                </thead>
                <tbody>
                  {pages.map((page) => {
                    const effective = effectivePageSeo(page);
                    const google = inventory.google.get(page.path);
                    return (
                      <tr key={page.id} data-page-id={page.id}>
                        <Td>
                          <div className="font-medium">{page.title ?? "Untitled page"}</div>
                          <div className="text-xs text-muted break-all">{page.path}</div>
                        </Td>
                        <Td><span className="flex flex-wrap gap-1">{page.sources.map((source) => <Badge key={source}>{pageSourceLabel(source)}</Badge>)}</span></Td>
                        <Td>{effective.title.value ?? <span className="text-muted">Website default</span>}{effective.title.source === "override" && <span className="ml-1 text-xs text-muted">(override)</span>}</Td>
                        <Td>{indexingLabel(effective.indexable.value)}</Td>
                        <Td>{google ? <Badge tone={verdictTone(google.verdict)}>{verdictLabel(google.verdict)}</Badge> : <span className="text-muted">Not inspected</span>}</Td>
                        <Td>
                          <span className="flex flex-wrap gap-3">
                            <Link href={pageHref(page.id, "")} className="text-action hover:underline" aria-label={`Settings for ${page.path}`}>Settings</Link>
                            <Link href={pageHref(page.id, "/inspection")} className="text-action hover:underline" aria-label={`Inspect ${page.path}`}>Inspect</Link>
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          )}
          <p className="mt-3 text-xs text-muted">{pages.length} of {inventory.pages.length} page(s) shown. Equivalent URLs, such as a trailing slash or a query string, are listed once.</p>
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
