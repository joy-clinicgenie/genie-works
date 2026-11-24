import {
  completeDeliveryAttempt,
  completeVerificationAttempt,
  getArticle,
  getRevisionState,
  getWebsiteConnection,
  intendedArticleUrl,
  readPublishSecret,
  requestShip,
  requestVerification,
  type AccessProfile,
  type PoolClient,
} from "@clinic-genie/db";
import { staffTx } from "@/lib/db";

/**
 * D89. Ship to site: deliver a released revision to its website and verify the public page.
 * Every database step goes through the D87 delivery service in short transactions; network
 * calls run outside any transaction so a slow website never holds a database connection.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const REVISION_META = /<meta[^>]+name=["']genie-works-revision["'][^>]*content=["']([0-9a-f-]{36})["']/i;
const FEATURED_META = /<meta[^>]+name=["']genie-works-featured-image["'][^>]*content=["']([^"']+)["']/i;

export type DeliveryFailure =
  | "not_connected" | "invalid_url" | "site_unreachable" | "site_refused" | "site_error"
  | "not_found_yet" | "different_revision" | "different_article" | "image_unavailable";

export const FAILURE_MESSAGE: Record<DeliveryFailure, string> = {
  not_connected: "Ship to site is not connected for this website. An administrator can connect it in Blog → Publishing settings.",
  invalid_url: "The website URL cannot be used for delivery. Hosted Genie Works only delivers to https websites.",
  site_unreachable: "The website could not be reached. The approved revision is kept; try Ship to site again.",
  site_refused: "The website refused the request. Check that GENIE_WORKS_PUBLISH_SECRET on the website matches the secret saved in Publishing settings.",
  site_error: "The website could not refresh the article. Try Ship to site again.",
  not_found_yet: "Delivered, but the article address does not answer yet. Retry verification.",
  different_revision: "Delivered, but the website still shows an earlier revision. Retry verification.",
  different_article: "The website shows a different article at this address. Change the slug or remove the other article, then try again.",
  image_unavailable: "The article is on the website but its featured image does not load there. Check the image, then retry verification.",
};

export type ShipResult =
  | { ok: true; state: "verified"; publicUrl: string }
  | { ok: false; state: "not_shipped" | "in_progress" | "delivery_failed" | "awaiting_verification"; error: string };

/** A hosted server only calls https websites; http on a local host is allowed only off Vercel and outside production. */
export function assertDeliveryOrigin(url: string, env: Record<string, string | undefined> = process.env): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The website URL is not valid.");
  }
  const local = LOCAL_HOSTS.has(parsed.hostname);
  const hosted = Boolean(env.VERCEL_ENV) || env.NODE_ENV === "production";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local && !hosted)) throw new Error("Delivery needs an https website URL.");
  if (local && hosted) throw new Error("A hosted server does not deliver to a local website.");
  return parsed.origin;
}

export function websitePreviewUrl(origin: string, previewToken: string): string {
  return `${origin}/api/genie-works/preview?token=${encodeURIComponent(previewToken)}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 8000): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(ms) });
  } catch {
    return null;
  }
}

/** Asks the website to drop its cached listing and article pages. */
export async function requestRevalidate(origin: string, secret: string, paths: string[]): Promise<DeliveryFailure | null> {
  const response = await fetchWithTimeout(`${origin}/api/genie-works/revalidate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
    redirect: "error",
  });
  if (!response) return "site_unreachable";
  if (response.status === 401 || response.status === 403) return "site_refused";
  if (!response.ok) return "site_error";
  return null;
}

/** Checks that the public page shows exactly this revision, and that its featured image loads there. */
export async function verifyPublicArticle(
  publicUrl: string,
  versionId: string,
  opts: { attempts?: number; delayMs?: number; expectImage?: boolean } = {},
): Promise<DeliveryFailure | null> {
  const origin = new URL(publicUrl).origin;
  let last: DeliveryFailure = "not_found_yet";
  const attempts = opts.attempts ?? 4;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(opts.delayMs ?? 1500);
    const response = await fetchWithTimeout(publicUrl, { headers: { Accept: "text/html" } });
    if (!response) { last = "site_unreachable"; continue; }
    if (new URL(response.url || publicUrl).origin !== origin) { last = "different_article"; continue; }
    if (response.status === 404) { last = "not_found_yet"; continue; }
    if (!response.ok) { last = "site_error"; continue; }
    const html = await response.text();
    const revision = REVISION_META.exec(html)?.[1];
    if (!revision) { last = "different_article"; continue; }
    if (revision.toLowerCase() !== versionId.toLowerCase()) { last = "different_revision"; continue; }
    const featured = FEATURED_META.exec(html)?.[1];
    if (opts.expectImage && !featured) return "image_unavailable";
    if (featured) {
      let imageUrl: URL;
      try {
        imageUrl = new URL(featured.replace(/&amp;/g, "&"), publicUrl);
      } catch {
        return "image_unavailable";
      }
      if (imageUrl.origin !== origin) return "image_unavailable";
      const image = await fetchWithTimeout(imageUrl.toString());
      if (!image || !image.ok || !(image.headers.get("content-type") ?? "").startsWith("image/")) return "image_unavailable";
    }
    return null;
  }
  return last;
}

