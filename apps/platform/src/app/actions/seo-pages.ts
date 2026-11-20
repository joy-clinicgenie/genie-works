"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AiAccessFetchError,
  canEditClient,
  findInventoryPage,
  inspectionUrlFor,
  loadInspectionTarget,
  parseLiveHead,
  recordLiveCheck,
  recordUrlInspection,
  runUrlInspection,
  type AccessProfile,
  type InventoryPage,
} from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { serviceTx, staffTx } from "@/lib/db";
import { str } from "@/lib/actions";
import { aiAccessFetcher } from "@/lib/ai-access-fetch";
import { providerFetch } from "@/lib/provider-fetch";
import { isWebsiteId } from "@/lib/seo-scope";
import { loadSeoContextWithDb, type SeoSite } from "@/lib/seo-workspace";

function pageHref(pageId: string, websiteId: string, view: "settings" | "inspection", notice?: string): string {
  const params = new URLSearchParams({ website: websiteId });
  if (notice) params.set("notice", notice);
  return `/seo/pages/${encodeURIComponent(pageId)}${view === "inspection" ? "/inspection" : ""}?${params}`;
}

/**
 * Resolves the website and page for this staff member on the server (D61). The website must be readable and
 * the page ID must resolve inside that website; otherwise nothing runs.
 */
async function scopedPage(access: AccessProfile, websiteId: string, pageId: string): Promise<{ site: SeoSite; page: InventoryPage } | null> {
  if (!isWebsiteId(websiteId) || !isWebsiteId(pageId)) return null;
  return staffTx(access, async (db) => {
    const ctx = await loadSeoContextWithDb(db, { website: websiteId });
    if (!ctx.selected || ctx.selected.id !== websiteId) return null;
    const page = await findInventoryPage(db, websiteId, pageId);
    return page ? { site: ctx.selected, page } : null;
  });
}

/** Reads the public page from the registry address and stores what it served. Editors only. */
export async function checkLivePageAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const pageId = str(formData, "pageId");
  const access = await requireAccess();
  const scoped = await scopedPage(access, websiteId, pageId);
  if (!scoped || !canEditClient(access, scoped.site.clientId)) redirect(`/seo/pages?${new URLSearchParams({ website: websiteId, notice: "page_unavailable" })}`);
  const { site, page } = scoped;
  const url = inspectionUrlFor(site.url, page.path);
  let httpStatus: number | null = null;
  let errorCode: string | null = null;
  let head = null;
  if (!url) {
    errorCode = "missing_url";
  } else {
    try {
      const fetcher = aiAccessFetcher({ userAgent: "GenieWorks-PageCheck/1.0", accept: "text/html, application/xhtml+xml;q=0.9, */*;q=0.1", truncate: true });
      const response = await fetcher(url);
      httpStatus = response.status;
      if (response.status >= 400) errorCode = `http_${response.status}`;
      else if (response.contentType && !/html/i.test(response.contentType)) errorCode = "not_html";
      else head = parseLiveHead(response.body, response.robotsHeader);
    } catch (error) {
      errorCode = error instanceof AiAccessFetchError ? error.code : "network";
    }
  }
  await serviceTx((db) => recordLiveCheck(db, {
    clientId: site.clientId,
    websiteId: site.id,
    pagePath: page.path,
    pageUrl: url ?? page.path,
    httpStatus,
    head,
    errorCode,
    actorUserId: access.user.id,
  }));
  revalidatePath("/seo/pages", "layout");
  redirect(pageHref(page.id, site.id, "settings", errorCode ? "live_failed" : "live_checked"));
}

/**
 * Asks Google what it reports for the page URL (SEO-03.3). The URL is built on the server and must sit inside
 * the mapped Search Console property before anything is sent. Every attempt is stored. Editors only.
 */
export async function inspectPageAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const pageId = str(formData, "pageId");
  const access = await requireAccess();
  const scoped = await scopedPage(access, websiteId, pageId);
  if (!scoped || !canEditClient(access, scoped.site.clientId)) redirect(`/seo/pages?${new URLSearchParams({ website: websiteId, notice: "page_unavailable" })}`);
  const { site, page } = scoped;
  const url = inspectionUrlFor(site.url, page.path);
  const target = await serviceTx((db) => loadInspectionTarget(db, site.id));
  // Provider I/O stays outside a database transaction.
  const outcome = !url
    ? { ok: false as const, code: "missing_url" }
    : !target
      ? { ok: false as const, code: "not_connected" }
      : await runUrlInspection(target, url, {
        fetch: providerFetch(),
        now: new Date(),
        googleClientId: process.env.ANALYTICS_GOOGLE_CLIENT_ID,
        googleClientSecret: process.env.ANALYTICS_GOOGLE_CLIENT_SECRET,
      });
  await serviceTx((db) => recordUrlInspection(db, {
    clientId: site.clientId,
    websiteId: site.id,
    pagePath: page.path,
    inspectionUrl: url,
    property: target?.connection.external_property_id ?? null,
    connectionId: target?.connection.id ?? null,
    outcome,
    actorUserId: access.user.id,
  }));
  revalidatePath("/seo/pages", "layout");
  redirect(pageHref(page.id, site.id, "inspection", outcome.ok ? "inspected" : "inspection_failed"));
}
