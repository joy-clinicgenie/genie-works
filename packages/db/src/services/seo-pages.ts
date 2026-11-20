import { createHash } from "node:crypto";
import type { Queryable } from "../client";
import { decryptSecret, tokenKeyConfigured } from "../analytics/crypto";
import { isInvalidGrant } from "../analytics/providers/ga4";
import { parseInspection, parseInspectionDetail, propertyCovers, publicPageUrl, type InspectionDetail, type InspectionReading } from "../analytics/providers/gsc";
import { freshProviderToken, providerFailureCode, type ConnectionRow, type SyncDeps, type TokenBundle } from "../analytics/sync";
import { isSettingsApiPlatform } from "../analytics/website-connections";

/* SEO-03.1 Page List, SEO-03.2 Page SEO Settings and SEO-03.3 URL Inspection (D61). */

// ---------------------------------------------------------------------------------------------------------
// Route identity

const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

/**
 * The key two paths share when they address the same page. A trailing slash, repeated slashes, a query or
 * fragment, and percent-encoding of unreserved characters do not make a new page. Letter case does.
 * Returns null for anything that is not a safe site-relative path.
 */
export function routeKey(value: string): string | null {
  let text = value.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      text = new URL(text).pathname;
    } catch {
      return null;
    }
  }
  text = text.split(/[?#]/, 1)[0] ?? "";
  if (!text.startsWith("/")) text = `/${text}`;
  if (/\s|\\/.test(text)) return null;
  text = text.replace(/\/{2,}/g, "/");
  text = text.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) => {
    const char = String.fromCharCode(parseInt(hex, 16));
    return UNRESERVED.test(char) ? char : `%${hex.toUpperCase()}`;
  });
  if (text.split("/").some((segment) => segment === "..")) return null;
  if (text.length > 1 && text.endsWith("/")) text = text.slice(0, -1);
  if (text.length > 500) return null;
  return text;
}

