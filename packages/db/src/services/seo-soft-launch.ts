import { createHash, randomBytes } from "node:crypto";
import type { Queryable } from "../client";
import { PermissionDeniedError } from "./auth";
import { recordAudit } from "./audit";
import { requireWebsiteForClient } from "./registry";

async function assertPublisher(db: Queryable, actorUserId: string): Promise<void> {
  const { rows } = await db.query<{ platform_role: string }>("select platform_role from staff_users where id = $1 and active", [actorUserId]);
  if (rows[0]?.platform_role !== "admin" && rows[0]?.platform_role !== "manager") {
    throw new PermissionDeniedError("Only an admin or manager can publish.");
  }
}

export class SeoSoftLaunchRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeoSoftLaunchRuleError";
  }
}

export interface SeoPageSettingRow {
  id: string;
  client_id: string;
  website_id: string;
  website_name: string;
  page_path: string;
  title: string;
  description: string;
  canonical_path: string | null;
  indexable: boolean;
  updated_at: Date;
}

export interface SeoRedirectRow {
  id: string;
  client_id: string;
  website_id: string;
  website_name: string;
  source_path: string;
  destination_path: string;
  active: boolean;
  updated_at: Date;
}

export interface SeoBusinessProfileRow {
  id: string;
  client_id: string;
  client_name: string;
  branch_name: string;
  profile_url: string | null;
  external_identifier: string | null;
  setup_status: "not_started" | "in_progress" | "staff_marked_verified";
  notes: string | null;
  updated_at: Date;
}

