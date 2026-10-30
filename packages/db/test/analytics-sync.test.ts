import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";
import { bindConnectionFromState, createOAuthState, disconnectConnection, exchangeOAuthState, listConnections, saveConnection, setSourcePolicy } from "../src/analytics/connections";
import { enqueueJob, executeJob, leaseNext, sealedToken, type FetchLike, type FetchResponse } from "../src/analytics/sync";
import { publishedReport } from "../src/analytics/read";
import { encryptSecret } from "../src/analytics/crypto";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): FetchResponse {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("analytics tenant isolation and sync", () => {
  it("hides another clinic's connection and every secret from staff", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    const northgate = await clientBySlug("northgate-physio");
    await asContext(SERVICE, async (db) => {
      const harbourSite = (await db.query<{ id: string }>("select id from websites where client_id = $1 order by created_at limit 1", [harbour])).rows[0]!.id;
      const northgateSite = (await db.query<{ id: string }>("select id from websites where client_id = $1 order by created_at limit 1", [northgate])).rows[0]!.id;
      const harbourToken = sealedToken({ accessToken: "harbour-token", expiresAt: "2100-01-01T00:00:00.000Z" });
      const northToken = sealedToken({ accessToken: "north-token", expiresAt: "2100-01-01T00:00:00.000Z" });
      await saveConnection(db, {
        clientId: harbour, websiteId: harbourSite, provider: "ga4", externalPropertyId: "1001", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: harbourToken.ciphertext, tokenNonce: harbourToken.nonce, actorUserId: admin.id,
      });
      await saveConnection(db, {
        clientId: northgate, websiteId: northgateSite, provider: "ga4", externalPropertyId: "2002", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: northToken.ciphertext, tokenNonce: northToken.nonce, actorUserId: admin.id,
      });
      await applyContext(db, staffCtx(admin));
      expect((await db.query("select count(*)::int as n from analytics_secrets")).rows[0].n).toBe(0);
      await applyContext(db, staffCtx(specB));
      expect(await listConnections(db, harbour)).toHaveLength(0);
      expect((await listConnections(db, northgate)).map((row) => row.external_property_id)).toEqual(["2002"]);
      await expect(db.query(
        "insert into analytics_connections (client_id, website_id, provider, external_property_id, provider_timezone) values ($1, $2, 'ga4', '9', 'UTC')",
        [northgate, northgateSite],
      )).rejects.toThrow(/row-level security/);
    });
  });

  it("rejects a forged, replayed or empty property binding", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    await asContext(SERVICE, async (db) => {
      const site = (await db.query<{ id: string }>("select id from websites where client_id = $1 order by created_at limit 1", [harbour])).rows[0]!.id;
      await expect(exchangeOAuthState(db, { state: "forged-state", token: { accessToken: "x" } })).rejects.toThrow(/expired/);
      const created = await createOAuthState(db, {
        actorUserId: admin.id, clientId: harbour, websiteId: site, provider: "gsc", redirectUri: "http://localhost:3400/api/analytics/google/callback",
      });
      await exchangeOAuthState(db, { state: created.state, token: { accessToken: "access", expiresAt: "2100-01-01T00:00:00.000Z" } });
      await expect(bindConnectionFromState(db, {
        state: created.state, actorUserId: specA.id, externalPropertyId: "sc-domain:example.invalid", providerTimezone: "America/Los_Angeles",
      })).rejects.toThrow(/another person/);
      await expect(bindConnectionFromState(db, {
        state: created.state, actorUserId: admin.id, externalPropertyId: "  ", providerTimezone: "America/Los_Angeles",
      })).rejects.toThrow(/Choose a property/);
      const bound = await bindConnectionFromState(db, {
        state: created.state, actorUserId: admin.id, externalPropertyId: "sc-domain:example.invalid", providerTimezone: "America/Los_Angeles",
      });
      await expect(bindConnectionFromState(db, {
        state: created.state, actorUserId: admin.id, externalPropertyId: "sc-domain:example.invalid", providerTimezone: "America/Los_Angeles",
      })).rejects.toThrow(/not ready|expired/);
      await applyContext(db, staffCtx(admin));
      const listed = await listConnections(db, harbour);
      expect(listed.some((row) => row.id === bound.id)).toBe(true);
      expect(JSON.stringify(listed)).not.toContain("ciphertext");
    });
  });

  it("keeps the previous partition when a later page fails", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const clientId = await clientBySlug("meridian-skin");
    await asContext(SERVICE, async (db) => {
      const site = (await db.query<{ id: string }>("select id from websites where client_id = $1 order by created_at limit 1", [clientId])).rows[0]!.id;
      const sealed = sealedToken({ accessToken: "gsc-token", expiresAt: "2100-01-01T00:00:00.000Z" });
      const connection = await saveConnection(db, {
        clientId, websiteId: site, provider: "gsc", externalPropertyId: "sc-domain:meridian.example", streamOrSiteRef: null,
        providerTimezone: "America/Los_Angeles", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id,
      });
      let calls = 0;
      const fetchPages: FetchLike = async () => {
        calls += 1;
        const rows = calls === 1
          ? [{ keys: ["https://meridian.example/a"], clicks: 2, impressions: 10, ctr: 0.2, position: 4 }, { keys: ["https://meridian.example/b"], clicks: 1, impressions: 8, ctr: 0.125, position: 6 }]
          : [];
        return jsonResponse(200, { rows });
      };
      const now = new Date("2099-01-01T00:00:00.000Z");
      const job = await enqueueJob(db, { clientId, websiteId: site, connectionId: connection.id, templateKey: "gsc.pages", start: "2026-10-01", end: "2026-10-07" });
      const leased = await leaseNext(db, "test", now);
      expect(leased?.id).toBe(job.id);
      expect((await executeJob(db, leased!, { fetch: fetchPages, now, pageSize: 2 })).result).toBe("succeeded");
      calls = 0;
      const again = await enqueueJob(db, { clientId, websiteId: site, connectionId: connection.id, templateKey: "gsc.pages", start: "2026-10-01", end: "2026-10-07" });
      const second = await leaseNext(db, "test", new Date("2099-01-01T01:00:00.000Z"));
      expect(second?.id).toBe(again.id);
      const failed = await executeJob(db, second!, { fetch: fetchPages, now: new Date("2099-01-01T01:00:00.000Z"), pageSize: 2, failOnPage: 2 });
      const report = await publishedReport(db, { clientId, websiteId: site, templateKey: "gsc.pages", start: "2026-10-01", end: "2026-10-07" });
      expect(failed.result).toBe("failed");
      expect(report?.rows).toHaveLength(2);
      expect(report?.completeness).toBe("complete");
    });
  });

  it("leases one job and stops on rate limits or invalid_grant", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const clientId = await clientBySlug("harbourview-dental");
    await asContext(SERVICE, async (db) => {
      const site = (await db.query<{ id: string }>("select id from websites where client_id = $1 order by created_at limit 1", [clientId])).rows[0]!.id;
      const sealed = sealedToken({ accessToken: "old", refreshToken: "refresh", expiresAt: "2020-01-01T00:00:00.000Z" });
      const connection = await saveConnection(db, {
        clientId, websiteId: site, provider: "ga4", externalPropertyId: "3030", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id,
      });
      const limited: FetchLike = async (url) => url.includes("oauth2.googleapis.com")
        ? jsonResponse(200, { access_token: "new", expires_in: 3600 })
        : jsonResponse(429, {}, { "retry-after": "15" });
      const now = new Date("2099-01-01T02:00:00.000Z");
      await enqueueJob(db, { clientId, websiteId: site, connectionId: connection.id, templateKey: "ga4.traffic_daily", start: "2026-10-01", end: "2026-10-02" });
      const first = await leaseNext(db, "worker-a", now);
      expect(await leaseNext(db, "worker-b", now)).toBeNull();
      expect((await executeJob(db, first!, { fetch: limited, now, googleClientId: "id", googleClientSecret: "secret" })).result).toBe("retry");

      const revoked = sealedToken({ accessToken: "old", refreshToken: "refresh", expiresAt: "2020-01-01T00:00:00.000Z" });
      await db.query("update analytics_secrets set ciphertext = $2, nonce = $3 where connection_id = $1", [connection.id, revoked.ciphertext, revoked.nonce]);
      await enqueueJob(db, { clientId, websiteId: site, connectionId: connection.id, templateKey: "ga4.traffic_range", start: "2026-10-01", end: "2026-10-07" });
      const job = await leaseNext(db, "worker-c", now);
      const fetchRevoked: FetchLike = async () => jsonResponse(400, { error: "invalid_grant" });
      const result = await executeJob(db, job!, { fetch: fetchRevoked, now, googleClientId: "id", googleClientSecret: "secret" });
      const status = await db.query<{ status: string }>("select status from analytics_connections where id = $1", [connection.id]);
      expect(result.result).toBe("reconnect");
      expect(status.rows[0]?.status).toBe("reconnect_required");
    });
  });

  it("stores an exact-range user total without summing daily rows", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const clientId = await clientBySlug("meridian-skin");
    await asContext(SERVICE, async (db) => {
      const site = (await db.query<{ id: string }>("select id from websites where client_id = $1 order by created_at limit 1", [clientId])).rows[0]!.id;
      const sealed = sealedToken({ accessToken: "ga4", expiresAt: "2100-01-01T00:00:00.000Z" });
      const connection = await saveConnection(db, {
        clientId, websiteId: site, provider: "ga4", externalPropertyId: "4040", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id,
      });
      const fetchReport: FetchLike = async (_url, init) => {
        const body = JSON.parse(init?.body ?? "{}") as { dimensions?: unknown[] };
        if ((body.dimensions ?? []).length === 0) {
          return jsonResponse(200, {
            metricHeaders: [{ name: "sessions" }, { name: "totalUsers" }],
            rows: [{ metricValues: [{ value: "30" }, { value: "12" }] }],
          });
        }
        return jsonResponse(200, {
          dimensionHeaders: [{ name: "date" }],
          metricHeaders: [{ name: "sessions" }],
          rows: [
            { dimensionValues: [{ value: "20261001" }], metricValues: [{ value: "10" }] },
            { dimensionValues: [{ value: "20261002" }], metricValues: [{ value: "20" }] },
          ],
        });
      };
      const now = new Date("2099-01-01T04:00:00.000Z");
      for (const templateKey of ["ga4.traffic_daily", "ga4.traffic_range"]) {
        await enqueueJob(db, { clientId, websiteId: site, connectionId: connection.id, templateKey, start: "2026-10-01", end: "2026-10-02" });
        const job = await leaseNext(db, "worker-d", now);
        expect((await executeJob(db, job!, { fetch: fetchReport, now })).result).toBe("succeeded");
      }
      await applyContext(db, staffCtx(admin));
      const range = await publishedReport(db, { clientId, websiteId: site, templateKey: "ga4.traffic_range", start: "2026-10-01", end: "2026-10-02" });
      const daily = await publishedReport(db, { clientId, websiteId: site, templateKey: "ga4.traffic_daily", start: "2026-10-01", end: "2026-10-02" });
      const users = range?.rows[0]?.metrics.find((metric) => metric.key === "totalUsers")?.value;
      const dailySessions = (daily?.rows ?? []).reduce((sum, row) => sum + (row.metrics.find((metric) => metric.key === "sessions")?.value ?? 0), 0);
      expect(users).toBe(12);
      expect(dailySessions).toBe(30);
    });
  });

  it("rejects an overlapping source policy and allows reconnect after disconnect", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const clientId = await clientBySlug("northgate-physio");
    await asContext(SERVICE, async (db) => {
      const site = (await db.query<{ id: string }>("select id from websites where client_id = $1 order by created_at limit 1", [clientId])).rows[0]!.id;
      const first = encryptSecret(JSON.stringify({ accessToken: "a", expiresAt: "2100-01-01T00:00:00.000Z" }));
      const second = encryptSecret(JSON.stringify({ accessToken: "b", expiresAt: "2100-01-01T00:00:00.000Z" }));
      const left = await saveConnection(db, {
        clientId, websiteId: site, provider: "wix", externalPropertyId: "instance-a", streamOrSiteRef: "instance-a",
        providerTimezone: "Asia/Singapore", tokenCiphertext: first.ciphertext, tokenNonce: first.nonce, actorUserId: admin.id,
      });
      await setSourcePolicy(db, { clientId, websiteId: site, reportFamily: "traffic", connectionId: left.id, effectiveFrom: "2026-10-01", actorUserId: admin.id });
      await disconnectConnection(db, { connectionId: left.id, actorUserId: admin.id });
      const right = await saveConnection(db, {
        clientId, websiteId: site, provider: "wix", externalPropertyId: "instance-a", streamOrSiteRef: "instance-a",
        providerTimezone: "Asia/Singapore", tokenCiphertext: second.ciphertext, tokenNonce: second.nonce, actorUserId: admin.id,
      });
      await setSourcePolicy(db, { clientId, websiteId: site, reportFamily: "traffic", connectionId: right.id, effectiveFrom: "2026-10-01", actorUserId: admin.id });
      const open = await db.query<{ connection_id: string }>(
        "select connection_id from analytics_source_policies where website_id = $1 and report_family = 'traffic' and effective_to is null",
        [site],
      );
      expect(open.rows.map((row) => row.connection_id)).toEqual([right.id]);
      await expect(db.query(
        `insert into analytics_source_policies (client_id, website_id, report_family, connection_id, effective_from, changed_by)
         values ($1, $2, 'traffic', $3, '2026-10-01', $4)`,
        [clientId, site, left.id, admin.id],
      )).rejects.toThrow(/overlap/);
    });
  });
});
