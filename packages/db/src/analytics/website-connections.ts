import type { Queryable } from "../client";
import { recordAudit } from "../services/audit";
import { decryptSecret, tokenKeyConfigured } from "./crypto";
import type { AnalyticsProvider } from "./measure";
import { ga4PropertyPath, isInvalidGrant } from "./providers/ga4";
import { encodeSiteUrl } from "./providers/gsc";
import { freshProviderToken, providerFailureCode, type ConnectionRow, type SyncDeps, type TokenBundle } from "./sync";

/** The three connections an SEO website needs (SEO-08.1, D60). */
export type ConnectionRole = "platform" | "search" | "analytics";

export type ConnectionState =
  | "connected"
  | "pending"
  | "reconnect_required"
  | "disconnected"
  | "not_connected"
  | "credential_issued";

export const CONNECTION_CHECK_OUTCOMES = [
  "verified",
  "ownership_required",
  "no_property_access",
  "reconnect_required",
  "not_configured",
  "rate_limited",
  "provider_unavailable",
  "provider_rejected",
] as const;
export type ConnectionCheckOutcome = (typeof CONNECTION_CHECK_OUTCOMES)[number];

export const CONNECTION_CHECK_ACTION = "analytics.connection.check";

export interface ConnectionCheckRecord {
  at: Date;
  outcome: ConnectionCheckOutcome;
}

export interface WebsiteConnectionCard {
  role: ConnectionRole;
  provider: AnalyticsProvider | "settings_api" | null;
  connectionId: string | null;
  property: string | null;
  state: ConnectionState;
  /** When access was last verified, by connecting or by a passing check. Not a sync time. */
  verifiedAt: Date | null;
  /** Latest succeeded sync run for this website, provider and property, across reconnects. */
  lastSuccessAt: Date | null;
  failedJobs: number;
  syncError: string | null;
  lastCheck: ConnectionCheckRecord | null;
  issuedAt: Date | null;
}

export interface WebsiteConnections {
  websiteId: string;
  clientId: string;
  platform: string;
  cards: Record<ConnectionRole, WebsiteConnectionCard>;
}

interface ConnectionListRow {
  id: string;
  provider: AnalyticsProvider;
  external_property_id: string;
  status: string;
  verified_at: Date | null;
  disconnected_at: Date | null;
}

function isCheckOutcome(value: unknown): value is ConnectionCheckOutcome {
  return typeof value === "string" && (CONNECTION_CHECK_OUTCOMES as readonly string[]).includes(value);
}

function emptyCard(role: ConnectionRole): WebsiteConnectionCard {
  return {
    role,
    provider: null,
    connectionId: null,
    property: null,
    state: "not_connected",
    verifiedAt: null,
    lastSuccessAt: null,
    failedJobs: 0,
    syncError: null,
    lastCheck: null,
    issuedAt: null,
  };
}

function stateOf(row: Pick<ConnectionListRow, "status" | "disconnected_at">): ConnectionState {
  if (row.disconnected_at || row.status === "disconnected") return "disconnected";
  if (row.status === "connected" || row.status === "pending" || row.status === "reconnect_required") return row.status;
  return "pending";
}

export function isWixPlatform(platform: string): boolean {
  return platform.toLowerCase().includes("wix");
}

export function isSettingsApiPlatform(platform: string): boolean {
  return platform.toLowerCase().includes("next");
}

/**
 * Reads the website, Search Console and analytics connections of one website in the caller's context.
 * Under row-level security an unreadable website returns null and no connection data.
 */
