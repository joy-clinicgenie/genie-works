import { redirect } from "next/navigation";
import {
  findInventoryPage,
  getSeoPage,
  inspectionUrlFor,
  loadPageEvidence,
  loadWebsiteConnections,
  propertyCovers,
  type AccessProfile,
  type InventoryPage,
  type PageEvidence,
  type WebsiteConnectionCard,
} from "@clinic-genie/db";
import { staffTx } from "@/lib/db";
import { isWebsiteId } from "@/lib/seo-scope";
import { loadSeoContext, queryText, type SeoContext, type SeoSearch } from "@/lib/seo-workspace";

export const SEO_PAGES_TABS = [
  ["pages", "Pages"],
  ["images", "Images"],
  ["keywords", "Keywords & Planning"],
  ["templates", "Templates"],
] as const;

export interface ScopedPageDetail {
  page: InventoryPage;
  evidence: PageEvidence;
  search: WebsiteConnectionCard;
  url: string | null;
  urlInProperty: boolean;
  mapping: Awaited<ReturnType<typeof getSeoPage>>;
}

/**
 * Resolves a page for the SEO-03 screens (D61). The page must belong to the selected website and environment;
 * otherwise `detail` is null and no page data is read. A legacy link to a mapped page without a website is sent
 * to that page's own website, which row-level security has already allowed.
 */
export async function loadScopedPageDetail(access: AccessProfile, pageId: string, query: SeoSearch, view: "" | "/inspection"): Promise<{ ctx: SeoContext; detail: ScopedPageDetail | null }> {
  if (!queryText(query, "website") && isWebsiteId(pageId)) {
    const mapped = await staffTx(access, (db) => getSeoPage(db, pageId));
    if (mapped?.website_id) redirect(`/seo/pages/${pageId}${view}?${new URLSearchParams({ website: mapped.website_id })}`);
  }
  const ctx = await loadSeoContext(access, query);
  const site = ctx.selected;
  if (!site || !isWebsiteId(pageId)) return { ctx, detail: null };
  const detail = await staffTx(access, async (db) => {
    const page = await findInventoryPage(db, site.id, pageId);
    if (!page) return null;
    const connections = await loadWebsiteConnections(db, site.id);
    const url = inspectionUrlFor(site.url, page.path);
    const search = connections!.cards.search;
    return {
      page,
      evidence: await loadPageEvidence(db, page),
      search,
      url,
      urlInProperty: Boolean(url && search.property && search.state !== "disconnected" && propertyCovers(search.property, url)),
      mapping: page.mapped ? await getSeoPage(db, page.mapped.id) : null,
    };
  });
  return { ctx, detail };
}