interface Target {
  articleId: string;
  websiteId: string;
  versionId: string;
  origin: string;
  publicUrl: string;
  basePath: string;
  secret: string;
  expectImage: boolean;
}

/** Website, address and secret for the revision being shipped. Read inside the caller's transaction. */
async function target(db: PoolClient, articleId: string, versionId: string): Promise<Target | DeliveryFailure> {
  const article = await getArticle(db, articleId);
  const connection = article ? await getWebsiteConnection(db, article.website_id) : null;
  if (!article || !connection?.configured) return "not_connected";
  const secret = await readPublishSecret(db, article.website_id);
  if (!secret) return "not_connected";
  const { rows } = await db.query<{ slug: string | null; featured_media_id: string | null }>(
    "select slug, featured_media_id from blog_article_versions where id = $1 and article_id = $2",
    [versionId, articleId],
  );
  const publicUrl = intendedArticleUrl(connection.websiteUrl, connection.basePath, rows[0]?.slug ?? null);
  if (!publicUrl) return "invalid_url";
  let origin: string;
  try {
    origin = assertDeliveryOrigin(publicUrl);
  } catch {
    return "invalid_url";
  }
  return { articleId, websiteId: article.website_id, versionId, origin, publicUrl, basePath: connection.basePath, secret, expectImage: Boolean(rows[0]?.featured_media_id) };
}

async function verify(access: AccessProfile, t: Target): Promise<ShipResult> {
  const check = await staffTx(access, (db) => requestVerification(db, { articleId: t.articleId, websiteId: t.websiteId, versionId: t.versionId }, access.user.id));
  if (check.outcome === "already_verified") return { ok: true, state: "verified", publicUrl: check.delivery.public_url ?? t.publicUrl };
  if (check.outcome === "in_progress") return { ok: false, state: "in_progress", error: "A check of the website is already running. Reload in a moment." };
  const failure = await verifyPublicArticle(t.publicUrl, t.versionId, { expectImage: t.expectImage });
  const done = await staffTx(access, (db) => completeVerificationAttempt(
    db,
    check.attempt!.id,
    failure ? { verified: false, code: failure } : { verified: true, publicUrl: t.publicUrl },
    access.user.id,
  ));
  if (!done.applied) return { ok: false, state: "awaiting_verification", error: "A newer result was recorded first. Reload the article." };
  if (failure) return { ok: false, state: "awaiting_verification", error: FAILURE_MESSAGE[failure] };
  return { ok: true, state: "verified", publicUrl: t.publicUrl };
}

/**
 * Ship to site. Ships the approved current revision (releasing it to the content API first if
 * needed), or re-ships the released revision when it is not yet verified. Safe to repeat.
 */
export async function shipToSite(access: AccessProfile, articleId: string): Promise<ShipResult> {
  const prepared = await staffTx(access, async (db) => {
    const article = await getArticle(db, articleId);
    if (!article) return "missing" as const;
    const approvedCurrent = article.status === "approved" || article.working_status === "approved";
    const versionId = approvedCurrent ? article.current_version_id : article.live_version_id;
    if (!versionId) return "not_approved" as const;
    const shipTarget = await target(db, articleId, versionId);
    if (typeof shipTarget === "string") return shipTarget;
    const shipped = await requestShip(db, { articleId, websiteId: article.website_id, versionId }, access.user.id);
    return { shipped, target: shipTarget };
  });
  if (prepared === "missing") return { ok: false, state: "not_shipped", error: "Article not found." };
  if (prepared === "not_approved") return { ok: false, state: "not_shipped", error: "Approve the current revision before shipping it." };
  if (typeof prepared === "string") return { ok: false, state: "not_shipped", error: FAILURE_MESSAGE[prepared] };
  const { shipped, target: t } = prepared;
  if (shipped.outcome === "already_verified") return { ok: true, state: "verified", publicUrl: shipped.delivery.public_url ?? t.publicUrl };
  if (shipped.outcome === "in_progress") return { ok: false, state: "in_progress", error: "Shipping is already in progress. Reload in a moment." };
  if (shipped.outcome === "started") {
    const failure = await requestRevalidate(t.origin, t.secret, [t.basePath, new URL(t.publicUrl).pathname]);
    const done = await staffTx(access, (db) => completeDeliveryAttempt(db, shipped.attempt!.id, failure ? { ok: false, code: failure } : { ok: true }, access.user.id));
    if (!done.applied) return { ok: false, state: "in_progress", error: "Another attempt finished first. Reload the article." };
    if (failure) return { ok: false, state: "delivery_failed", error: FAILURE_MESSAGE[failure] };
  }
  return verify(access, t);
}

/** Retry verification: re-checks the website for the released revision without sending anything. */
export async function retryVerification(access: AccessProfile, articleId: string): Promise<ShipResult> {
  const prepared = await staffTx(access, async (db) => {
    const state = await getRevisionState(db, articleId);
    if (!state?.released) return "not_shipped" as const;
    return target(db, articleId, state.released.versionId);
  });
  if (prepared === "not_shipped") return { ok: false, state: "not_shipped", error: "This article has no released revision to verify." };
  if (typeof prepared === "string") return { ok: false, state: "not_shipped", error: FAILURE_MESSAGE[prepared] };
  return verify(access, prepared);
}