export async function loadWebsiteConnections(db: Queryable, websiteId: string): Promise<WebsiteConnections | null> {
  const site = await db.query<{ id: string; client_id: string; platform: string }>(
    "select id, client_id, platform from websites where id = $1 and archived_at is null",
    [websiteId],
  );
  const website = site.rows[0];
  if (!website) return null;
  // Active rows first, then the newest, so a disconnected row is shown only when nothing replaced it.
  const { rows } = await db.query<ConnectionListRow>(
    `select id, provider, external_property_id, status, verified_at, disconnected_at
     from analytics_connections
     where website_id = $1
     order by (disconnected_at is null) desc, created_at desc`,
    [websiteId],
  );
  const search = rows.find((row) => row.provider === "gsc");
  const analytics = rows.find((row) => row.provider === "ga4" || row.provider === "wix");
  const cards: Record<ConnectionRole, WebsiteConnectionCard> = {
    platform: emptyCard("platform"),
    search: search ? await connectionCard(db, websiteId, "search", search) : emptyCard("search"),
    analytics: analytics ? await connectionCard(db, websiteId, "analytics", analytics) : emptyCard("analytics"),
  };
  if (isWixPlatform(website.platform)) {
    const wix = rows.find((row) => row.provider === "wix");
    if (wix) cards.platform = await connectionCard(db, websiteId, "platform", wix);
  } else if (isSettingsApiPlatform(website.platform)) {
    const token = await db.query<{ created_at: Date }>(
      "select created_at from seo_site_tokens where website_id = $1 and revoked_at is null order by created_at desc limit 1",
      [websiteId],
    );
    if (token.rows[0]) {
      cards.platform = { ...emptyCard("platform"), provider: "settings_api", state: "credential_issued", issuedAt: token.rows[0].created_at };
    }
  }
  return { websiteId: website.id, clientId: website.client_id, platform: website.platform, cards };
}

async function connectionCard(db: Queryable, websiteId: string, role: ConnectionRole, row: ConnectionListRow): Promise<WebsiteConnectionCard> {
  const { rows } = await db.query<{
    last_success_at: Date | string | null;
    failed: number;
    safe_error: string | null;
    checked_at: Date | string | null;
    check_outcome: string | null;
  }>(
    `select
       (select max(r.finished_at)
          from analytics_sync_runs r
          join analytics_connections c on c.id = r.connection_id
         where c.website_id = $2 and c.provider = $3 and c.external_property_id = $4 and r.result = 'succeeded') as last_success_at,
       (select count(*)::int from analytics_jobs j where j.connection_id = $1 and j.state = 'failed') as failed,
       (select j.safe_error_code from analytics_jobs j
         where j.connection_id = $1 and j.safe_error_code is not null
           and j.state in ('failed', 'reconnect_required', 'queued', 'leased')
         order by j.updated_at desc limit 1) as safe_error,
       a.occurred_at as checked_at,
       a.metadata ->> 'outcome' as check_outcome
     from (select 1) one
     left join lateral (
       select occurred_at, metadata from audit_events
        where action = $5 and target_type = 'analytics_connection' and target_id = $6
        order by occurred_at desc limit 1
     ) a on true`,
    [row.id, websiteId, row.provider, row.external_property_id, CONNECTION_CHECK_ACTION, row.id],
  );
  const extra = rows[0];
  const state = stateOf(row);
  const code = extra?.safe_error ?? "";
  return {
    role,
    provider: row.provider,
    connectionId: row.id,
    property: row.external_property_id,
    state,
    verifiedAt: row.verified_at,
    lastSuccessAt: extra?.last_success_at ? new Date(extra.last_success_at) : null,
    failedJobs: state === "disconnected" ? 0 : Number(extra?.failed ?? 0),
    syncError: state !== "disconnected" && /^[a-z0-9_]{1,64}$/.test(code) ? code : null,
    lastCheck: extra?.checked_at && isCheckOutcome(extra.check_outcome) ? { at: new Date(extra.checked_at), outcome: extra.check_outcome } : null,
    issuedAt: null,
  };
}

export interface ConnectionCheckTarget {
  connection: ConnectionRow;
  sealed: { ciphertext: string; nonce: string } | null;
}

/**
 * Loads one active connection of the given website for a check. Service context only, because it reads the
 * sealed credential. The caller must already have authorised the website for the staff member.
 */
