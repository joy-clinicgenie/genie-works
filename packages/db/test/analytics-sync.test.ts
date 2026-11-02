import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { bindConnectionFromState, createOAuthState, disconnectConnection, exchangeOAuthState, listConnections, saveConnection, setSourcePolicy } from "../src/analytics/connections";
import { dueWindow, enqueueDue, enqueueJob, executeJob, leaseNext, listConnectionSyncStatus, sealedToken, type FetchLike, type FetchResponse } from "../src/analytics/sync";
import { publishedReport } from "../src/analytics/read";
import { encryptSecret } from "../src/analytics/crypto";
import { createClient, createWebsite, grantMembership } from "../src/services/registry";

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
    await asContext(SERVICE, async (db) => {
      const hiddenClinic = await provisionClinic(db, admin.id);
      const hidden = hiddenClinic.clientId;
      const hiddenSite = hiddenClinic.websiteId;
      const owned = await createClient(db, {
        slug: "fixture-owned-clinic", name: "Fixture owned clinic", ownerUserId: admin.id, channels: ["website"], isSynthetic: true, notes: null,
      }, admin.id);
      const ownedSite = (await createWebsite(db, {
        clientId: owned.id, name: "Fixture owned site", url: "https://fixture-owned.example.invalid", platform: "Next.js", environment: "production", notes: null,
      }, admin.id)).id;
      await grantMembership(db, { userId: specB.id, clientId: owned.id }, admin.id);
      const hiddenToken = sealedToken({ accessToken: "hidden-token", expiresAt: "2100-01-01T00:00:00.000Z" });
      const ownedToken = sealedToken({ accessToken: "owned-token", expiresAt: "2100-01-01T00:00:00.000Z" });
      await saveConnection(db, {
        clientId: hidden, websiteId: hiddenSite, provider: "ga4", externalPropertyId: "1001", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: hiddenToken.ciphertext, tokenNonce: hiddenToken.nonce, actorUserId: admin.id,
      });
      await saveConnection(db, {
        clientId: owned.id, websiteId: ownedSite, provider: "ga4", externalPropertyId: "2002", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: ownedToken.ciphertext, tokenNonce: ownedToken.nonce, actorUserId: admin.id,
      });
      await applyContext(db, staffCtx(admin));
      expect((await db.query("select count(*)::int as n from analytics_secrets")).rows[0].n).toBe(0);
      await applyContext(db, staffCtx(specB));
      expect(await listConnections(db, hidden)).toHaveLength(0);
      expect((await listConnections(db, owned.id)).map((row) => row.external_property_id)).toEqual(["2002"]);
      await expect(db.query(
        "insert into analytics_connections (client_id, website_id, provider, external_property_id, provider_timezone) values ($1, $2, 'ga4', '9', 'UTC')",
        [owned.id, ownedSite],
      )).rejects.toThrow(/row-level security/);
    });
  });

  it("rejects a forged, replayed or empty property binding", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    await asContext(SERVICE, async (db) => {
      const harbourClinic = await provisionClinic(db, admin.id);
      const harbour = harbourClinic.clientId;
      const site = harbourClinic.websiteId;
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
    await asContext(SERVICE, async (db) => {
      const provisioned = await provisionClinic(db, admin.id);
      const clientId = provisioned.clientId;
      const site = provisioned.websiteId;
      await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
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
    await asContext(SERVICE, async (db) => {
      const provisioned = await provisionClinic(db, admin.id);
      const clientId = provisioned.clientId;
      const site = provisioned.websiteId;
      await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
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
    await asContext(SERVICE, async (db) => {
      const provisioned = await provisionClinic(db, admin.id);
      const clientId = provisioned.clientId;
      const site = provisioned.websiteId;
      await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
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
    await asContext(SERVICE, async (db) => {
      const provisioned = await provisionClinic(db, admin.id);
      const clientId = provisioned.clientId;
      const site = provisioned.websiteId;
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

  it("uses the provider timezone for the due window", () => {
    const instant = new Date("2026-10-30T16:30:00.000Z");
    expect(dueWindow("ga4", instant, "Asia/Singapore")).toEqual({ start: "2026-10-24", end: "2026-10-31" });
    expect(dueWindow("ga4", instant, "UTC")).toEqual({ start: "2026-10-23", end: "2026-10-30" });
    expect(dueWindow("wix", instant, "Asia/Singapore").end).toBe("2026-10-31");
    expect(dueWindow("wix", instant, "UTC").end).toBe("2026-10-30");
    expect(dueWindow("gsc", instant, "Asia/Singapore")).toEqual({ start: "2026-10-18", end: "2026-10-27" });
  });

  it("queues the provider-timezone window and reuses a queued job", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const provisioned = await provisionClinic(db, admin.id);
      const clientId = provisioned.clientId;
      const site = provisioned.websiteId;
      const sealed = sealedToken({ accessToken: "window", expiresAt: "2100-01-01T00:00:00.000Z" });
      const connection = await saveConnection(db, {
        clientId, websiteId: site, provider: "ga4", externalPropertyId: "5050", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id,
      });
      const instant = new Date("2026-10-30T16:30:00.000Z");
      await enqueueDue(db, instant, site);
      const queued = await db.query<{ end_date: string }>(
        "select end_date::text as end_date from analytics_jobs where connection_id = $1 and template_key = 'ga4.traffic_daily'",
        [connection.id],
      );
      expect(queued.rows.map((row) => row.end_date)).toEqual(["2026-10-31"]);
      const first = await enqueueJob(db, { clientId, websiteId: site, connectionId: connection.id, templateKey: "ga4.traffic_daily", start: "2026-10-24", end: "2026-10-31" });
      const second = await enqueueJob(db, { clientId, websiteId: site, connectionId: connection.id, templateKey: "ga4.traffic_daily", start: "2026-10-24", end: "2026-10-31" });
      expect(second).toEqual({ id: first.id, reused: true });
    });
  });

  it("stops a retryable job after five attempts and fails an expired lease at the same limit", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const provisioned = await provisionClinic(db, admin.id);
      const clientId = provisioned.clientId;
      const site = provisioned.websiteId;
      const sealed = sealedToken({ accessToken: "limited", expiresAt: "2100-01-01T00:00:00.000Z" });
      const connection = await saveConnection(db, {
        clientId, websiteId: site, provider: "ga4", externalPropertyId: "6060", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id,
      });
      await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
      const limited: FetchLike = async () => jsonResponse(429, {}, { "retry-after": "1" });
      const start = new Date("2099-06-01T00:00:00.000Z");
      const queued = await enqueueJob(db, { clientId, websiteId: site, connectionId: connection.id, templateKey: "ga4.traffic_daily", start: "2026-10-01", end: "2026-10-02" });
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const now = new Date(start.getTime() + attempt * 60_000);
        const job = await leaseNext(db, "retry-worker", now);
        expect(job?.id).toBe(queued.id);
        expect((await executeJob(db, job!, { fetch: limited, now })).result).toBe("retry");
      }
      const fifthNow = new Date(start.getTime() + 10 * 60_000);
      const fifth = await leaseNext(db, "retry-worker", fifthNow);
      expect((await executeJob(db, fifth!, { fetch: limited, now: fifthNow })).result).toBe("failed");
      const failed = await db.query<{ state: string; attempts: number; safe_error_code: string }>(
        "select state, attempts, safe_error_code from analytics_jobs where id = $1",
        [queued.id],
      );
      expect(failed.rows[0]).toMatchObject({ state: "failed", attempts: 5, safe_error_code: "rate_limited" });

      const crashed = await enqueueJob(db, { clientId, websiteId: site, connectionId: connection.id, templateKey: "ga4.traffic_range", start: "2026-10-01", end: "2026-10-02" });
      let cursor = new Date("2099-07-01T00:00:00.000Z");
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (attempt > 0) {
          await db.query("update analytics_jobs set lease_until = $2 where id = $1", [crashed.id, new Date(cursor.getTime() - 1000).toISOString()]);
        }
        const leased = await leaseNext(db, `owner-${attempt}`, cursor);
        expect(leased?.id).toBe(crashed.id);
        cursor = new Date(cursor.getTime() + 60_000);
      }
      await db.query("update analytics_jobs set lease_until = $2 where id = $1", [crashed.id, new Date(cursor.getTime() - 1000).toISOString()]);
      expect(await leaseNext(db, "owner-final", cursor)).toBeNull();
      const expired = await db.query<{ state: string; attempts: number; safe_error_code: string }>(
        "select state, attempts, safe_error_code from analytics_jobs where id = $1",
        [crashed.id],
      );
      expect(expired.rows[0]).toMatchObject({ state: "failed", attempts: 5, safe_error_code: "lease_expired" });
    });
  });

  it("reports the last succeeded sync and hides another clinic's queue", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const clinicGenie = await clientBySlug("clinic-genie");
    await asContext(SERVICE, async (db) => {
      const harbourClinic = await provisionClinic(db, admin.id);
      const harbour = harbourClinic.clientId;
      const site = harbourClinic.websiteId;
      const sealed = sealedToken({ accessToken: "status", expiresAt: "2100-01-01T00:00:00.000Z" });
      const connection = await saveConnection(db, {
        clientId: harbour, websiteId: site, provider: "ga4", externalPropertyId: "7070", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id,
      });
      await db.query("update analytics_connections set verified_at = '2020-01-01T00:00:00.000Z' where id = $1", [connection.id]);
      const checked = await listConnectionSyncStatus(db, harbour);
      expect(checked.find((row) => row.connectionId === connection.id)?.lastSuccessAt).toBeNull();

      await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
      const rejected: FetchLike = async () => jsonResponse(400, { error: "rejected" });
      const now = new Date("2099-08-01T00:00:00.000Z");
      await enqueueJob(db, { clientId: harbour, websiteId: site, connectionId: connection.id, templateKey: "ga4.device", start: "2026-10-01", end: "2026-10-01" });
      const failedJob = await leaseNext(db, "status-worker", now);
      expect((await executeJob(db, failedJob!, { fetch: rejected, now })).result).toBe("failed");

      const accepted: FetchLike = async () => jsonResponse(200, {
        dimensionHeaders: [{ name: "date" }],
        metricHeaders: [{ name: "sessions" }],
        rows: [{ dimensionValues: [{ value: "20261001" }], metricValues: [{ value: "3" }] }],
      });
      await enqueueJob(db, { clientId: harbour, websiteId: site, connectionId: connection.id, templateKey: "ga4.traffic_daily", start: "2026-10-01", end: "2026-10-01" });
      const succeededJob = await leaseNext(db, "status-worker", now);
      expect((await executeJob(db, succeededJob!, { fetch: accepted, now })).result).toBe("succeeded");

      const status = (await listConnectionSyncStatus(db, harbour)).find((row) => row.connectionId === connection.id);
      expect(status?.failed).toBe(1);
      expect(status?.safeError).toBe("provider_rejected");
      expect(status?.lastSuccessAt).toBeInstanceOf(Date);
      expect(status?.lastSuccessAt?.getUTCFullYear()).toBeGreaterThan(2020);
      expect(Object.keys(status ?? {})).not.toContain("verifiedAt");

      await applyContext(db, staffCtx(specB));
      expect(await listConnectionSyncStatus(db, harbour)).toEqual([]);
      expect((await listConnectionSyncStatus(db, clinicGenie)).some((row) => row.connectionId === connection.id)).toBe(false);
    });
  });

  it("keeps fixture sessions inside one website and replaces a repeat without adding the previous value", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const clinicGenie = await clientBySlug("clinic-genie");
    await asContext(SERVICE, async (db) => {
      const harbourClinic = await provisionClinic(db, admin.id);
      const harbour = harbourClinic.clientId;
      const harbourSite = harbourClinic.websiteId;
      const clinicGenieSite = (await createWebsite(db, {
        clientId: clinicGenie,
        name: "Clinic Genie fixture website",
        url: "https://clinic-genie.example.invalid",
        platform: "Next.js",
        environment: "production",
        notes: "Fictional analytics isolation fixture.",
      }, admin.id)).id;
      const left = sealedToken({ accessToken: "left", expiresAt: "2100-01-01T00:00:00.000Z" });
      const right = sealedToken({ accessToken: "right", expiresAt: "2100-01-01T00:00:00.000Z" });
      const harbourConnection = await saveConnection(db, {
        clientId: harbour, websiteId: harbourSite, provider: "ga4", externalPropertyId: "1001", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: left.ciphertext, tokenNonce: left.nonce, actorUserId: admin.id,
      });
      const clinicGenieConnection = await saveConnection(db, {
        clientId: clinicGenie, websiteId: clinicGenieSite, provider: "ga4", externalPropertyId: "2002", streamOrSiteRef: null,
        providerTimezone: "UTC", tokenCiphertext: right.ciphertext, tokenNonce: right.nonce, actorUserId: admin.id,
      });
      await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
      const fetchReport: FetchLike = async (url) => {
        const sessions = url.includes("properties/1001") ? "4" : "9";
        return jsonResponse(200, {
          dimensionHeaders: [{ name: "date" }],
          metricHeaders: [{ name: "sessions" }],
          rows: [{ dimensionValues: [{ value: "20261001" }], metricValues: [{ value: sessions }] }],
        });
      };
      const now = new Date("2099-09-01T00:00:00.000Z");
      for (const item of [
        { clientId: harbour, websiteId: harbourSite, connectionId: harbourConnection.id },
        { clientId: clinicGenie, websiteId: clinicGenieSite, connectionId: clinicGenieConnection.id },
      ]) {
        await enqueueJob(db, { ...item, templateKey: "ga4.traffic_daily", start: "2026-10-01", end: "2026-10-01" });
        const job = await leaseNext(db, "fixture-worker", now);
        expect(job?.connection_id).toBe(item.connectionId);
        expect((await executeJob(db, job!, { fetch: fetchReport, now })).result).toBe("succeeded");
      }
      const harbourReport = await publishedReport(db, { clientId: harbour, websiteId: harbourSite, templateKey: "ga4.traffic_daily", start: "2026-10-01", end: "2026-10-01" });
      const clinicGenieReport = await publishedReport(db, { clientId: clinicGenie, websiteId: clinicGenieSite, templateKey: "ga4.traffic_daily", start: "2026-10-01", end: "2026-10-01" });
      expect(harbourReport?.rows[0]?.metrics.find((metric) => metric.key === "sessions")?.value).toBe(4);
      expect(clinicGenieReport?.rows[0]?.metrics.find((metric) => metric.key === "sessions")?.value).toBe(9);

      const repeat: FetchLike = async () => jsonResponse(200, {
        dimensionHeaders: [{ name: "date" }],
        metricHeaders: [{ name: "sessions" }],
        rows: [{ dimensionValues: [{ value: "20261001" }], metricValues: [{ value: "7" }] }],
      });
      await enqueueJob(db, { clientId: harbour, websiteId: harbourSite, connectionId: harbourConnection.id, templateKey: "ga4.traffic_daily", start: "2026-10-01", end: "2026-10-01" });
      const again = await leaseNext(db, "fixture-worker", new Date("2099-09-01T01:00:00.000Z"));
      expect((await executeJob(db, again!, { fetch: repeat, now: new Date("2099-09-01T01:00:00.000Z") })).result).toBe("succeeded");
      const replaced = await publishedReport(db, { clientId: harbour, websiteId: harbourSite, templateKey: "ga4.traffic_daily", start: "2026-10-01", end: "2026-10-01" });
      expect(replaced?.rows[0]?.metrics.find((metric) => metric.key === "sessions")?.value).toBe(7);
      const published = await db.query<{ n: number }>(
        "select count(*)::int as n from analytics_report_partitions where connection_id = $1 and template_key = 'ga4.traffic_daily' and published",
        [harbourConnection.id],
      );
      expect(published.rows[0]?.n).toBe(1);
    });
  });

  it("stores a missing provider metric as unavailable", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const provisioned = await provisionClinic(db, admin.id);
      const clientId = provisioned.clientId;
      const site = provisioned.websiteId;
      const sealed = sealedToken({ accessToken: "partial", expiresAt: "2100-01-01T00:00:00.000Z" });
      const connection = await saveConnection(db, {
        clientId, websiteId: site, provider: "ga4", externalPropertyId: "8080", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id,
      });
      await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
      const fetchReport: FetchLike = async () => jsonResponse(200, {
        metricHeaders: [{ name: "totalUsers" }],
        rows: [{ metricValues: [{ value: "12" }] }],
      });
      const now = new Date("2099-10-01T00:00:00.000Z");
      await enqueueJob(db, { clientId, websiteId: site, connectionId: connection.id, templateKey: "ga4.traffic_range", start: "2026-10-01", end: "2026-10-02" });
      const job = await leaseNext(db, "partial-worker", now);
      expect((await executeJob(db, job!, { fetch: fetchReport, now })).result).toBe("succeeded");
      const report = await publishedReport(db, { clientId, websiteId: site, templateKey: "ga4.traffic_range", start: "2026-10-01", end: "2026-10-02" });
      expect(report?.rows[0]?.metrics.find((metric) => metric.key === "sessions")).toMatchObject({ value: null, state: "unavailable" });
      expect(report?.rows[0]?.metrics.find((metric) => metric.key === "totalUsers")).toMatchObject({ value: 12, state: "available" });
    });
  });
});
