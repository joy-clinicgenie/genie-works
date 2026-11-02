import type { Queryable } from "../client";
import { decryptSecret, encryptSecret } from "../analytics/crypto";
import { isInvalidGrant } from "../analytics/providers/ga4";
import { normalizeIndexPath, parseInspection, publicPageUrl, type InspectionReading } from "../analytics/providers/gsc";
import { pageSpeedUrl, parsePageSpeed } from "../analytics/providers/pagespeed";
import type { FetchLike } from "../analytics/sync";

export interface CheckDeps {
  fetch: FetchLike;
  now: Date;
  googleClientId?: string;
  googleClientSecret?: string;
  pageSpeedKey?: string;
}

export type GoogleLabel = "not_connected" | "connected" | "reconnect_required" | "indexed" | "not_indexed" | "unknown";
export type LiveLabel = "not_checked" | "indexable" | "blocked";
export type ConfiguredLabel = "index_allowed" | "noindex_saved";

export interface IndexView {
  pagePath: string;
  itemKind: "home" | "page" | "blog" | "setting";
  configured: ConfiguredLabel;
  liveStatus: LiveLabel;
  googleStatus: GoogleLabel;
  coverage: string | null;
  checkedAt: Date | null;
  failed: boolean;
}

export interface SpeedView {
  pagePath: string;
  strategy: "mobile" | "desktop";
  score: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  checkedAt: Date | null;
  failed: boolean;
}

interface Item {
  clientId: string;
  websiteId: string;
  pagePath: string;
  itemKind: IndexView["itemKind"];
  configured: ConfiguredLabel;
  rank: number;
}

const CONFIGURED_TEXT = { index_allowed: "Index allowed", noindex_saved: "Noindex saved" } as const;
const LIVE_TEXT = { not_checked: "Not checked", indexable: "Indexable", blocked: "Blocked" } as const;
const GOOGLE_TEXT = {
  not_connected: "Not connected",
  connected: "Connected",
  reconnect_required: "Reconnect required",
  indexed: "Indexed",
  not_indexed: "Not indexed",
  unknown: "Unknown",
} as const;

export function indexLabels(row: Pick<IndexView, "configured" | "liveStatus" | "googleStatus">): { configured: string; live: string; google: string } {
  return {
    configured: CONFIGURED_TEXT[row.configured],
    live: LIVE_TEXT[row.liveStatus],
    google: GOOGLE_TEXT[row.googleStatus],
  };
}

export async function listWebsiteIndex(db: Queryable, websiteId: string): Promise<IndexView[]> {
  const items = await gatherItems(db, websiteId);
  const stored = await db.query<{
    page_path: string;
    live_status: LiveLabel;
    google_status: Exclude<GoogleLabel, "reconnect_required">;
    coverage_state: string | null;
    checked_at: Date | null;
    safe_error_code: string | null;
  }>("select page_path, live_status, google_status, coverage_state, checked_at, safe_error_code from seo_index_checks where website_id = $1", [websiteId]);
  const byPath = new Map(stored.rows.map((row) => [row.page_path, row]));
  const connection = await gscStatus(db, websiteId);
  return items
    .filter((item) => item.websiteId === websiteId)
    .map((item) => {
      const row = byPath.get(item.pagePath);
      const googleStatus = displayGoogle(row?.google_status ?? null, connection);
      const storedLive = row?.live_status;
      const liveStatus: LiveLabel = connection === "connected" && (storedLive === "indexable" || storedLive === "blocked") ? storedLive : "not_checked";
      return {
        pagePath: item.pagePath,
        itemKind: item.itemKind,
        configured: item.configured,
        liveStatus,
        googleStatus,
        coverage: row?.safe_error_code ? null : row?.coverage_state ?? null,
        checkedAt: row?.checked_at ?? null,
        failed: Boolean(row?.safe_error_code),
      };
    })
    .sort((a, b) => a.pagePath.localeCompare(b.pagePath));
}

