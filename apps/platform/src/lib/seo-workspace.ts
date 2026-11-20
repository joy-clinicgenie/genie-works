import {
  addDays,
  canEditClient,
  canPublishClient,
  formatDateTime,
  getGoogleSiteVerification,
  readSitemapStatus,
  hasActiveSeoSiteToken,
  getClient,
  listActiveWebsiteSummaries,
  listConnections,
  listSeoBusinessProfiles,
  listSeoChanges,
  listSeoPageSettings,
  listSeoPages,
  listSeoRedirects,
  gscDueWindow,
  listTasks,
  listWebsites,
  scopeWorkspace,
  type AccessProfile,
  type PoolClient,
  type SeoBusinessProfileRow,
  type SeoChangeRow,
  type SeoPageRow,
  type SeoPageSettingRow,
  type SeoRedirectRow,
  type TaskRow,
  type WebsiteRow,
} from "@clinic-genie/db";
import { TASK_STATUSES } from "@clinic-genie/contracts";
import { cookies } from "next/headers";
import { staffTx } from "@/lib/db";
import { shellClients } from "@/lib/client-registry";
import { clientLabel } from "@/lib/client-label";
import { SEO_WEBSITE_COOKIE, savedWebsiteId } from "@/lib/seo-scope";

export type SeoSearch = Record<string, string | string[] | undefined>;

export interface SeoSite {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  url: string | null;
  platform: string;
  environment: WebsiteRow["environment"];
  status: WebsiteRow["status"];
}

export interface SeoContext {
  clients: Array<{ id: string; name: string }>;
  sites: SeoSite[];
  selected: SeoSite | null;
  demo: boolean;
  demoConflict: boolean;
  client?: string;
  website?: string;
  contextNote?: string;
  /** The remembered website is no longer readable, so the browser should forget it. */
  savedUnavailable?: boolean;
}

export interface SetupCheck {
  title: string;
  detail: string;
  status: "ready" | "attention" | "unverified";
}

export interface SearchConsoleConnection {
  status: string;
  propertyId: string;
}

export interface WebsiteSeoBundle {
  pages: SeoPageRow[];
  unassignedPages: number;
  changes: SeoChangeRow[];
  tasks: TaskRow[];
  settings: SeoPageSettingRow[];
  redirects: SeoRedirectRow[];
  profiles: SeoBusinessProfileRow[];
  verification: string | null;
  searchConsole: SearchConsoleConnection | null;
  connected: boolean;
  checks: SetupCheck[];
  canEdit: boolean;
  canPublish: boolean;
}

export function pickSearchConsole(
  rows: Array<{ website_id: string; provider: string; status: string; external_property_id: string; disconnected_at: Date | null }>,
  websiteId: string,
): SearchConsoleConnection | null {
  const active = rows.filter((row) => row.website_id === websiteId && row.provider === "gsc" && row.disconnected_at === null && row.status !== "disconnected");
  const chosen = active.find((row) => row.status === "connected") ?? active[0];
  return chosen ? { status: chosen.status, propertyId: chosen.external_property_id } : null;
}

export function searchConsoleCapability(search: SearchConsoleConnection | null, verification: string | null): string {
  const tag = verification ? " Can publish an HTML verification tag." : "";
  if (search?.status === "connected") return `Connected to ${search.propertyId}. Can read search reports and check whether a known page is indexed.${tag}`;
  if (search?.status === "reconnect_required") return `Reconnect required for ${search.propertyId}. Cannot read search reports or check index status until the account is connected again.${tag}`;
  return `Not connected. Cannot read search reports or check index status.${tag}`;
}

export interface GoogleControls {
  range: "7" | "30" | "90" | "custom";
  metric: "clicks" | "impressions" | "ctr" | "position";
  record: "pages" | "queries";
  direction: "increased" | "decreased";
  changeMetric: "clicks" | "impressions";
  from?: string;
  to?: string;
}

export function selectedTab(value: string | undefined, tabs: ReadonlyArray<readonly [string, string]>, fallback: string): string {
  return tabs.some(([id]) => id === value) ? value ?? fallback : fallback;
}

