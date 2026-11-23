"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  canEditClient,
  checkSitemap,
  evaluateRedirect,
  finishSiteCheckRun,
  localRequestPath,
  readLatestRobots,
  readRobotsFile,
  recordRedirectCheck,
  recordRobotsCheck,
  recordSitemapCheck,
  routeKey,
  runSiteChecks,
  siteCheckTargets,
  siteOrigin,
  sitemapTarget,
  startSiteCheckRun,
  traceRedirects,
  type AccessProfile,
  type PageCheckResult,
} from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { serviceTx, staffTx } from "@/lib/db";
import { str } from "@/lib/actions";
import { aiAccessFetcher } from "@/lib/ai-access-fetch";
import { isWebsiteId } from "@/lib/seo-scope";
import { loadSeoContextWithDb, type SeoSite } from "@/lib/seo-workspace";

const USER_AGENT = "GenieWorks-SiteCheck/1.0";

function back(path: string, websiteId: string, tab: string, notice: string, extra: Record<string, string> = {}): never {
  redirect(`${path}?${new URLSearchParams({ website: websiteId, tab, notice, ...extra })}`);
}

/**
 * The selected website, re-resolved on the server for this staff member (D62). Checks need edit access and a
 * public address; the address always comes from the registry, never from the request.
 */
async function editableSite(access: AccessProfile, websiteId: string): Promise<{ site: SeoSite; origin: string } | "denied" | "missing_url"> {
  if (!isWebsiteId(websiteId)) return "denied";
  const site = await staffTx(access, async (db) => (await loadSeoContextWithDb(db, { website: websiteId })).selected);
  if (!site || site.id !== websiteId || !canEditClient(access, site.clientId)) return "denied";
  const origin = siteOrigin(site.url);
  return origin ? { site, origin } : "missing_url";
}

/** SEO-04.2: reads /robots.txt with up to five redirects and 500 KiB, as Google does. */
export async function checkRobotsAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const access = await requireAccess();
  const scoped = await editableSite(access, websiteId);
  if (typeof scoped === "string") back("/seo/site-health", websiteId, "crawl", scoped);
  const fetcher = aiAccessFetcher({ userAgent: USER_AGENT, accept: "text/plain, */*;q=0.1", maxRedirects: 5, maxBytes: 500 * 1024, truncate: true });
  const reading = await readRobotsFile(fetcher, scoped.origin);
  await serviceTx((db) => recordRobotsCheck(db, { clientId: scoped.site.clientId, websiteId, reading, actorUserId: access.user.id }));
  revalidatePath("/seo/site-health");
  back("/seo/site-health", websiteId, "crawl", "robots_checked");
}

/** SEO-04.1: reads the configured sitemap and, for an index, its files. */
export async function checkSitemapAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const access = await requireAccess();
  const scoped = await editableSite(access, websiteId);
  if (typeof scoped === "string") back("/seo/site-health", websiteId, "crawl", scoped);
  const robots = await staffTx(access, (db) => readLatestRobots(db, websiteId));
  const target = sitemapTarget(scoped.origin, robots?.parsed ?? null);
  const fetcher = aiAccessFetcher({ userAgent: USER_AGENT, accept: "application/xml, text/xml;q=0.9, */*;q=0.1", maxRedirects: 5, maxBytes: 5 * 1024 * 1024, truncate: true });
  const reading = await checkSitemap(fetcher, target.url);
  await serviceTx((db) => recordSitemapCheck(db, { clientId: scoped.site.clientId, websiteId, source: target.source, reading, actorUserId: access.user.id }));
  revalidatePath("/seo", "layout");
  back("/seo/site-health", websiteId, "crawl", "sitemap_checked");
}

/** SEO-04.3: one run over the home page and known public pages. One run per website at a time. */
export async function runWebsiteCheckAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const access = await requireAccess();
  const scoped = await editableSite(access, websiteId);
  if (typeof scoped === "string") back("/seo/site-health", websiteId, "checks", scoped);
  const { site } = scoped;
  const runId = await serviceTx((db) => startSiteCheckRun(db, { clientId: site.clientId, websiteId, actorUserId: access.user.id }));
  if (!runId) back("/seo/site-health", websiteId, "checks", "already_running");
  const targets = await staffTx(access, (db) => siteCheckTargets(db, websiteId, site.url));
  let results: PageCheckResult[];
  try {
    const fetcher = aiAccessFetcher({ userAgent: USER_AGENT, accept: "text/html, application/xhtml+xml;q=0.9, */*;q=0.1", maxRedirects: 5, truncate: true });
    results = await runSiteChecks(fetcher, targets);
  } catch {
    // The run is still closed, with every page skipped, so it cannot block the next run.
    results = targets.map((target) => ({ pagePath: target.pagePath, url: target.url, outcome: "skipped", reason: "check_error", httpStatus: null, findings: [] }));
  }
  await serviceTx((db) => finishSiteCheckRun(db, { runId, clientId: site.clientId, websiteId, results }));
  revalidatePath("/seo", "layout");
  back("/seo/site-health", websiteId, "checks", "run_completed");
}

/** SEO-04.4: follows each redirect hop of an old path without changing anything on the website. */
export async function checkRedirectAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const sourcePath = localRequestPath(str(formData, "sourcePath"));
  const expected = localRequestPath(str(formData, "expectedPath"));
  const access = await requireAccess();
  const scoped = await editableSite(access, websiteId);
  if (typeof scoped === "string") back("/seo/redirects", websiteId, "redirects", scoped);
  if (!sourcePath || !expected) back("/seo/redirects", websiteId, "redirects", "invalid_path");
  const expectedPath = routeKey(expected)!;
  const trace = await traceRedirects(aiAccessFetcher({ userAgent: USER_AGENT, accept: "text/html, */*;q=0.1", manualRedirects: true }), `${scoped.origin}${sourcePath}`);
  const evaluation = evaluateRedirect(trace, expectedPath);
  await serviceTx((db) => recordRedirectCheck(db, { clientId: scoped.site.clientId, websiteId, sourcePath, expectedPath, trace, evaluation, actorUserId: access.user.id }));
  revalidatePath("/seo/redirects");
  back("/seo/redirects", websiteId, "redirects", "redirect_checked", { checked: sourcePath });
}
