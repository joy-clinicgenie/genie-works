import { afterAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { disconnectConnection, saveConnection } from "../src/analytics/connections";
import { sealedToken, type FetchLike, type FetchResponse, type SyncDeps } from "../src/analytics/sync";
import {
  loadConnectionCheckTarget,
  loadWebsiteConnections,
  probeConnection,
  recordConnectionCheck,
  type ConnectionCheckTarget,
} from "../src/analytics/website-connections";
import { issueSeoSiteToken } from "../src/services/seo-soft-launch";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

function jsonResponse(status: number, body: unknown): FetchResponse {
  return { status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
}

const SEARCH_PROPERTY = "sc-domain:check.example.invalid";

async function connect(db: pg.PoolClient, input: { clientId: string; websiteId: string; provider: "gsc" | "ga4" | "wix"; property: string; actorId: string; refresh?: boolean }) {
  const token = sealedToken(input.refresh
    ? { accessToken: "stale", refreshToken: "fixture-refresh", expiresAt: "2000-01-01T00:00:00.000Z" }
    : { accessToken: "fixture-access", expiresAt: "2100-01-01T00:00:00.000Z" });
  return saveConnection(db, {
    clientId: input.clientId,
    websiteId: input.websiteId,
    provider: input.provider,
    externalPropertyId: input.property,
    streamOrSiteRef: input.provider === "wix" ? input.property : null,
    providerTimezone: input.provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore",
    tokenCiphertext: token.ciphertext,
    tokenNonce: token.nonce,
    actorUserId: input.actorId,
  });
}

/** One succeeded sync run at a fixed time, written as the worker would. Service context only. */
async function succeededRun(db: pg.PoolClient, connection: { id: string; client_id: string; website_id: string }, finishedAt: string, state = "succeeded") {
  const job = await db.query<{ id: string }>(
    `insert into analytics_jobs (client_id, website_id, connection_id, template_key, query_hash, start_date, end_date, state)
     values ($1, $2, $3, 'fixture.totals', repeat('a', 64), '2026-10-01', '2026-10-30', $4) returning id`,
    [connection.client_id, connection.website_id, connection.id, state],
  );
  await db.query(
    `insert into analytics_sync_runs (job_id, client_id, website_id, connection_id, started_at, finished_at, result)
     values ($1, $2, $3, $4, $5, $5, 'succeeded')`,
    [job.rows[0]!.id, connection.client_id, connection.website_id, connection.id, finishedAt],
  );
  return job.rows[0]!.id;
}

function googleDeps(site: { status: number; body: unknown }, token: { status: number; body: unknown } = { status: 200, body: { access_token: "fresh", expires_in: 3600 } }): SyncDeps & { urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    if (url === "https://oauth2.googleapis.com/token") return jsonResponse(token.status, token.body);
    return jsonResponse(site.status, site.body);
  };
  return { fetch, now: new Date("2026-11-20T02:00:00.000Z"), googleClientId: "fixture-client", googleClientSecret: "fixture-secret", wixAppId: "fixture-app", wixAppSecret: "fixture-app-secret", urls };
}

describe("SEO website connections (SEO-08.1)", () => {
  it("keeps Search Console usable and analytics last sync unchanged after analytics is disconnected", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id, [specA.id]);
      const search = await connect(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, provider: "gsc", property: SEARCH_PROPERTY, actorId: admin.id });
      const analytics = await connect(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, provider: "ga4", property: "123456", actorId: admin.id });
      const preview = await connect(db, { clientId: clinic.clientId, websiteId: clinic.stagingId, provider: "ga4", property: "654321", actorId: admin.id });
      await succeededRun(db, search, "2026-11-18T01:00:00.000Z");
      await succeededRun(db, analytics, "2026-11-19T03:30:00.000Z");
      await succeededRun(db, preview, "2026-11-10T08:00:00.000Z");

      await applyContext(db, staffCtx(specA));
      const before = await loadWebsiteConnections(db, clinic.websiteId);
      expect(before?.cards.search).toMatchObject({ state: "connected", provider: "gsc", property: SEARCH_PROPERTY, lastSuccessAt: new Date("2026-11-18T01:00:00.000Z") });
      expect(before?.cards.analytics).toMatchObject({ state: "connected", provider: "ga4", property: "123456", lastSuccessAt: new Date("2026-11-19T03:30:00.000Z") });

      // Each environment is its own website record with its own analytics property and sync history.
      const staging = await loadWebsiteConnections(db, clinic.stagingId);
      expect(staging?.cards.analytics).toMatchObject({ property: "654321", lastSuccessAt: new Date("2026-11-10T08:00:00.000Z") });
      expect(staging?.cards.search.state).toBe("not_connected");

      await applyContext(db, SERVICE);
      await disconnectConnection(db, { connectionId: analytics.id, actorUserId: admin.id });

      await applyContext(db, staffCtx(specA));
      const after = await loadWebsiteConnections(db, clinic.websiteId);
      expect(after?.cards.analytics).toMatchObject({ state: "disconnected", property: "123456", lastSuccessAt: new Date("2026-11-19T03:30:00.000Z") });
      expect(after?.cards.search).toEqual(before?.cards.search);
      const stagingAfter = await loadWebsiteConnections(db, clinic.stagingId);
      expect(stagingAfter?.cards.analytics.state).toBe("connected");
    });
  });

  it("returns no connection data for another clinic's website", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id, [specA.id]);
      const search = await connect(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, provider: "gsc", property: SEARCH_PROPERTY, actorId: admin.id });
      await succeededRun(db, search, "2026-11-18T01:00:00.000Z");
      await recordConnectionCheck(db, { websiteId: clinic.websiteId, connectionId: search.id, outcome: "verified", actorUserId: admin.id });

      await applyContext(db, staffCtx(specB));
      expect(await loadWebsiteConnections(db, clinic.websiteId)).toBeNull();
      expect((await db.query("select count(*)::int as n from analytics_connections where website_id = $1", [clinic.websiteId])).rows[0].n).toBe(0);
      expect((await db.query("select count(*)::int as n from audit_events where target_id = $1", [search.id])).rows[0].n).toBe(0);

      await applyContext(db, staffCtx(specA));
      expect((await loadWebsiteConnections(db, clinic.websiteId))?.cards.search.lastCheck?.outcome).toBe("verified");
    });
  });

  it("checks Search Console permission, including ownership verification", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const search = await connect(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, provider: "gsc", property: SEARCH_PROPERTY, actorId: admin.id, refresh: true });
      const target = await loadConnectionCheckTarget(db, { websiteId: clinic.websiteId, connectionId: search.id }) as ConnectionCheckTarget;
      expect(target.sealed).not.toBeNull();

      const owner = googleDeps({ status: 200, body: { siteUrl: SEARCH_PROPERTY, permissionLevel: "siteOwner" } });
      expect(await probeConnection(target, owner)).toBe("verified");
      expect(owner.urls).toEqual(["https://oauth2.googleapis.com/token", `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SEARCH_PROPERTY)}`]);

      expect(await probeConnection(target, googleDeps({ status: 200, body: { siteUrl: SEARCH_PROPERTY, permissionLevel: "siteUnverifiedUser" } }))).toBe("ownership_required");
      expect(await probeConnection(target, googleDeps({ status: 403, body: { error: { status: "PERMISSION_DENIED" } } }))).toBe("no_property_access");
      expect(await probeConnection(target, googleDeps({ status: 401, body: {} }))).toBe("reconnect_required");
      expect(await probeConnection(target, googleDeps({ status: 503, body: {} }))).toBe("provider_unavailable");
      expect(await probeConnection(target, googleDeps({ status: 429, body: {} }))).toBe("rate_limited");
      expect(await probeConnection(target, googleDeps({ status: 200, body: {} }, { status: 400, body: { error: "invalid_grant" } }))).toBe("reconnect_required");
      expect(await probeConnection(target, { ...googleDeps({ status: 200, body: {} }), googleClientId: undefined })).toBe("not_configured");
      expect(await probeConnection({ ...target, sealed: null }, owner)).toBe("reconnect_required");
      // A request that never completes (network failure or the local fixture guard) is not a rejection.
      const unreachable: FetchLike = async () => { throw new Error("Fixture mode refused a non-local provider host."); };
      expect(await probeConnection(target, { ...owner, fetch: unreachable })).toBe("provider_unavailable");
    });
  });

  it("checks a GA4 property and a Wix instance independently", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const ga4 = await connect(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, provider: "ga4", property: "123456", actorId: admin.id });
      const ga4Target = await loadConnectionCheckTarget(db, { websiteId: clinic.websiteId, connectionId: ga4.id }) as ConnectionCheckTarget;
      const deps = googleDeps({ status: 200, body: { name: "properties/123456" } });
      expect(await probeConnection(ga4Target, deps)).toBe("verified");
      expect(deps.urls).toEqual(["https://analyticsadmin.googleapis.com/v1beta/properties/123456"]);
      expect(await probeConnection(ga4Target, googleDeps({ status: 404, body: {} }))).toBe("no_property_access");

      const wix = await connect(db, { clientId: clinic.clientId, websiteId: clinic.stagingId, provider: "wix", property: "fixture-instance", actorId: admin.id });
      const wixTarget = await loadConnectionCheckTarget(db, { websiteId: clinic.stagingId, connectionId: wix.id }) as ConnectionCheckTarget;
      const wixCalls: string[] = [];
      const wixOk: FetchLike = async (url) => { wixCalls.push(url); return jsonResponse(200, { access_token: "wix", expires_in: 3600 }); };
      expect(await probeConnection(wixTarget, { ...deps, fetch: wixOk })).toBe("verified");
      expect(wixCalls).toEqual(["https://www.wixapis.com/oauth2/token"]);
      const wixRevoked: FetchLike = async () => jsonResponse(401, {});
      expect(await probeConnection(wixTarget, { ...deps, fetch: wixRevoked })).toBe("reconnect_required");

      // A connection is only checked through its own website.
      expect(await loadConnectionCheckTarget(db, { websiteId: clinic.websiteId, connectionId: wix.id })).toBeNull();
    });
  });

  it("records checks without touching the last successful sync", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const analytics = await connect(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, provider: "ga4", property: "123456", actorId: admin.id });
      await succeededRun(db, analytics, "2026-11-19T03:30:00.000Z");
      const waiting = await succeededRun(db, analytics, "2026-11-15T03:30:00.000Z", "reconnect_required");
      await db.query("update analytics_connections set verified_at = '2026-11-01T00:00:00Z' where id = $1", [analytics.id]);
      const runs = async () => (await db.query("select count(*)::int as n from analytics_sync_runs where connection_id = $1", [analytics.id])).rows[0].n;
      const count = await runs();

      const failed = await recordConnectionCheck(db, { websiteId: clinic.websiteId, connectionId: analytics.id, outcome: "provider_unavailable", actorUserId: admin.id, now: new Date("2026-11-20T01:00:00Z") });
      expect(failed?.state).toBe("connected");
      let card = (await loadWebsiteConnections(db, clinic.websiteId))!.cards.analytics;
      expect(card).toMatchObject({ state: "connected", verifiedAt: new Date("2026-11-01T00:00:00Z"), lastSuccessAt: new Date("2026-11-19T03:30:00.000Z") });
      expect(card.lastCheck?.outcome).toBe("provider_unavailable");

      const rejected = await recordConnectionCheck(db, { websiteId: clinic.websiteId, connectionId: analytics.id, outcome: "reconnect_required", actorUserId: admin.id, now: new Date("2026-11-20T01:05:00Z") });
      expect(rejected?.state).toBe("reconnect_required");

      const passed = await recordConnectionCheck(db, { websiteId: clinic.websiteId, connectionId: analytics.id, outcome: "verified", actorUserId: admin.id, now: new Date("2026-11-20T01:10:00Z") });
      expect(passed?.state).toBe("connected");
      card = (await loadWebsiteConnections(db, clinic.websiteId))!.cards.analytics;
      expect(card).toMatchObject({ state: "connected", verifiedAt: new Date("2026-11-20T01:10:00Z"), lastSuccessAt: new Date("2026-11-19T03:30:00.000Z") });
      expect(card.lastCheck).toEqual({ at: new Date("2026-11-20T01:10:00Z"), outcome: "verified" });
      expect(await runs()).toBe(count);
      expect((await db.query("select state from analytics_jobs where id = $1", [waiting])).rows[0].state).toBe("queued");

      await disconnectConnection(db, { connectionId: analytics.id, actorUserId: admin.id });
      expect(await recordConnectionCheck(db, { websiteId: clinic.websiteId, connectionId: analytics.id, outcome: "verified", actorUserId: admin.id })).toBeNull();
    });
  });

  it("shows a website settings credential as issued, not connected", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      expect((await loadWebsiteConnections(db, clinic.websiteId))?.cards.platform.state).toBe("not_connected");
      await applyContext(db, staffCtx(admin));
      await issueSeoSiteToken(db, clinic.clientId, clinic.websiteId, admin.id);
      const platform = (await loadWebsiteConnections(db, clinic.websiteId))!.cards.platform;
      expect(platform).toMatchObject({ provider: "settings_api", state: "credential_issued" });
      expect(platform.issuedAt).toBeInstanceOf(Date);
    });
  });
});