export function queryText(query: SeoSearch, key: string): string | undefined {
  const value = query[key];
  return Array.isArray(value) ? value[0] : value;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function seoHref(path: string, ctx: Pick<SeoContext, "client" | "website" | "demo">, extra?: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  if (ctx.demo) params.set("demo", "1");
  else {
    if (ctx.client) params.set("client", ctx.client);
    if (ctx.website) params.set("website", ctx.website);
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) params.set(key, value);
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export function readGoogleControls(query: SeoSearch): GoogleControls {
  const range = one(query.range);
  const metric = one(query.metric);
  const record = one(query.record);
  const direction = one(query.direction);
  const changeMetric = one(query.changeMetric);
  return {
    range: range === "7" || range === "90" || range === "custom" ? range : "30",
    metric: metric === "impressions" || metric === "ctr" || metric === "position" ? metric : "clicks",
    record: record === "queries" ? "queries" : "pages",
    direction: direction === "increased" ? "increased" : "decreased",
    changeMetric: changeMetric === "impressions" ? "impressions" : "clicks",
    from: one(query.from),
    to: one(query.to),
  };
}

/** The overview range, ending on the latest Pacific day Search Console has published. */
export function searchConsoleWindow(controls: GoogleControls, now = new Date()): { start: string; end: string } | null {
  const end = gscDueWindow(now).end;
  if (controls.range === "custom") {
    if (!controls.from || !controls.to || controls.from > controls.to) return null;
    const boundedEnd = controls.to < end ? controls.to : end;
    if (controls.from > boundedEnd) return null;
    return { start: controls.from, end: boundedEnd };
  }
  const days = controls.range === "7" ? 7 : controls.range === "90" ? 90 : 30;
  return { start: addDays(end, 1 - days), end };
}

/** The website remembered from the last SEO visit (D60). Only a request; it is resolved like a URL value. */
async function savedSeoWebsite(): Promise<string | undefined> {
  return savedWebsiteId((await cookies()).get(SEO_WEBSITE_COOKIE)?.value);
}

export async function loadSeoContext(access: AccessProfile, query: SeoSearch): Promise<SeoContext> {
  const saved = await savedSeoWebsite();
  return staffTx(access, (db) => loadSeoContextWithDb(db, query, saved));
}

/**
 * Resolves the SEO selection on the server for every request (SEO-01.1). The URL wins. Without a website in
 * the URL, the remembered website is used when the staff member can still read it and it fits the URL clinic.
 */
export async function loadSeoContextWithDb(db: PoolClient, query: SeoSearch, saved?: string): Promise<SeoContext> {
  const client = one(query.client);
  const urlWebsite = one(query.website);
  const demo = false;
  // Copied, because an unlisted client is unshifted onto it below and the registry read is shared.
  const records = [...await shellClients(db)];
  if (client && !records.some((item) => item.id === client)) {
    const extra = await getClient(db, client);
    if (extra) records.unshift({
      id: extra.id,
      name: extra.name,
      slug: extra.slug,
      reference_number: extra.reference_number,
      short_code: extra.short_code,
      public_name: extra.public_name,
      legal_name: extra.legal_name,
      specialty: extra.specialty,
    });
  }
  const websites = await listActiveWebsiteSummaries(db);
  const sites = websites.map((site): SeoSite => ({
    id: site.id,
    clientId: site.client_id,
    clientName: clientLabel({ name: site.client_name, reference_number: site.reference_number }),
    name: site.name,
    url: site.url,
    platform: site.platform,
    environment: site.environment,
    status: site.status,
  }));
  const extraClient = client ? records.find((item) => item.id === client) : undefined;
  if (extraClient && !sites.some((site) => site.clientId === extraClient.id)) {
    const extras = await listWebsites(db, extraClient.id);
    for (const site of extras) {
      if (site.status !== "active") continue;
      sites.push({
        id: site.id,
        clientId: extraClient.id,
        clientName: clientLabel(extraClient),
        name: site.name,
        url: site.url,
        platform: site.platform,
        environment: site.environment,
        status: site.status,
      });
    }
  }
  const savedSite = !urlWebsite && saved ? sites.find((site) => site.id === saved && (!client || site.clientId === client)) : undefined;
  const website = urlWebsite ?? savedSite?.id;
  const savedUnavailable = Boolean(!urlWebsite && saved && !sites.some((site) => site.id === saved));
  const loaded = {
    clients: records.map((item) => ({ id: item.id, name: clientLabel(item) })),
    sites,
  };
  const demoConflict = demo && Boolean(client || website);
  const selection = scopeWorkspace({
    requestedClientId: client,
    requestedWebsiteId: website,
    clients: loaded.clients,
    websites: loaded.sites.map((site) => ({ id: site.id, clientId: site.clientId })),
  });
  const selected = demo || demoConflict ? null : loaded.sites.find((site) => site.id === selection.websiteId) ?? null;
  const contextNote = selection.denied
    ? "That client is not available."
    : selection.websiteReplaced
      ? client ? "That website is not part of the selected client." : "That website is not available to you. Choose a website."
      : savedUnavailable && !client
        ? "The website you last opened is no longer available to you. Choose a website."
        : undefined;
  return {
    ...loaded,
    selected,
    demo,
    demoConflict,
    client: selection.denied ? undefined : selection.clientId ?? selected?.clientId ?? undefined,
    website: selected?.id,
    contextNote,
    savedUnavailable,
  };
}

export function setupChecks(input: {
  codeManaged: boolean;
  connected: boolean;
  pageSettingCount: number;
  redirectCount: number;
  verification: string | null;
  searchConsole: SearchConsoleConnection | null;
  profiles: SeoBusinessProfileRow[];
  /** The latest full sitemap pass (SEO-04.1, D62). */
  sitemapPass?: { checkedAt: Date; urlCount: number } | null;
}): SetupCheck[] {
  const checks: SetupCheck[] = [
    {
      title: "Business details",
      detail: "Clinic and website records supply the name and domain used by SEO screens.",
      status: "ready",
    },
    {
      title: "Published page SEO settings",
      detail: input.connected
        ? input.pageSettingCount ? `${input.pageSettingCount} route override(s) saved. Rendered HTML is not crawled by this checklist.` : "No route overrides saved. Code-defined titles may still appear on the website."
        : "Connect the website with its API credential before Genie Works settings can reach it.",
      status: input.connected && input.pageSettingCount > 0 ? "unverified" : "attention",
    },
    {
      title: "Individual 301 redirects",
      detail: input.connected
        ? `${input.redirectCount} active redirect(s) saved. Rules reach a connected Next.js site through the published settings API.`
        : "The redirect editor is available, but this website has no published-settings credential.",
      status: input.connected ? "unverified" : "attention",
    },
    input.sitemapPass
      ? {
        title: "Domain, sitemap and robots.txt",
        detail: `The live sitemap was read in full on ${formatDateTime(input.sitemapPass.checkedAt)} and lists ${input.sitemapPass.urlCount} URL(s). robots.txt is shown on Site Health, Crawl Settings.`,
        status: "ready",
      }
      : {
        title: "Domain, sitemap and robots.txt",
        detail: input.codeManaged
          ? "Supported clinic-site code can generate a sitemap and robots.txt. No full sitemap pass is recorded; check it on Site Health, Crawl Settings."
          : "Sitemap and robots.txt behaviour depends on this website platform. No full sitemap pass is recorded; check it on Site Health, Crawl Settings.",
        status: input.codeManaged ? "unverified" : "attention",
      },
    {
      title: "Google Search Console",
      detail: input.searchConsole?.status === "connected"
        ? `Connected to ${input.searchConsole.propertyId}. Search reports can be read. Site Health can check whether a known page is indexed.${input.verification ? " An HTML verification token is saved for publishing." : ""}`
        : input.verification
          ? "An HTML verification token is saved for publishing. Ownership still has to be confirmed in Google Search Console. Search reports are not connected."
          : "No Search Console property is connected.",
      status: input.searchConsole?.status === "connected" ? "ready" : input.verification ? "unverified" : "attention",
    },
  ];
  if (input.profiles.length === 0) {
    checks.push({ title: "Google Business Profile", detail: "No branch reference is recorded. This does not connect a Google location.", status: "attention" });
  }
  for (const profile of input.profiles) {
    checks.push({
      title: `Location reference · ${profile.branch_name}`,
      detail: profile.setup_status === "staff_marked_verified"
        ? "A staff member marked this reference verified. Google has not confirmed it."
        : profile.setup_status === "in_progress" ? "The internal reference is in progress." : "The internal reference has not been started.",
      status: profile.setup_status === "not_started" ? "attention" : "unverified",
    });
  }
  return checks;
}

export async function loadWebsiteSeo(access: AccessProfile, site: SeoSite): Promise<WebsiteSeoBundle> {
  const loaded = await staffTx(access, (db) => loadWebsiteSeoData(db, site));
  return websiteSeoBundle(access, site, loaded);
}

async function loadWebsiteSeoData(db: PoolClient, site: SeoSite) {
  // A pg client executes one statement at a time. Keep these ordered rather
  // than starting unsupported concurrent queries on the same transaction.
  const pages = await listSeoPages(db, { clientId: site.clientId });
  const changes = await listSeoChanges(db, { clientId: site.clientId, limit: 100 });
  const tasks = await listTasks(db, { clientId: site.clientId, statuses: [...TASK_STATUSES], limit: 300 });
  const settings = await listSeoPageSettings(db, { websiteId: site.id });
  const redirects = await listSeoRedirects(db, { clientId: site.clientId, websiteId: site.id, includeInactive: true });
  const profiles = await listSeoBusinessProfiles(db, site.clientId);
  const verification = await getGoogleSiteVerification(db, site.id);
  const connections = await listConnections(db, site.clientId);
  const connected = await hasActiveSeoSiteToken(db, site.id);
  const sitemap = await readSitemapStatus(db, site.id);
  return { pages, changes, tasks, settings, redirects, profiles, verification, searchConsole: pickSearchConsole(connections, site.id), connected, sitemap };
}

function websiteSeoBundle(access: AccessProfile, site: SeoSite, loaded: Awaited<ReturnType<typeof loadWebsiteSeoData>>): WebsiteSeoBundle {
  const selectedPages = loaded.pages.filter((page) => page.website_id === site.id);
  const pageIds = new Set(selectedPages.map((page) => page.id));
  const codeManaged = site.platform.toLowerCase().includes("next");
  return {
    pages: selectedPages,
    unassignedPages: loaded.pages.filter((page) => page.website_id !== site.id).length,
    changes: loaded.changes.filter((change) => pageIds.has(change.seo_page_id)),
    tasks: loaded.tasks.filter((task) => task.related_type === "seo_page" || task.related_type === "seo_change"),
    settings: loaded.settings,
    redirects: loaded.redirects,
    profiles: loaded.profiles,
    verification: loaded.verification,
    searchConsole: loaded.searchConsole,
    connected: loaded.connected,
    checks: setupChecks({
      codeManaged,
      connected: loaded.connected,
      pageSettingCount: loaded.settings.length,
      redirectCount: loaded.redirects.filter((rule) => rule.active).length,
      verification: loaded.verification,
      searchConsole: loaded.searchConsole,
      profiles: loaded.profiles,
      sitemapPass: loaded.sitemap.latestPass ? { checkedAt: loaded.sitemap.latestPass.checkedAt, urlCount: loaded.sitemap.latestPass.urlCount } : null,
    }),
    canEdit: canEditClient(access, site.clientId),
    canPublish: canPublishClient(access, site.clientId),
  };
}

export function environmentLabel(environment: WebsiteRow["environment"]): "Production" | "Preview" | "Development" {
  if (environment === "production") return "Production";
  if (environment === "staging") return "Preview";
  return "Development";
}