/** A stable UUID for a route without a mapped page: the same website and key always give the same ID. */
export function pageRouteId(websiteId: string, key: string): string {
  const hex = createHash("sha256").update(`seo-route:${websiteId}:${key}`).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------------------------------------
// Inventory

export type PageSource = "home" | "mapped" | "setting" | "blog";

export interface InventorySetting {
  id: string;
  pagePath: string;
  title: string | null;
  description: string | null;
  indexable: boolean | null;
  canonicalPath: string | null;
  updatedAt: Date;
  updatedByName: string | null;
}

export interface InventoryPage {
  /** The stable page ID: the oldest mapped page ID, otherwise the route ID. */
  id: string;
  /** Every ID that resolves to this row. */
  aliases: string[];
  clientId: string;
  websiteId: string;
  key: string;
  /** The path used to build the public URL. */
  path: string;
  sources: PageSource[];
  title: string | null;
  mapped: { id: string; pageTitle: string | null; contentStatus: string; primaryKeyword: string | null } | null;
  setting: InventorySetting | null;
  blog: { articleId: string; title: string; seoTitle: string; seoDescription: string; indexable: boolean } | null;
}

interface Building extends Omit<InventoryPage, "id" | "aliases"> {
  mappedIds: string[];
  pathRank: number;
}

/**
 * The page inventory of one website and environment, in the caller's context. Under row-level security an
 * unreadable website returns no pages.
 */
export async function listPageInventory(db: Queryable, websiteId: string): Promise<InventoryPage[]> {
  const site = await db.query<{ id: string; client_id: string; url: string | null }>(
    "select id, client_id, url from websites where id = $1 and archived_at is null",
    [websiteId],
  );
  const website = site.rows[0];
  if (!website) return [];
  const mapped = await db.query<{ id: string; page_path: string; page_title: string | null; content_status: string; primary_keyword: string | null }>(
    `select id, page_path, page_title, content_status, primary_keyword from seo_pages
     where website_id = $1 and archived_at is null and content_status <> 'retired'
     order by created_at, id`,
    [websiteId],
  );
  const settings = await db.query<{ id: string; page_path: string; title: string | null; description: string | null; indexable: boolean | null; canonical_path: string | null; updated_at: Date; updated_by_name: string | null }>(
    `select s.id, s.page_path, s.title, s.description, s.indexable, s.canonical_path, s.updated_at, u.display_name as updated_by_name
     from seo_page_settings s left join staff_users u on u.id = s.updated_by
     where s.website_id = $1`,
    [websiteId],
  );
  const blogs = await db.query<{ id: string; title: string; seo_title: string; seo_description: string; indexable: boolean; page_path: string }>(
    `select a.id, a.title, v.seo_title, v.seo_description, v.indexable,
            coalesce(nullif(v.canonical_path, ''), '/blog/' || v.slug) as page_path
     from blog_articles a join blog_article_versions v on v.id = a.live_version_id
     where a.website_id = $1 and v.slug is not null and v.slug <> ''`,
    [websiteId],
  );
  const rows = new Map<string, Building>();
  const at = (rawPath: string, source: PageSource, pathRank: number): Building | null => {
    const key = routeKey(rawPath);
    if (!key) return null;
    let row = rows.get(key);
    if (!row) {
      row = { clientId: website.client_id, websiteId, key, path: key, sources: [], title: null, mapped: null, setting: null, blog: null, mappedIds: [], pathRank: 99 };
      rows.set(key, row);
    }
    if (!row.sources.includes(source)) row.sources.push(source);
    // Keep the most specific stored spelling of the path for the public URL.
    if (pathRank < row.pathRank && rawPath.trim().startsWith("/") && !/[?#]/.test(rawPath)) {
      row.path = rawPath.trim().replace(/\/{2,}/g, "/");
      row.pathRank = pathRank;
    }
    return row;
  };
  if (website.url) at("/", "home", 4);
  for (const page of mapped.rows) {
    const row = at(page.page_path, "mapped", 2);
    if (!row) continue;
    row.mappedIds.push(page.id);
    row.mapped ??= { id: page.id, pageTitle: page.page_title, contentStatus: page.content_status, primaryKeyword: page.primary_keyword };
  }
  for (const article of blogs.rows) {
    const row = at(article.page_path, "blog", 3);
    if (row) row.blog ??= { articleId: article.id, title: article.title, seoTitle: article.seo_title, seoDescription: article.seo_description, indexable: article.indexable };
  }
  for (const setting of settings.rows) {
    const row = at(setting.page_path, "setting", 1);
    if (row) row.setting = {
      id: setting.id,
      pagePath: setting.page_path,
      title: setting.title,
      description: setting.description,
      indexable: setting.indexable,
      canonicalPath: setting.canonical_path,
      updatedAt: setting.updated_at,
      updatedByName: setting.updated_by_name,
    };
  }
  return [...rows.values()]
    .map(({ mappedIds, pathRank: _rank, ...row }): InventoryPage => {
      const routeId = pageRouteId(websiteId, row.key);
      return {
        ...row,
        id: mappedIds[0] ?? routeId,
        aliases: [...mappedIds, routeId],
        title: row.mapped?.pageTitle ?? row.blog?.title ?? row.setting?.title ?? (row.key === "/" ? "Home page" : null),
      };
    })
    .sort((a, b) => (a.key === "/" ? -1 : b.key === "/" ? 1 : a.key.localeCompare(b.key)));
}

/**
 * Title or URL search. A query written as a path or full URL that names a known route returns exactly that
 * route; anything else matches part of the title or path, ignoring case.
 */
export function searchInventory(pages: InventoryPage[], query: string | undefined): InventoryPage[] {
  const raw = query?.trim() ?? "";
  if (!raw) return pages;
  if (raw.startsWith("/") || /^https?:\/\//i.test(raw)) {
    const key = routeKey(raw);
    const exact = key ? pages.filter((page) => page.key === key) : [];
    if (exact.length) return exact;
  }
  const text = raw.toLowerCase();
  return pages.filter((page) => (page.title ?? "").toLowerCase().includes(text) || page.path.toLowerCase().includes(text));
}

/** Resolves a stable page ID inside one website only. Another website's page returns null. */
export async function findInventoryPage(db: Queryable, websiteId: string, pageId: string): Promise<InventoryPage | null> {
  const pages = await listPageInventory(db, websiteId);
  return pages.find((page) => page.id === pageId || page.aliases.includes(pageId)) ?? null;
}

// ---------------------------------------------------------------------------------------------------------
// Effective values (SEO-03.2)

export type ValueSource = "override" | "blog" | "website_default";

export interface EffectiveValue<T> {
  value: T | null;
  source: ValueSource;
}

export interface EffectivePageSeo {
  title: EffectiveValue<string>;
  description: EffectiveValue<string>;
  indexable: EffectiveValue<boolean>;
}

/** Page override first, then the live blog article, then the website's own default (not visible here). */
export function effectivePageSeo(page: Pick<InventoryPage, "setting" | "blog">): EffectivePageSeo {
  const pick = <T>(override: T | null | undefined, blog: T | undefined): EffectiveValue<T> =>
    override !== null && override !== undefined
      ? { value: override, source: "override" }
      : blog !== undefined
        ? { value: blog, source: "blog" }
        : { value: null, source: "website_default" };
  return {
    title: pick(page.setting?.title, page.blog?.seoTitle),
    description: pick(page.setting?.description, page.blog?.seoDescription),
    indexable: pick(page.setting?.indexable, page.blog?.indexable),
  };
}

/** How a page's SEO may be edited from Genie Works. */
export function pageEditRoute(platform: string, page: Pick<InventoryPage, "blog">): "settings_api" | "blog_editor" | "read_only" {
  if (page.blog) return "blog_editor";
  return isSettingsApiPlatform(platform) ? "settings_api" : "read_only";
}

// ---------------------------------------------------------------------------------------------------------
// Live page reading

export interface LiveHead {
  title: string | null;
  description: string | null;
  robots: string | null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function clean(text: string | undefined, max: number): string | null {
  if (text === undefined) return null;
  const value = decodeEntities(text).replace(/\s+/g, " ").trim();
  return value ? value.slice(0, max) : null;
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return out;
}

/** The title, meta description and robots directives a page serves. Body text is not kept. */
export function parseLiveHead(html: string, robotsHeader?: string | null): LiveHead {
  const head = html.split(/<\/head>/i, 1)[0] ?? html;
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  let description: string | undefined;
  const robots: string[] = [];
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const name = (attrs.name ?? "").toLowerCase();
    if (name === "description" && description === undefined) description = attrs.content ?? "";
    if ((name === "robots" || name === "googlebot") && attrs.content) robots.push(attrs.content);
  }
  if (robotsHeader) robots.push(robotsHeader);
  return { title: clean(title, 300), description: clean(description, 500), robots: clean(robots.join(", ") || undefined, 300) };
}

export function servesNoindex(robots: string | null): boolean {
  return Boolean(robots && /(^|[\s,:])(noindex|none)([\s,]|$)/i.test(robots));
}

export async function recordLiveCheck(db: Queryable, input: {
  clientId: string;
  websiteId: string;
  pagePath: string;
  pageUrl: string;
  httpStatus: number | null;
  head: LiveHead | null;
  errorCode: string | null;
  actorUserId: string;
  now?: Date;
}): Promise<void> {
  await db.query(
    `insert into seo_page_live_checks
       (client_id, website_id, page_path, page_url, http_status, observed_title, observed_description, observed_robots, safe_error_code, checked_by, checked_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.clientId, input.websiteId, input.pagePath, input.pageUrl, input.httpStatus,
      input.errorCode ? null : input.head?.title ?? null,
      input.errorCode ? null : input.head?.description ?? null,
      input.errorCode ? null : input.head?.robots ?? null,
      input.errorCode, input.actorUserId, (input.now ?? new Date()).toISOString(),
    ],
  );
}

// ---------------------------------------------------------------------------------------------------------
// Evidence (SEO-03.2)

export interface LiveCheckRow {
  checkedAt: Date;
  httpStatus: number | null;
  title: string | null;
  description: string | null;
  robots: string | null;
  errorCode: string | null;
}

export type PublishedState =
  | { state: "not_applicable" }
  | { state: "no_credential" }
  | { state: "waiting"; lastFetch: Date | null }
  | { state: "published"; at: Date };

export type LiveState =
  | { state: "not_checked" }
  | { state: "before_save"; check: LiveCheckRow }
  | { state: "failed"; check: LiveCheckRow }
  | { state: "observed"; check: LiveCheckRow }
  | { state: "matches"; check: LiveCheckRow }
  | { state: "differs"; check: LiveCheckRow; fields: Array<"title" | "description" | "indexing"> };

export interface PageEvidence {
  saved: { at: Date; by: string | null } | null;
  published: PublishedState;
  live: LiveState;
  google: PageInspections;
}

/** Compares the override with what the page served. Fields without an override are only observed. */
export function compareLive(setting: InventorySetting | null, check: LiveCheckRow | null): LiveState {
  if (!check) return { state: "not_checked" };
  if (setting && check.checkedAt.getTime() < setting.updatedAt.getTime()) return { state: "before_save", check };
  if (check.errorCode) return { state: "failed", check };
  if (!setting) return { state: "observed", check };
  const fields: Array<"title" | "description" | "indexing"> = [];
  if (setting.title !== null && setting.title.trim() !== (check.title ?? "")) fields.push("title");
  if (setting.description !== null && setting.description.trim() !== (check.description ?? "")) fields.push("description");
  if (setting.indexable !== null && setting.indexable === servesNoindex(check.robots)) fields.push("indexing");
  return fields.length ? { state: "differs", check, fields } : { state: "matches", check };
}

export function publishedState(setting: InventorySetting | null, tokenIssued: boolean, lastFetch: Date | null): PublishedState {
  if (!setting) return { state: "not_applicable" };
  if (!tokenIssued) return { state: "no_credential" };
  if (lastFetch && lastFetch.getTime() >= setting.updatedAt.getTime()) return { state: "published", at: lastFetch };
  return { state: "waiting", lastFetch };
}

export async function loadPageEvidence(db: Queryable, page: InventoryPage): Promise<PageEvidence> {
  const token = await db.query("select 1 from seo_site_tokens where website_id = $1 and revoked_at is null limit 1", [page.websiteId]);
  const delivery = await db.query<{ last_served_at: Date }>("select last_served_at from seo_settings_deliveries where website_id = $1", [page.websiteId]);
  const live = await db.query<{ checked_at: Date; http_status: number | null; observed_title: string | null; observed_description: string | null; observed_robots: string | null; safe_error_code: string | null }>(
    `select checked_at, http_status, observed_title, observed_description, observed_robots, safe_error_code
     from seo_page_live_checks where website_id = $1 and page_path = $2 order by checked_at desc limit 1`,
    [page.websiteId, page.path],
  );
  const row = live.rows[0];
  const check: LiveCheckRow | null = row
    ? { checkedAt: row.checked_at, httpStatus: row.http_status, title: row.observed_title, description: row.observed_description, robots: row.observed_robots, errorCode: row.safe_error_code }
    : null;
  return {
    saved: page.setting ? { at: page.setting.updatedAt, by: page.setting.updatedByName } : null,
    published: page.blog && !page.setting ? { state: "not_applicable" } : publishedState(page.setting, token.rows.length > 0, delivery.rows[0]?.last_served_at ?? null),
    live: compareLive(page.setting, check),
    google: await readPageInspections(db, page.websiteId, page.path),
  };
}

// ---------------------------------------------------------------------------------------------------------
// URL Inspection (SEO-03.3)

export interface InspectionRow {
  checkedAt: Date;
  source: "manual" | "scheduled";
  inspectionUrl: string | null;
  property: string | null;
  verdict: InspectionDetail["verdict"];
  coverage: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  robotsTxtState: string | null;
  lastCrawlTime: Date | null;
  googleCanonical: string | null;
  errorCode: string | null;
}

export interface PageInspections {
  lastSuccess: InspectionRow | null;
  /** A failed attempt newer than the last success, shown beside it. */
  newerFailure: InspectionRow | null;
}

export async function readPageInspections(db: Queryable, websiteId: string, pagePath: string): Promise<PageInspections> {
  const { rows } = await db.query<{
    checked_at: Date; source: "manual" | "scheduled"; inspection_url: string | null; property: string | null; result: string;
    verdict: InspectionDetail["verdict"]; coverage_state: string | null; indexing_state: string | null; page_fetch_state: string | null;
    robots_txt_state: string | null; last_crawl_time: Date | null; google_canonical: string | null; safe_error_code: string | null;
  }>(
    `(select * from seo_url_inspections where website_id = $1 and page_path = $2 and result = 'succeeded' order by checked_at desc limit 1)
     union all
     (select * from seo_url_inspections where website_id = $1 and page_path = $2 and result = 'failed' order by checked_at desc limit 1)`,
    [websiteId, pagePath],
  );
  const toRow = (row: (typeof rows)[number]): InspectionRow => ({
    checkedAt: row.checked_at,
    source: row.source,
    inspectionUrl: row.inspection_url,
    property: row.property,
    verdict: row.verdict,
    coverage: row.coverage_state,
    indexingState: row.indexing_state,
    pageFetchState: row.page_fetch_state,
    robotsTxtState: row.robots_txt_state,
    lastCrawlTime: row.last_crawl_time,
    googleCanonical: row.google_canonical,
    errorCode: row.safe_error_code,
  });
  const success = rows.find((row) => row.result === "succeeded");
  const failure = rows.find((row) => row.result === "failed");
  const lastSuccess = success ? toRow(success) : null;
  const newerFailure = failure && (!lastSuccess || failure.checked_at.getTime() > lastSuccess.checkedAt.getTime()) ? toRow(failure) : null;
  return { lastSuccess, newerFailure };
}

export interface InspectionTarget {
  connection: ConnectionRow;
  sealed: { ciphertext: string; nonce: string } | null;
}

/** The website's active Search Console connection and sealed credential. Service context only. */
export async function loadInspectionTarget(db: Queryable, websiteId: string): Promise<InspectionTarget | null> {
  const { rows } = await db.query<ConnectionRow>(
    `select id, client_id, website_id, provider, external_property_id, stream_or_site_ref, secret_ref, provider_timezone, status
     from analytics_connections
     where website_id = $1 and provider = 'gsc' and disconnected_at is null
     order by case status when 'connected' then 0 else 1 end, created_at desc
     limit 1`,
    [websiteId],
  );
  const connection = rows[0];
  if (!connection) return null;
  if (!connection.secret_ref) return { connection, sealed: null };
  const secret = await db.query<{ ciphertext: string; nonce: string; client_id: string }>(
    "select ciphertext, nonce, client_id from analytics_secrets where id = $1 and connection_id = $2",
    [connection.secret_ref, connection.id],
  );
  const sealed = secret.rows[0];
  return { connection, sealed: sealed && sealed.client_id === connection.client_id ? { ciphertext: sealed.ciphertext, nonce: sealed.nonce } : null };
}

/** The URL to inspect, built on the server from the registry address and the page path. */
export function inspectionUrlFor(websiteUrl: string | null, pagePath: string): string | null {
  return websiteUrl ? publicPageUrl(websiteUrl, pagePath) : null;
}

export type InspectionOutcome =
  | { ok: true; detail: InspectionDetail; reading: InspectionReading }
  | { ok: false; code: string };

/**
 * Asks Google what it reports for one URL. The property rule is checked first, so a URL outside the mapped
 * property never reaches Google. No database access: provider I/O stays outside a transaction.
 */
export async function runUrlInspection(target: InspectionTarget, inspectionUrl: string, deps: SyncDeps): Promise<InspectionOutcome> {
  const { connection } = target;
  if (!propertyCovers(connection.external_property_id, inspectionUrl)) return { ok: false, code: "outside_property" };
  if (connection.status !== "connected") return { ok: false, code: "reconnect_required" };
  if (!target.sealed) return { ok: false, code: "reconnect_required" };
  if (!tokenKeyConfigured()) return { ok: false, code: "not_configured" };
  let token: TokenBundle;
  try {
    token = JSON.parse(decryptSecret(target.sealed.ciphertext, target.sealed.nonce)) as TokenBundle;
  } catch {
    return { ok: false, code: "reconnect_required" };
  }
  let fresh: TokenBundle;
  try {
    fresh = await freshProviderToken(connection, token, deps);
  } catch (error) {
    return { ok: false, code: providerFailureCode(error) };
  }
  let response: Awaited<ReturnType<SyncDeps["fetch"]>>;
  try {
    response = await deps.fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      method: "POST",
      headers: { Authorization: `Bearer ${fresh.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inspectionUrl, siteUrl: connection.external_property_id, languageCode: "en-US" }),
    });
  } catch {
    return { ok: false, code: "provider_unavailable" };
  }
  if (response.status === 401) return { ok: false, code: "reconnect_required" };
  if (response.status === 403) return { ok: false, code: "inspection_forbidden" };
  if (response.status === 429) return { ok: false, code: "rate_limited" };
  if (response.status >= 500) return { ok: false, code: "provider_unavailable" };
  if (response.status >= 400) {
    const body = await response.json().catch(() => ({}));
    return { ok: false, code: isInvalidGrant(body) ? "reconnect_required" : "provider_rejected" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "provider_rejected" };
  }
  return { ok: true, detail: parseInspectionDetail(body), reading: parseInspection(body) };
}