export async function readPageIndex(db: Queryable, websiteId: string, pagePath: string): Promise<{ configured: string; live: string; google: string; detail: string | null }> {
  const wanted = normalizeIndexPath(pagePath);
  const rows = await listWebsiteIndex(db, websiteId);
  const item = wanted ? rows.find((row) => row.pagePath === wanted) : undefined;
  if (!item) {
    const connection = await gscStatus(db, websiteId);
    return { configured: "Not saved", live: "Not checked", google: GOOGLE_TEXT[displayGoogle(null, connection)], detail: null };
  }
  const labels = indexLabels(item);
  const detail = item.failed ? "Check did not complete" : item.coverage;
  return { configured: labels.configured, live: labels.live, google: labels.google, detail };
}

export async function listSpeedChecks(db: Queryable, websiteId: string): Promise<SpeedView[]> {
  const { rows } = await db.query<{
    page_path: string;
    strategy: "mobile" | "desktop";
    score: number | null;
    lcp_ms: number | null;
    cls: number | null;
    tbt_ms: number | null;
    checked_at: Date | null;
    safe_error_code: string | null;
  }>("select page_path, strategy, score, lcp_ms, cls, tbt_ms, checked_at, safe_error_code from seo_speed_checks where website_id = $1 order by page_path, strategy", [websiteId]);
  return rows.map((row) => ({
    pagePath: row.page_path,
    strategy: row.strategy,
    score: row.score,
    lcpMs: row.lcp_ms,
    cls: row.cls,
    tbtMs: row.tbt_ms,
    checkedAt: row.checked_at,
    failed: Boolean(row.safe_error_code),
  }));
}

/** Writes the public-page inventory. A connected property starts as Connected until a verdict is stored. */
export async function refreshIndexInventory(db: Queryable, websiteId?: string | null): Promise<number> {
  const items = await gatherItems(db, websiteId ?? null);
  const links = await gscMap(db, websiteId ?? null);
  if (items.length > 0) {
    await db.query(
      `insert into seo_index_checks (client_id, website_id, page_path, item_kind, configured, google_status)
       select * from unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[])
       on conflict (website_id, page_path) do update set
         client_id = excluded.client_id,
         item_kind = excluded.item_kind,
         configured = excluded.configured,
         google_status = case
           when excluded.google_status = 'not_connected' then 'not_connected'
           when seo_index_checks.google_status = 'not_connected' then 'connected'
           else seo_index_checks.google_status
         end,
         live_status = case when excluded.google_status = 'not_connected' then 'not_checked' else seo_index_checks.live_status end,
         coverage_state = case when excluded.google_status = 'not_connected' then null else seo_index_checks.coverage_state end,
         safe_error_code = case when excluded.google_status = 'not_connected' then null else seo_index_checks.safe_error_code end,
         checked_at = case when excluded.google_status = 'not_connected' then null else seo_index_checks.checked_at end`,
      [
        items.map((item) => item.clientId),
        items.map((item) => item.websiteId),
        items.map((item) => item.pagePath),
        items.map((item) => item.itemKind),
        items.map((item) => item.configured),
        items.map((item) => (links.get(item.websiteId) === "connected" ? "connected" : "not_connected")),
      ],
    );
  }
  if (items.length === 0) {
    await db.query("delete from seo_index_checks where ($1::uuid is null or website_id = $1)", [websiteId ?? null]);
  } else {
    await db.query(
      `delete from seo_index_checks c
       where ($1::uuid is null or c.website_id = $1)
         and not exists (
           select 1 from unnest($2::uuid[], $3::text[]) as kept(website_id, page_path)
           where kept.website_id = c.website_id and kept.page_path = c.page_path
         )`,
      [websiteId ?? null, items.map((item) => item.websiteId), items.map((item) => item.pagePath)],
    );
  }
  return items.length;
}