export function normalizeSeoPath(value: string, field = "Path"): string {
  const path = value.trim();
  if (!path || path.length > 500 || !path.startsWith("/") || path.startsWith("//") || /[\s?#\\]/.test(path) || /%(?:2f|5c)/i.test(path)) {
    throw new SeoSoftLaunchRuleError(`${field} must be a local path beginning with /, without a query string or fragment.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(path, "https://clinic-genie.invalid");
  } catch {
    throw new SeoSoftLaunchRuleError(`${field} is not a valid path.`);
  }
  if (parsed.origin !== "https://clinic-genie.invalid" || parsed.search || parsed.hash || parsed.pathname.length > 500) {
    throw new SeoSoftLaunchRuleError(`${field} must stay on this website.`);
  }
  if (
    parsed.pathname === "/api" || parsed.pathname.startsWith("/api/")
    || parsed.pathname === "/_next" || parsed.pathname.startsWith("/_next/")
    || ["/preview-access", "/robots.txt", "/sitemap.xml", "/favicon.ico"].includes(parsed.pathname)
  ) {
    throw new SeoSoftLaunchRuleError(`${field} cannot target a reserved site, SEO, API, or framework path.`);
  }
  return parsed.pathname;
}

export function assertSeoRedirectAcyclic(
  existing: readonly { id: string; source_path: string; destination_path: string }[],
  source: string,
  destination: string,
  excludingId?: string,
): void {
  if (source === destination) throw new SeoSoftLaunchRuleError("A redirect cannot point to itself.");
  const routes = new Map(existing.filter((r) => r.id !== excludingId).map((r) => [r.source_path, r.destination_path]));
  routes.set(source, destination);
  const visited = new Set([source]);
  let next = destination;
  while (routes.has(next)) {
    if (visited.has(next)) throw new SeoSoftLaunchRuleError("This redirect would create a loop. Change its destination first.");
    visited.add(next);
    next = routes.get(next)!;
  }
}

export async function listSeoPageSettings(db: Queryable, f: { clientId?: string; websiteId?: string } = {}): Promise<SeoPageSettingRow[]> {
  const { rows } = await db.query<SeoPageSettingRow>(
    `select s.*, w.name as website_name
     from seo_page_settings s join websites w on w.id = s.website_id
     where ($1::uuid is null or s.client_id = $1) and ($2::uuid is null or s.website_id = $2)
     order by w.name, s.page_path`,
    [f.clientId ?? null, f.websiteId ?? null],
  );
  return rows;
}

export async function saveSeoPageSetting(
  db: Queryable,
  clientId: string,
  websiteId: string,
  input: { pagePath: string; title: string; description: string; canonicalPath: string | null; indexable: boolean },
  actorUserId: string,
): Promise<void> {
  const pagePath = normalizeSeoPath(input.pagePath, "Page path");
  const canonicalPath = input.canonicalPath?.trim() ? normalizeSeoPath(input.canonicalPath, "Canonical path") : null;
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < 1 || title.length > 200) throw new SeoSoftLaunchRuleError("Page title must be 1–200 characters.");
  if (description.length < 1 || description.length > 320) throw new SeoSoftLaunchRuleError("Meta description must be 1–320 characters.");
  await assertPublisher(db, actorUserId);
  await requireWebsiteForClient(db, websiteId, clientId);

  await db.query(
    `insert into seo_page_settings (client_id, website_id, page_path, title, description, canonical_path, indexable, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (website_id, page_path) do update set title = excluded.title, description = excluded.description,
       canonical_path = excluded.canonical_path, indexable = excluded.indexable, updated_by = excluded.updated_by, updated_at = now()`,
    [clientId, websiteId, pagePath, title, description, canonicalPath, input.indexable, actorUserId],
  );
  await recordAudit(db, {
    actorType: "staff",
    actorUserId,
    action: "seo.page_settings.publish",
    targetType: "website",
    targetId: websiteId,
    clientId,
    outcome: "success",
    metadata: { pagePath, indexable: input.indexable },
  });
}

export async function saveGoogleSiteVerification(db: Queryable, clientId: string, websiteId: string, value: string | null, actorUserId: string): Promise<void> {
  const token = value?.trim() || null;
  if (token && !/^[A-Za-z0-9_-]{1,200}$/.test(token)) throw new SeoSoftLaunchRuleError("Enter only the verification token from the Google Search Console HTML tag.");
  await assertPublisher(db, actorUserId);
  await requireWebsiteForClient(db, websiteId, clientId);
  await db.query(
    `insert into seo_website_settings (website_id, client_id, google_site_verification, updated_by)
     values ($1, $2, $3, $4)
     on conflict (website_id) do update set google_site_verification = excluded.google_site_verification, updated_by = excluded.updated_by, updated_at = now()`,
    [websiteId, clientId, token, actorUserId],
  );
  await recordAudit(db, {
    actorType: "staff",
    actorUserId,
    action: "seo.search_console_verification.update",
    targetType: "website",
    targetId: websiteId,
    clientId,
    outcome: "success",
    metadata: { configured: Boolean(token) },
  });
}

export async function getGoogleSiteVerification(db: Queryable, websiteId: string): Promise<string | null> {
  const { rows } = await db.query<{ google_site_verification: string | null }>(
    "select google_site_verification from seo_website_settings where website_id = $1",
    [websiteId],
  );
  return rows[0]?.google_site_verification ?? null;
}

export async function listSeoRedirects(
  db: Queryable,
  f: { clientId?: string; websiteId?: string; search?: string; includeInactive?: boolean } = {},
): Promise<SeoRedirectRow[]> {
  const { rows } = await db.query<SeoRedirectRow>(
    `select r.*, w.name as website_name
     from seo_redirects r join websites w on w.id = r.website_id
     where ($1::uuid is null or r.client_id = $1)
       and ($2::uuid is null or r.website_id = $2)
       and ($3::text = '' or r.source_path ilike '%' || $3 || '%' or r.destination_path ilike '%' || $3 || '%')
       and ($4 or r.active)
     order by w.name, r.source_path`,
    [f.clientId ?? null, f.websiteId ?? null, f.search?.trim() ?? "", f.includeInactive ?? false],
  );
  return rows;
}

export async function saveSeoRedirect(
  db: Queryable,
  clientId: string,
  websiteId: string,
  input: { id?: string; sourcePath: string; destinationPath: string; active: boolean },
  actorUserId: string,
): Promise<void> {
  const source = normalizeSeoPath(input.sourcePath, "From path");
  const destination = normalizeSeoPath(input.destinationPath, "To path");
  await assertPublisher(db, actorUserId);
  await requireWebsiteForClient(db, websiteId, clientId);

  await db.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [websiteId, "seo-redirects"]);
  const { rows: existing } = await db.query<{ id: string; source_path: string; destination_path: string }>(
    "select id, source_path, destination_path from seo_redirects where website_id = $1 and active",
    [websiteId],
  );
  if (input.active) assertSeoRedirectAcyclic(existing, source, destination, input.id);

  if (input.id) {
    const { rows } = await db.query<{ id: string }>(
      `update seo_redirects set source_path = $3, destination_path = $4, active = $5, updated_by = $6, updated_at = now()
       where id = $1 and client_id = $2 and website_id = $7 returning id`,
      [input.id, clientId, source, destination, input.active, actorUserId, websiteId],
    );
    if (!rows.length) throw new SeoSoftLaunchRuleError("Redirect not found for this client.");
  } else {
    await db.query(
      `insert into seo_redirects (client_id, website_id, source_path, destination_path, active, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $6)`,
      [clientId, websiteId, source, destination, input.active, actorUserId],
    );
  }
  await recordAudit(db, {
    actorType: "staff",
    actorUserId,
    action: input.id ? "seo.redirect.update" : "seo.redirect.create",
    targetType: "website",
    targetId: websiteId,
    clientId,
    outcome: "success",
    metadata: { source, destination, active: input.active, statusCode: 301 },
  });
}

export async function listSeoBusinessProfiles(db: Queryable, clientId?: string): Promise<SeoBusinessProfileRow[]> {
  const { rows } = await db.query<SeoBusinessProfileRow>(
    `select p.*, c.name as client_name from seo_business_profiles p join clients c on c.id = p.client_id
     where ($1::uuid is null or p.client_id = $1) order by c.name, p.branch_name`,
    [clientId ?? null],
  );
  return rows;
}

export async function saveSeoBusinessProfile(
  db: Queryable,
  clientId: string,
  input: { id?: string; branchName: string; profileUrl: string | null; externalIdentifier: string | null; setupStatus: SeoBusinessProfileRow["setup_status"]; notes: string | null },
  actorUserId: string,
): Promise<void> {
  const branchName = input.branchName.trim();
  if (!branchName || branchName.length > 120) throw new SeoSoftLaunchRuleError("Branch name must be 1–120 characters.");
  if (!["not_started", "in_progress", "staff_marked_verified"].includes(input.setupStatus)) throw new SeoSoftLaunchRuleError("Choose a valid setup status.");
  let profileUrl: string | null = null;
  if (input.profileUrl?.trim()) {
    let url: URL;
    try {
      url = new URL(input.profileUrl.trim());
    } catch {
      throw new SeoSoftLaunchRuleError("Enter a valid Google Business Profile URL.");
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !(host === "google.com" || host.endsWith(".google.com") || host === "g.page" || host === "maps.app.goo.gl")) {
      throw new SeoSoftLaunchRuleError("Use an HTTPS link on a Google domain.");
    }
    profileUrl = url.toString();
  }
  if ((input.externalIdentifier?.length ?? 0) > 200 || (input.notes?.length ?? 0) > 2000) {
    throw new SeoSoftLaunchRuleError("Profile ID must be at most 200 characters and notes at most 2,000 characters.");
  }
  if (input.id) {
    const { rows } = await db.query(
      `update seo_business_profiles set branch_name = $3, profile_url = $4, external_identifier = $5, setup_status = $6,
       notes = $7, updated_by = $8, updated_at = now() where id = $1 and client_id = $2 returning id`,
      [input.id, clientId, branchName, profileUrl, input.externalIdentifier?.trim() || null, input.setupStatus, input.notes?.trim() || null, actorUserId],
    );
    if (!rows.length) throw new SeoSoftLaunchRuleError("Business Profile record not found for this client.");
  } else {
    await db.query(
      `insert into seo_business_profiles (client_id, branch_name, profile_url, external_identifier, setup_status, notes, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [clientId, branchName, profileUrl, input.externalIdentifier?.trim() || null, input.setupStatus, input.notes?.trim() || null, actorUserId],
    );
  }
  await recordAudit(db, {
    actorType: "staff",
    actorUserId,
    action: input.id ? "seo.business_profile.update" : "seo.business_profile.create",
    targetType: "seo_business_profile",
    targetId: input.id ?? branchName,
    clientId,
    outcome: "success",
    metadata: { setupStatus: input.setupStatus },
  });
}

export async function issueSeoSiteToken(db: Queryable, clientId: string, websiteId: string, actorUserId: string): Promise<string> {
  await assertPublisher(db, actorUserId);
  await requireWebsiteForClient(db, websiteId, clientId);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.query("update seo_site_tokens set revoked_at = now() where website_id = $1 and revoked_at is null", [websiteId]);
  await db.query(
    "insert into seo_site_tokens (client_id, website_id, token_hash, created_by) values ($1, $2, $3, $4)",
    [clientId, websiteId, tokenHash, actorUserId],
  );
  await recordAudit(db, {
    actorType: "staff",
    actorUserId,
    action: "seo.site_token.rotate",
    targetType: "website",
    targetId: websiteId,
    clientId,
    outcome: "success",
  });
  return token;
}

export async function hasActiveSeoSiteToken(db: Queryable, websiteId: string): Promise<boolean> {
  const { rows } = await db.query(
    "select 1 from seo_site_tokens where website_id = $1 and revoked_at is null limit 1",
    [websiteId],
  );
  return rows.length > 0;
}

export async function getPublishedSeoConfiguration(db: Queryable, websiteId: string, token: string): Promise<{
  pages: Array<{ path: string; title: string; description: string; canonicalPath: string | null; indexable: boolean }>;
  redirects: Array<{ source: string; destination: string }>;
  googleSiteVerification: string | null;
} | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { rows: authorised } = await db.query(
    "select 1 from seo_site_tokens where website_id = $1 and token_hash = $2 and revoked_at is null",
    [websiteId, tokenHash],
  );
  if (!authorised.length) return null;
  const [pages, redirects, verification] = await Promise.all([
    db.query<{ page_path: string; title: string; description: string; canonical_path: string | null; indexable: boolean }>(
      "select page_path, title, description, canonical_path, indexable from seo_page_settings where website_id = $1 order by page_path",
      [websiteId],
    ),
    db.query<{ source_path: string; destination_path: string }>(
      "select source_path, destination_path from seo_redirects where website_id = $1 and active order by source_path",
      [websiteId],
    ),
    db.query<{ google_site_verification: string | null }>(
      "select google_site_verification from seo_website_settings where website_id = $1",
      [websiteId],
    ),
  ]);
  return {
    pages: pages.rows.map((p) => ({ path: p.page_path, title: p.title, description: p.description, canonicalPath: p.canonical_path, indexable: p.indexable })),
    redirects: redirects.rows.map((r) => ({ source: r.source_path, destination: r.destination_path })),
    googleSiteVerification: verification.rows[0]?.google_site_verification ?? null,
  };
}
