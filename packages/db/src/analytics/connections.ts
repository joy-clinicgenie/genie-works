import type { Queryable } from "../client";
import { recordAudit } from "../services/audit";
import { sha256 } from "../services/references";
import { encryptSecret, randomUrlToken, decryptSecret } from "./crypto";
import type { AnalyticsProvider } from "./measure";

export class AnalyticsRuleError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "AnalyticsRuleError";
    this.field = field;
  }
}

export interface PublicConnection {
  id: string;
  client_id: string;
  website_id: string;
  provider: AnalyticsProvider;
  external_property_id: string;
  stream_or_site_ref: string | null;
  status: string;
  provider_timezone: string | null;
  verified_at: Date | null;
  version: number;
  disconnected_at: Date | null;
}

const PUBLIC_COLUMNS = `id, client_id, website_id, provider, external_property_id, stream_or_site_ref, status, provider_timezone, verified_at, version, disconnected_at`;

export async function listConnections(db: Queryable, clientId: string): Promise<PublicConnection[]> {
  const { rows } = await db.query<PublicConnection>(
    `select ${PUBLIC_COLUMNS} from analytics_connections where client_id = $1 order by provider, created_at`,
    [clientId],
  );
  return rows;
}

export async function createOAuthState(db: Queryable, input: {
  actorUserId: string;
  clientId: string;
  websiteId: string;
  provider: AnalyticsProvider;
  redirectUri: string;
  now?: Date;
}): Promise<{ id: string; state: string; verifier: string }> {
  await assertWebsite(db, input.clientId, input.websiteId);
  const state = randomUrlToken();
  const verifier = randomUrlToken(48);
  const secret = encryptSecret(verifier);
  const expires = new Date((input.now ?? new Date()).getTime() + 10 * 60 * 1000);
  const { rows } = await db.query<{ id: string }>(
    `insert into analytics_oauth_states
      (state_hash, actor_user_id, client_id, website_id, provider, redirect_uri, code_verifier_ciphertext, code_verifier_nonce, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [sha256(state), input.actorUserId, input.clientId, input.websiteId, input.provider, input.redirectUri, secret.ciphertext, secret.nonce, expires.toISOString()],
  );
  return { id: rows[0]!.id, state, verifier };
}

export async function exchangeOAuthState(db: Queryable, input: { state: string; token: unknown; now?: Date }): Promise<{ id: string; clientId: string; websiteId: string; provider: AnalyticsProvider; actorUserId: string }> {
  const row = await loadState(db, input.state, input.now ?? new Date());
  if (row.exchanged_at || row.used_at) throw new AnalyticsRuleError("This connection attempt was already used.");
  const secret = encryptSecret(JSON.stringify(input.token));
  await db.query(
    `update analytics_oauth_states set token_ciphertext = $2, token_nonce = $3, exchanged_at = now() where id = $1 and exchanged_at is null`,
    [row.id, secret.ciphertext, secret.nonce],
  );
  return { id: row.id, clientId: row.client_id, websiteId: row.website_id, provider: row.provider, actorUserId: row.actor_user_id };
}

export async function bindConnectionFromState(db: Queryable, input: {
  state: string;
  actorUserId: string;
  externalPropertyId: string;
  providerTimezone: string;
  streamOrSiteRef?: string | null;
  now?: Date;
}): Promise<PublicConnection> {
  if (!input.externalPropertyId.trim()) throw new AnalyticsRuleError("Choose a property before connecting.", "externalPropertyId");
  const row = await loadState(db, input.state, input.now ?? new Date());
  if (row.actor_user_id !== input.actorUserId) throw new AnalyticsRuleError("This connection attempt belongs to another person.");
  if (!row.exchanged_at || row.used_at || !row.token_ciphertext || !row.token_nonce) throw new AnalyticsRuleError("This connection attempt is not ready.");
  const connection = await saveConnection(db, {
    clientId: row.client_id,
    websiteId: row.website_id,
    provider: row.provider,
    externalPropertyId: input.externalPropertyId.trim(),
    streamOrSiteRef: input.streamOrSiteRef ?? null,
    providerTimezone: input.providerTimezone,
    tokenCiphertext: row.token_ciphertext,
    tokenNonce: row.token_nonce,
    actorUserId: input.actorUserId,
  });
  await db.query("update analytics_oauth_states set used_at = now() where id = $1 and used_at is null", [row.id]);
  return connection;
}

export async function saveConnection(db: Queryable, input: {
  clientId: string;
  websiteId: string;
  provider: AnalyticsProvider;
  externalPropertyId: string;
  streamOrSiteRef: string | null;
  providerTimezone: string;
  tokenCiphertext: string;
  tokenNonce: string;
  actorUserId: string;
}): Promise<PublicConnection> {
  await assertWebsite(db, input.clientId, input.websiteId);
  const { rows } = await db.query<PublicConnection>(
    `insert into analytics_connections
      (client_id, website_id, provider, external_property_id, stream_or_site_ref, status, provider_timezone, verified_at, created_by)
     values ($1, $2, $3, $4, $5, 'connected', $6, now(), $7)
     returning ${PUBLIC_COLUMNS}`,
    [input.clientId, input.websiteId, input.provider, input.externalPropertyId, input.streamOrSiteRef, input.providerTimezone, input.actorUserId],
  );
  const connection = rows[0]!;
  const { rows: secrets } = await db.query<{ id: string }>(
    `insert into analytics_secrets (connection_id, client_id, website_id, ciphertext, nonce) values ($1, $2, $3, $4, $5) returning id`,
    [connection.id, input.clientId, input.websiteId, input.tokenCiphertext, input.tokenNonce],
  );
  await db.query("update analytics_connections set secret_ref = $2, updated_at = now() where id = $1", [connection.id, secrets[0]!.id]);
  await recordAudit(db, {
    actorType: "staff",
    actorUserId: input.actorUserId,
    action: "analytics.connection.bind",
    targetType: "analytics_connection",
    targetId: connection.id,
    clientId: input.clientId,
    outcome: "success",
    metadata: { provider: input.provider, websiteId: input.websiteId },
  });
  return connection;
}

export async function disconnectConnection(db: Queryable, input: { connectionId: string; actorUserId: string }): Promise<void> {
  const { rows } = await db.query<{ id: string; client_id: string }>(
    `update analytics_connections set status = 'disconnected', disconnected_at = now(), updated_at = now()
     where id = $1 and disconnected_at is null returning id, client_id`,
    [input.connectionId],
  );
  const row = rows[0];
  if (!row) throw new AnalyticsRuleError("That connection is not active.");
  await db.query(
    `update analytics_jobs set state = 'cancelled', updated_at = now() where connection_id = $1 and state in ('queued', 'leased')`,
    [row.id],
  );
  await recordAudit(db, {
    actorType: "staff",
    actorUserId: input.actorUserId,
    action: "analytics.connection.disconnect",
    targetType: "analytics_connection",
    targetId: row.id,
    clientId: row.client_id,
    outcome: "success",
  });
}

export async function setSourcePolicy(db: Queryable, input: {
  clientId: string;
  websiteId: string;
  reportFamily: string;
  connectionId: string;
  effectiveFrom: string;
  actorUserId: string;
}): Promise<void> {
  await db.query(
    `update analytics_source_policies set effective_to = $3::date - 1
     where website_id = $1 and report_family = $2 and effective_to is null and effective_from < $3::date`,
    [input.websiteId, input.reportFamily, input.effectiveFrom],
  );
  const replaced = await db.query(
    `update analytics_source_policies set connection_id = $4, changed_by = $5
     where website_id = $1 and report_family = $2 and effective_to is null and effective_from = $3::date
     returning id`,
    [input.websiteId, input.reportFamily, input.effectiveFrom, input.connectionId, input.actorUserId],
  );
  if (replaced.rows.length > 0) return;
  await db.query(
    `insert into analytics_source_policies (client_id, website_id, report_family, connection_id, effective_from, changed_by)
     values ($1, $2, $3, $4, $5, $6)`,
    [input.clientId, input.websiteId, input.reportFamily, input.connectionId, input.effectiveFrom, input.actorUserId],
  );
}

export async function readExchangedToken(db: Queryable, state: string, actorUserId: string, now = new Date()): Promise<{ provider: AnalyticsProvider; clientId: string; websiteId: string; accessToken: string } | null> {
  const { rows } = await db.query<{
    actor_user_id: string;
    client_id: string;
    website_id: string;
    provider: AnalyticsProvider;
    expires_at: Date;
    used_at: Date | null;
    token_ciphertext: string | null;
    token_nonce: string | null;
  }>(
    `select actor_user_id, client_id, website_id, provider, expires_at, used_at, token_ciphertext, token_nonce
     from analytics_oauth_states where state_hash = $1`,
    [sha256(state)],
  );
  const row = rows[0];
  if (!row || row.actor_user_id !== actorUserId || row.used_at || !row.token_ciphertext || !row.token_nonce) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) return null;
  const token = JSON.parse(decryptSecret(row.token_ciphertext, row.token_nonce)) as { accessToken?: string };
  if (!token.accessToken) return null;
  return { provider: row.provider, clientId: row.client_id, websiteId: row.website_id, accessToken: token.accessToken };
}

async function assertWebsite(db: Queryable, clientId: string, websiteId: string): Promise<void> {
  const { rows } = await db.query("select 1 from websites where id = $1 and client_id = $2", [websiteId, clientId]);
  if (!rows[0]) throw new AnalyticsRuleError("That website is not on this clinic.", "websiteId");
}

async function loadState(db: Queryable, state: string, now: Date): Promise<{
  id: string;
  actor_user_id: string;
  client_id: string;
  website_id: string;
  provider: AnalyticsProvider;
  expires_at: Date;
  exchanged_at: Date | null;
  used_at: Date | null;
  token_ciphertext: string | null;
  token_nonce: string | null;
}> {
  const { rows } = await db.query<{
    id: string;
    actor_user_id: string;
    client_id: string;
    website_id: string;
    provider: AnalyticsProvider;
    expires_at: Date;
    exchanged_at: Date | null;
    used_at: Date | null;
    token_ciphertext: string | null;
    token_nonce: string | null;
  }>(
    `select id, actor_user_id, client_id, website_id, provider, expires_at, exchanged_at, used_at, token_ciphertext, token_nonce
     from analytics_oauth_states where state_hash = $1`,
    [sha256(state)],
  );
  const row = rows[0];
  if (!row || new Date(row.expires_at).getTime() <= now.getTime()) throw new AnalyticsRuleError("This connection attempt has expired.");
  return row;
}