export async function inspectNext(db: Queryable, deps: CheckDeps, websiteId?: string | null): Promise<"done" | "empty" | "stop"> {
  const { rows } = await db.query<{
    id: string;
    page_path: string;
    url: string | null;
    connection_id: string;
    external_property_id: string;
    secret_ref: string | null;
  }>(
    `with next as (
       select k.id
       from seo_index_checks k
       where ($1::uuid is null or k.website_id = $1)
         and exists (
           select 1 from analytics_connections c
           where c.website_id = k.website_id and c.provider = 'gsc' and c.status = 'connected' and c.disconnected_at is null
         )
         and (
           k.checked_at is null
           or k.checked_at < now() - interval '7 days'
           or (k.google_status in ('connected', 'unknown', 'not_indexed') and k.checked_at < now() - interval '1 day')
         )
       order by case when k.page_path = '/' then 0 else 1 end, k.checked_at asc nulls first, k.id
       for update skip locked
       limit 1
     )
     select k.id, k.page_path, w.url, c.id as connection_id, c.external_property_id, c.secret_ref
     from next
     join seo_index_checks k on k.id = next.id
     join websites w on w.id = k.website_id
     join analytics_connections c on c.website_id = k.website_id and c.provider = 'gsc' and c.status = 'connected' and c.disconnected_at is null
     limit 1`,
    [websiteId ?? null],
  );
  const row = rows[0];
  if (!row) return "empty";
  const blank: InspectionReading = { live: "not_checked", google: "unknown", coverage: null };
  try {
    const pageUrl = row.url ? publicPageUrl(row.url, row.page_path) : null;
    if (!pageUrl) {
      await recordInspection(db, row.id, blank, "missing_url");
      return "done";
    }
    const token = await googleAccessToken(db, row.connection_id, row.secret_ref, deps);
    if (typeof token !== "string") {
      await recordInspection(db, row.id, blank, token);
      return "stop";
    }
    const response = await deps.fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inspectionUrl: pageUrl, siteUrl: row.external_property_id, languageCode: "en-US" }),
    });
    if (response.status === 401 || response.status === 403) {
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 && isInvalidGrant(body)) {
        await db.query("update analytics_connections set status = 'reconnect_required', updated_at = now() where id = $1 and status = 'connected'", [row.connection_id]);
      }
      await recordInspection(db, row.id, blank, response.status === 403 ? "inspection_forbidden" : "token_rejected");
      return response.status === 401 ? "stop" : "done";
    }
    if (response.status === 429 || response.status >= 500) {
      await recordInspection(db, row.id, blank, "rate_limited");
      return "done";
    }
    if (response.status >= 400) {
      await recordInspection(db, row.id, blank, "provider_rejected");
      return "done";
    }
    await recordInspection(db, row.id, parseInspection(await response.json()), null);
    return "done";
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    await recordInspection(db, row.id, blank, timedOut ? "timed_out" : "provider_rejected");
    return "done";
  }
}

export async function measureNext(db: Queryable, deps: CheckDeps, websiteId?: string | null): Promise<"done" | "empty"> {
  const { rows } = await db.query<{ id: string; client_id: string; website_id: string; page_path: string; url: string | null }>(
    `with next as (
       select k.id
       from seo_index_checks k
       join websites w on w.id = k.website_id
       where w.url is not null
         and ($1::uuid is null or k.website_id = $1)
         and not exists (
           select 1 from seo_speed_checks s
           where s.website_id = k.website_id and s.page_path = k.page_path and s.strategy = 'mobile'
             and (
               (s.safe_error_code is null and s.checked_at > now() - interval '14 days')
               or (s.safe_error_code is not null and s.checked_at > now() - interval '1 day')
             )
         )
       order by case when k.page_path = '/' then 0 else 1 end, k.page_path, k.id
       for update of k skip locked
       limit 1
     )
     select k.id, k.client_id, k.website_id, k.page_path, w.url
     from next
     join seo_index_checks k on k.id = next.id
     join websites w on w.id = k.website_id`,
    [websiteId ?? null],
  );
  const row = rows[0];
  if (!row) return "empty";
  const pageUrl = row.url ? publicPageUrl(row.url, row.page_path) : null;
  if (!pageUrl) {
    await recordSpeed(db, row, null, "missing_url");
    return "done";
  }
  try {
    const response = await deps.fetch(pageSpeedUrl(pageUrl, deps.pageSpeedKey), { method: "GET" });
    if (response.status === 429 || response.status >= 500) {
      await recordSpeed(db, row, null, "rate_limited");
      return "done";
    }
    if (response.status >= 400) {
      await recordSpeed(db, row, null, "provider_rejected");
      return "done";
    }
    const reading = parsePageSpeed(await response.json());
    await recordSpeed(db, row, reading.score === null ? null : reading, reading.score === null ? "provider_rejected" : null);
    return "done";
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    await recordSpeed(db, row, null, timedOut ? "timed_out" : "provider_rejected");
    return "done";
  }
}

