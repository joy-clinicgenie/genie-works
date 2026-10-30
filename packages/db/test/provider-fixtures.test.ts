import { afterAll, describe, expect, it } from "vitest";
import { SERVICE } from "../src/client";
import { classifyImport } from "../src/analytics/measure";
import { enqueueJob, executeJob, leaseNext, sealedToken, type FetchLike } from "../src/analytics/sync";
import { saveConnection } from "../src/analytics/connections";
import { publishedReport } from "../src/analytics/read";
import { adminPool, appPool, asContext, clientBySlug, staffByEmail } from "./helpers";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("provider fixtures (not live APIs)", () => {
  it("covers success, empty, expired credentials, errors, rate limits and separate websites", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const meridian = await clientBySlug("meridian-skin");
    const harbour = await clientBySlug("harbourview-dental");
    await asContext(SERVICE, async (db) => {
      await db.query("update analytics_jobs set next_attempt_at = '2100-01-01T00:00:00.000Z' where state = 'queued'");
      const sites = (await db.query<{ id: string }>("select id from websites where client_id = $1 order by created_at", [meridian])).rows;
      expect(sites.length).toBeGreaterThanOrEqual(2);
      const harbourSite = (await db.query<{ id: string }>("select id from websites where client_id = $1 order by created_at limit 1", [harbour])).rows[0]!.id;
      const sealed = sealedToken({ accessToken: "fixture-token", expiresAt: "2100-01-01T00:00:00.000Z" });
      const first = await saveConnection(db, {
        clientId: meridian, websiteId: sites[0]!.id, provider: "ga4", externalPropertyId: "9105101", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id,
      });
      const second = await saveConnection(db, {
        clientId: meridian, websiteId: sites[1]!.id, provider: "ga4", externalPropertyId: "9105102", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id,
      });
      const fetchByProperty: FetchLike = async (url) => {
        const sessions = url.includes("properties/9105102") ? "9" : "4";
        return jsonResponse(200, {
          dimensionHeaders: [{ name: "date" }],
          metricHeaders: [{ name: "sessions" }],
          rows: [{ dimensionValues: [{ value: "20261001" }], metricValues: [{ value: sessions }] }],
        });
      };
      const now = new Date();
      for (const [connection, site] of [[first, sites[0]!], [second, sites[1]!]] as const) {
        await enqueueJob(db, { clientId: meridian, websiteId: site.id, connectionId: connection.id, templateKey: "ga4.traffic_daily", start: "2026-10-01", end: "2026-10-01" });
        const job = await leaseNext(db, "fixture-worker", now);
        expect((await executeJob(db, job!, { fetch: fetchByProperty, now })).result).toBe("succeeded");
      }
      const left = await publishedReport(db, { clientId: meridian, websiteId: sites[0]!.id, templateKey: "ga4.traffic_daily", start: "2026-10-01", end: "2026-10-01" });
      const right = await publishedReport(db, { clientId: meridian, websiteId: sites[1]!.id, templateKey: "ga4.traffic_daily", start: "2026-10-01", end: "2026-10-01" });
      const sessions = (report: typeof left) => report?.rows[0]?.metrics.find((metric) => metric.key === "sessions")?.value;
      expect(sessions(left)).toBe(4);
      expect(sessions(right)).toBe(9);

      const emptySeal = sealedToken({ accessToken: "fixture-token", expiresAt: "2100-01-01T00:00:00.000Z" });
      const emptyConnection = await saveConnection(db, {
        clientId: harbour, websiteId: harbourSite, provider: "ga4", externalPropertyId: "9105103", streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore", tokenCiphertext: emptySeal.ciphertext, tokenNonce: emptySeal.nonce, actorUserId: admin.id,
      });
      const emptyFetch: FetchLike = async () => jsonResponse(200, { rows: [] });
      await enqueueJob(db, { clientId: harbour, websiteId: harbourSite, connectionId: emptyConnection.id, templateKey: "ga4.traffic_daily", start: "2026-10-03", end: "2026-10-03" });
      const emptyJob = await leaseNext(db, "fixture-empty", now);
      expect((await executeJob(db, emptyJob!, { fetch: emptyFetch, now })).result).toBe("succeeded");
      const emptyReport = await publishedReport(db, { clientId: harbour, websiteId: harbourSite, templateKey: "ga4.traffic_daily", start: "2026-10-03", end: "2026-10-03" });
      expect(emptyReport?.completeness).toBe("empty");

      const errorFetch: FetchLike = async () => jsonResponse(500, { error: "fixture-provider" });
      await enqueueJob(db, { clientId: harbour, websiteId: harbourSite, connectionId: emptyConnection.id, templateKey: "ga4.traffic_daily", start: "2026-10-04", end: "2026-10-04" });
      const errorJob = await leaseNext(db, "fixture-error", now);
      expect((await executeJob(db, errorJob!, { fetch: errorFetch, now })).result).toBe("retry");

      const limited: FetchLike = async () => jsonResponse(429, {}, { "retry-after": "15" });
      await enqueueJob(db, { clientId: harbour, websiteId: harbourSite, connectionId: emptyConnection.id, templateKey: "ga4.traffic_daily", start: "2026-10-05", end: "2026-10-05" });
      const limitedJob = await leaseNext(db, "fixture-limit", now);
      expect((await executeJob(db, limitedJob!, { fetch: limited, now })).result).toBe("retry");

      const expired = sealedToken({ accessToken: "old", refreshToken: "refresh", expiresAt: "2020-01-01T00:00:00.000Z" });
      await db.query("update analytics_secrets set ciphertext = $2, nonce = $3 where connection_id = $1", [emptyConnection.id, expired.ciphertext, expired.nonce]);
      const revoked: FetchLike = async () => jsonResponse(400, { error: "invalid_grant" });
      await enqueueJob(db, { clientId: harbour, websiteId: harbourSite, connectionId: emptyConnection.id, templateKey: "ga4.traffic_range", start: "2026-10-01", end: "2026-10-07" });
      const revokedJob = await leaseNext(db, "fixture-revoked", now);
      const reconnect = await executeJob(db, revokedJob!, { fetch: revoked, now, googleClientId: "fixture-client", googleClientSecret: "fixture-secret" });
      expect(reconnect.result).toBe("reconnect");
    });
  });

  it("rejects an overlapping source instead of adding it to an existing provider partition", () => {
    const decision = classifyImport({
      checksum: "fixture-second-source",
      start: "2026-10-01",
      end: "2026-10-07",
      existing: [{ checksum: "fixture-first-source", start: "2026-10-01", end: "2026-10-07", provenance: "api" }],
      replace: false,
    });
    expect(decision).toBe("reject");
  });
});