export async function loadConnectionCheckTarget(db: Queryable, input: { websiteId: string; connectionId: string }): Promise<ConnectionCheckTarget | null> {
  const { rows } = await db.query<ConnectionRow>(
    `select id, client_id, website_id, provider, external_property_id, stream_or_site_ref, secret_ref, provider_timezone, status
     from analytics_connections
     where id = $1 and website_id = $2 and disconnected_at is null`,
    [input.connectionId, input.websiteId],
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

/**
 * Tests one connection directly against its provider. No database access, so provider I/O stays outside a
 * transaction. It reads no report data and stores nothing.
 */
export async function probeConnection(target: ConnectionCheckTarget, deps: SyncDeps): Promise<ConnectionCheckOutcome> {
  if (!target.sealed) return "reconnect_required";
  if (!tokenKeyConfigured()) return "not_configured";
  let token: TokenBundle;
  try {
    token = JSON.parse(decryptSecret(target.sealed.ciphertext, target.sealed.nonce)) as TokenBundle;
  } catch {
    return "reconnect_required";
  }
  const { connection } = target;
  let fresh: TokenBundle;
  try {
    fresh = await freshProviderToken(connection, token, deps);
  } catch (error) {
    return providerFailureCode(error);
  }
  // A Wix token issued for the stored instance confirms the app is still installed on that site.
  if (connection.provider === "wix") return "verified";
  let url: string;
  try {
    url = connection.provider === "gsc"
      ? `https://www.googleapis.com/webmasters/v3/sites/${encodeSiteUrl(connection.external_property_id)}`
      : `https://analyticsadmin.googleapis.com/v1beta/${ga4PropertyPath(connection.external_property_id)}`;
  } catch {
    return "provider_rejected";
  }
  let response: Awaited<ReturnType<SyncDeps["fetch"]>>;
  try {
    response = await deps.fetch(url, { method: "GET", headers: { Authorization: `Bearer ${fresh.accessToken}` } });
  } catch {
    return "provider_unavailable";
  }
  if (response.status === 401) return "reconnect_required";
  if (response.status === 429) return "rate_limited";
  if (response.status >= 500) return "provider_unavailable";
  if (response.status >= 400) {
    const body = await response.json().catch(() => ({}));
    if (isInvalidGrant(body)) return "reconnect_required";
    return response.status === 403 || response.status === 404 ? "no_property_access" : "provider_rejected";
  }
  if (connection.provider === "gsc") {
    const body = await response.json().catch(() => ({})) as { permissionLevel?: string };
    if (body.permissionLevel === "siteUnverifiedUser") return "ownership_required";
  }
  return "verified";
}

export interface RecordedConnectionCheck {
  outcome: ConnectionCheckOutcome;
  state: ConnectionState;
  checkedAt: Date;
}

/**
 * Stores the result of one check (D60). A pass sets verified_at and connected, and puts jobs that were waiting
 * for a reconnect back in the queue. A rejected credential sets reconnect required. Other outcomes leave the
 * status alone. Sync runs are never written, so the last successful sync is unchanged.
 * Returns null when the connection was disconnected while it was being checked.
 */
export async function recordConnectionCheck(db: Queryable, input: {
  websiteId: string;
  connectionId: string;
  outcome: ConnectionCheckOutcome;
  actorUserId: string;
  now?: Date;
}): Promise<RecordedConnectionCheck | null> {
  const now = input.now ?? new Date();
  const status = input.outcome === "verified" ? "connected" : input.outcome === "reconnect_required" ? "reconnect_required" : null;
  const locked = await db.query<{ status: string }>(
    "select status from analytics_connections where id = $1 and website_id = $2 and disconnected_at is null for update",
    [input.connectionId, input.websiteId],
  );
  const previous = locked.rows[0]?.status;
  if (!previous) return null;
  const { rows } = await db.query<{ id: string; client_id: string; provider: string; status: string }>(
    `update analytics_connections
     set status = coalesce($2, status),
         verified_at = case when $2 = 'connected' then $3::timestamptz else verified_at end,
         updated_at = $3
     where id = $1
     returning id, client_id, provider, status`,
    [input.connectionId, status, now.toISOString()],
  );
  const row = rows[0]!;
  let requeued = 0;
  if (input.outcome === "verified" && previous === "reconnect_required") {
    const restored = await db.query(
      `update analytics_jobs
       set state = 'queued', attempts = 0, next_attempt_at = $2, safe_error_code = null,
           lease_owner = null, lease_until = null, heartbeat_at = null, failed_at = null, updated_at = $2
       where connection_id = $1 and state = 'reconnect_required'`,
      [row.id, now.toISOString()],
    );
    requeued = restored.rowCount ?? 0;
  }
  await recordAudit(db, {
    actorType: "staff",
    actorUserId: input.actorUserId,
    action: CONNECTION_CHECK_ACTION,
    targetType: "analytics_connection",
    targetId: row.id,
    clientId: row.client_id,
    outcome: input.outcome === "verified" ? "success" : "failure",
    metadata: { outcome: input.outcome, provider: row.provider, websiteId: input.websiteId, ...(requeued ? { requeued } : {}) },
    occurredAt: now,
  });
  return { outcome: input.outcome, state: stateOf({ status: row.status, disconnected_at: null }), checkedAt: now };
}