async function gatherItems(db: Queryable, websiteId: string | null): Promise<Item[]> {
  const homes = await db.query<{ id: string; client_id: string }>(
    `select id, client_id from websites
     where status = 'active' and archived_at is null and url is not null and length(btrim(url)) > 0
       and ($1::uuid is null or id = $1)`,
    [websiteId],
  );
  const pages = await db.query<{ client_id: string; website_id: string; page_path: string }>(
    `select client_id, website_id, page_path from seo_pages
     where archived_at is null and website_id is not null and content_status <> 'retired'
       and ($1::uuid is null or website_id = $1)`,
    [websiteId],
  );
  const settings = await db.query<{ client_id: string; website_id: string; page_path: string; indexable: boolean }>(
    `select client_id, website_id, page_path, indexable from seo_page_settings
     where ($1::uuid is null or website_id = $1)`,
    [websiteId],
  );
  const blogs = await db.query<{ client_id: string; website_id: string; page_path: string; indexable: boolean }>(
    "select client_id, website_id, page_path, indexable from live_blog_index_paths($1)",
    [websiteId],
  );
  const byKey = new Map<string, Item>();
  const put = (item: Item) => {
    const key = `${item.websiteId}:${item.pagePath}`;
    const current = byKey.get(key);
    if (!current || item.rank < current.rank) byKey.set(key, item);
  };
  for (const home of homes.rows) {
    put({ clientId: home.client_id, websiteId: home.id, pagePath: "/", itemKind: "home", configured: "index_allowed", rank: 4 });
  }
  for (const page of pages.rows) {
    const path = normalizeIndexPath(page.page_path);
    if (path) put({ clientId: page.client_id, websiteId: page.website_id, pagePath: path, itemKind: "page", configured: "index_allowed", rank: 3 });
  }
  for (const article of blogs.rows) {
    const path = normalizeIndexPath(article.page_path);
    if (path) put({ clientId: article.client_id, websiteId: article.website_id, pagePath: path, itemKind: "blog", configured: article.indexable ? "index_allowed" : "noindex_saved", rank: 2 });
  }
  for (const setting of settings.rows) {
    const path = normalizeIndexPath(setting.page_path);
    if (path) put({ clientId: setting.client_id, websiteId: setting.website_id, pagePath: path, itemKind: "setting", configured: setting.indexable ? "index_allowed" : "noindex_saved", rank: 1 });
  }
  return [...byKey.values()];
}

async function gscMap(db: Queryable, websiteId: string | null): Promise<Map<string, "connected" | "reconnect_required">> {
  const { rows } = await db.query<{ website_id: string; status: "connected" | "reconnect_required" }>(
    `select distinct on (website_id) website_id, status
     from analytics_connections
     where provider = 'gsc' and disconnected_at is null and status in ('connected', 'reconnect_required')
       and ($1::uuid is null or website_id = $1)
     order by website_id, case status when 'connected' then 0 else 1 end`,
    [websiteId],
  );
  return new Map(rows.map((row) => [row.website_id, row.status]));
}

async function gscStatus(db: Queryable, websiteId: string): Promise<"connected" | "reconnect_required" | "none"> {
  return (await gscMap(db, websiteId)).get(websiteId) ?? "none";
}