/**
 * Appends one manual attempt. A success also refreshes the Site Health row for the same path; a failure leaves
 * every earlier result in place. A rejected credential marks the connection for reconnect. Service context only.
 */
export async function recordUrlInspection(db: Queryable, input: {
  clientId: string;
  websiteId: string;
  pagePath: string;
  inspectionUrl: string | null;
  property: string | null;
  connectionId: string | null;
  outcome: InspectionOutcome;
  actorUserId: string;
  now?: Date;
}): Promise<void> {
  const now = (input.now ?? new Date()).toISOString();
  const detail = input.outcome.ok ? input.outcome.detail : null;
  await db.query(
    `insert into seo_url_inspections
       (client_id, website_id, page_path, inspection_url, property, source, result, verdict, coverage_state, indexing_state,
        page_fetch_state, robots_txt_state, last_crawl_time, google_canonical, safe_error_code, requested_by, checked_at)
     values ($1, $2, $3, $4, $5, 'manual', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      input.clientId, input.websiteId, input.pagePath, input.inspectionUrl, input.property,
      input.outcome.ok ? "succeeded" : "failed",
      detail?.verdict ?? null, detail?.coverage ?? null, detail?.indexingState ?? null, detail?.pageFetchState ?? null,
      detail?.robotsTxtState ?? null, detail?.lastCrawlTime?.toISOString() ?? null, detail?.googleCanonical ?? null,
      input.outcome.ok ? null : input.outcome.code, input.actorUserId, now,
    ],
  );
  if (input.outcome.ok) {
    const reading = input.outcome.reading;
    await db.query(
      `update seo_index_checks
       set live_status = $3, google_status = $4, coverage_state = $5, safe_error_code = null, checked_at = $6
       where website_id = $1 and page_path = $2`,
      [input.websiteId, input.pagePath, reading.live, reading.google, reading.coverage, now],
    );
  } else if (input.outcome.code === "reconnect_required" && input.connectionId) {
    await db.query("update analytics_connections set status = 'reconnect_required', updated_at = $2 where id = $1 and status = 'connected'", [input.connectionId, now]);
  }
}

/** The latest successful Google result per path for one website, for the page list. */
export async function listLatestInspections(db: Queryable, websiteId: string): Promise<Map<string, { verdict: InspectionDetail["verdict"]; coverage: string | null; checkedAt: Date }>> {
  const { rows } = await db.query<{ page_path: string; verdict: InspectionDetail["verdict"]; coverage_state: string | null; checked_at: Date }>(
    `select distinct on (page_path) page_path, verdict, coverage_state, checked_at
     from seo_url_inspections where website_id = $1 and result = 'succeeded'
     order by page_path, checked_at desc`,
    [websiteId],
  );
  return new Map(rows.map((row) => [row.page_path, { verdict: row.verdict, coverage: row.coverage_state, checkedAt: row.checked_at }]));
}