function displayGoogle(stored: Exclude<GoogleLabel, "reconnect_required"> | null, connection: "connected" | "reconnect_required" | "none"): GoogleLabel {
  if (connection === "reconnect_required") return "reconnect_required";
  if (connection !== "connected") return "not_connected";
  if (stored === "indexed" || stored === "not_indexed" || stored === "unknown") return stored;
  return "connected";
}

async function recordInspection(db: Queryable, id: string, reading: InspectionReading, errorCode: string | null): Promise<void> {
  await db.query(
    `update seo_index_checks
     set live_status = $2, google_status = $3, coverage_state = $4, safe_error_code = $5, checked_at = now()
     where id = $1`,
    [id, errorCode ? "not_checked" : reading.live, errorCode ? "unknown" : reading.google, errorCode ? null : reading.coverage, errorCode],
  );
}

async function recordSpeed(
  db: Queryable,
  row: { client_id: string; website_id: string; page_path: string },
  reading: { score: number | null; lcpMs: number | null; cls: number | null; tbtMs: number | null } | null,
  errorCode: string | null,
): Promise<void> {
  await db.query(
    `insert into seo_speed_checks (client_id, website_id, page_path, strategy, score, lcp_ms, cls, tbt_ms, safe_error_code)
     values ($1, $2, $3, 'mobile', $4, $5, $6, $7, $8)
     on conflict (website_id, page_path, strategy) do update set
       client_id = excluded.client_id,
       score = excluded.score,
       lcp_ms = excluded.lcp_ms,
       cls = excluded.cls,
       tbt_ms = excluded.tbt_ms,
       safe_error_code = excluded.safe_error_code,
       checked_at = now()`,
    [row.client_id, row.website_id, row.page_path, reading?.score ?? null, reading?.lcpMs ?? null, reading?.cls ?? null, reading?.tbtMs ?? null, errorCode],
  );
}

async function googleAccessToken(db: Queryable, connectionId: string, secretRef: string | null, deps: CheckDeps): Promise<string | "token_rejected" | "token_unreadable"> {
  if (!secretRef) return "token_unreadable";
  const { rows } = await db.query<{ ciphertext: string; nonce: string }>("select ciphertext, nonce from analytics_secrets where id = $1 and connection_id = $2", [secretRef, connectionId]);
  const secret = rows[0];
  if (!secret) return "token_unreadable";
  let token: { accessToken?: string; refreshToken?: string; expiresAt?: string };
  try {
    token = JSON.parse(decryptSecret(secret.ciphertext, secret.nonce)) as { accessToken?: string; refreshToken?: string; expiresAt?: string };
  } catch {
    return "token_unreadable";
  }
  if (!token.accessToken) return "token_unreadable";
  if (!token.expiresAt || new Date(token.expiresAt).getTime() > deps.now.getTime() + 60_000) return token.accessToken;
  if (!token.refreshToken || !deps.googleClientId || !deps.googleClientSecret) return "token_rejected";
  const response = await deps.fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refreshToken, client_id: deps.googleClientId, client_secret: deps.googleClientSecret }).toString(),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 400 || isInvalidGrant(body)) {
    await db.query("update analytics_connections set status = 'reconnect_required', updated_at = now() where id = $1 and status = 'connected'", [connectionId]);
    return "token_rejected";
  }
  if (response.status >= 400) return "token_rejected";
  const record = body as { access_token?: string; expires_in?: number };
  if (!record.access_token) return "token_rejected";
  const refreshed = { ...token, accessToken: record.access_token, expiresAt: new Date(deps.now.getTime() + (record.expires_in ?? 3600) * 1000).toISOString() };
  const sealed = encryptSecret(JSON.stringify(refreshed));
  await db.query("update analytics_secrets set ciphertext = $2, nonce = $3 where id = $1 and connection_id = $4", [secretRef, sealed.ciphertext, sealed.nonce, connectionId]);
  return refreshed.accessToken;
}
