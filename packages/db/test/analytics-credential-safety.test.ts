import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, type Queryable } from "../src/client";
import { response } from "../src/testing/fictional-analytics-provider";
import { adminPool, appPool, asContext, staffByEmail } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { enqueueJob, runWorkerOnce, sealedToken, type FetchLike, type FetchResponse, type SyncDeps } from "../src/analytics/sync";

const KEY = "analytics-test-key-0123456789";
process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || KEY;

afterAll(async () => {
  process.env.ANALYTICS_TOKEN_KEY = KEY;
  await adminPool.end();
  await appPool.end();
});

const NOW = new Date("2026-11-12T04:00:00.000Z");
const hours = (n: number) => n * 3_600_000;
const CLIENT = { googleClientId: "client-id", googleClientSecret: "client-secret", wixAppId: "wix-id", wixAppSecret: "wix-secret" };

interface Case {
  provider?: "ga4" | "wix";
  /** Fields of the stored token. Default: an expired access token with a refresh token, so a refresh is needed. */
  token?: { accessToken?: string; refreshToken?: string | null; expiresAt?: string };
  siteRef?: string | null;
  /** Token key the SERVER uses when the job runs, if different from the one that sealed the token. */
  serverKey?: string;
  deps?: Partial<SyncDeps>;
  fetch: FetchLike;
}

interface Outcome {
  result: string | undefined;
  status: string;
  secretUnchanged: boolean;
  job: { state: string; attempts: number; safe_error_code: string | null; next_attempt_at: Date };
  cooldownUntil: Date | null;
  consecutiveFailures: number;
  calls: string[];
}

let serial = 0;

async function run(db: Queryable, c: Case): Promise<Outcome> {
  const admin = await staffByEmail("admin@example.invalid");
  await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
  const { clientId, websiteId } = await provisionClinic(db, admin.id);
  process.env.ANALYTICS_TOKEN_KEY = KEY;
  const provider = c.provider ?? "ga4";
  const sealed = sealedToken({
    accessToken: c.token?.accessToken ?? "old-access",
    ...(c.token?.refreshToken === null ? {} : { refreshToken: c.token?.refreshToken ?? "refresh-fixture" }),
    expiresAt: c.token?.expiresAt ?? "2026-01-01T00:00:00.000Z",
  });
  const connection = await saveConnection(db, {
    clientId, websiteId, provider, externalPropertyId: provider === "ga4" ? `7100${(serial += 1)}` : `wix-site-${(serial += 1)}`, streamOrSiteRef: c.siteRef === undefined ? (provider === "wix" ? "instance-1" : null) : c.siteRef,
    providerTimezone: "Asia/Singapore", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id,
  });
  const before = (await db.query<{ ciphertext: string; nonce: string }>("select ciphertext, nonce from analytics_secrets where connection_id = $1", [connection.id])).rows[0]!;
  // Two jobs, so we can see that one rejected request does not become two.
  for (const [start, end] of [["2026-11-01", "2026-11-07"], ["2026-10-25", "2026-10-31"]]) {
    await enqueueJob(db, { clientId, websiteId, connectionId: connection.id, templateKey: provider === "ga4" ? "ga4.traffic_range" : "wix.data_daily", start: start!, end: end!, now: NOW });
  }
  const calls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push(new URL(url).hostname);
    return c.fetch(url, init);
  };
  if (c.serverKey) process.env.ANALYTICS_TOKEN_KEY = c.serverKey;
  const step = await runWorkerOnce(async (fn) => fn(db), "t", { fetch, now: NOW, ...CLIENT, ...c.deps });
  process.env.ANALYTICS_TOKEN_KEY = KEY;
  const after = (await db.query<{ ciphertext: string; nonce: string }>("select ciphertext, nonce from analytics_secrets where connection_id = $1", [connection.id])).rows[0]!;
  const row = (await db.query<{ status: string; cooldown_until: Date | null; consecutive_failures: number }>("select status, cooldown_until, consecutive_failures from analytics_connections where id = $1", [connection.id])).rows[0]!;
  const job = (await db.query<Outcome["job"]>("select state, attempts, safe_error_code, next_attempt_at from analytics_jobs where connection_id = $1 order by end_date desc limit 1", [connection.id])).rows[0]!;
  return {
    result: step.result, status: row.status, secretUnchanged: before.ciphertext === after.ciphertext && before.nonce === after.nonce,
    job, cooldownUntil: row.cooldown_until, consecutiveFailures: row.consecutive_failures, calls,
  };
}

const token = (status: number, body: unknown): FetchLike => async (url) => (url.includes("oauth2") ? response(status, body) : response(500, {}));

describe("C1: a server-side credential problem never disconnects a connection", () => {
  const cases: Array<{ name: string; code: string; c: Case }> = [
    { name: "OAuth client secret wrong (401 invalid_client)", code: "oauth_client_rejected", c: { fetch: token(401, { error: "invalid_client" }) } },
    { name: "refresh request refused (400 invalid_request)", code: "oauth_client_rejected", c: { fetch: token(400, { error: "invalid_request" }) } },
    { name: "client not allowed to refresh this token (400 unauthorized_client)", code: "oauth_client_rejected", c: { fetch: token(400, { error: "unauthorized_client" }) } },
    { name: "token endpoint refuses with 403", code: "oauth_client_rejected", c: { fetch: token(403, { error: "access_denied" }) } },
    { name: "Google answer with no error code at all (400)", code: "oauth_client_rejected", c: { fetch: token(400, {}) } },
    { name: "token key differs from the one that sealed the token", code: "token_unreadable", c: { serverKey: "a-different-key-0123456789abcdef", fetch: token(200, {}) } },
    {
      name: "analytics API switched off for the OAuth project (403 SERVICE_DISABLED)", code: "provider_api_disabled",
      c: { token: { expiresAt: "2100-01-01T00:00:00.000Z" }, fetch: async () => response(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "Google Analytics Data API has not been used in project 123 before or it is disabled.", details: [{ reason: "SERVICE_DISABLED" }] } }) },
    },
    { name: "Wix app credentials wrong (401)", code: "oauth_client_rejected", c: { provider: "wix", fetch: async (url) => (url.includes("oauth2") ? response(401, {}) : response(500, {})) } },
    { name: "Wix refuses the app (403)", code: "oauth_client_rejected", c: { provider: "wix", fetch: async (url) => (url.includes("oauth2") ? response(403, { message: "forbidden" }) : response(500, {})) } },
  ];

  for (const { name, code, c } of cases) {
    it(`${name}: connection, stored token and job are left alone`, async () => {
      await asContext(SERVICE, async (db) => {
        const out = await run(db, c);
        expect(out.result).toBe("not_configured");
        expect(out.status).toBe("connected");
        expect(out.secretUnchanged).toBe(true);
        expect(out.job).toMatchObject({ state: "queued", attempts: 0, safe_error_code: code });
        // Waits two hours; does not use up an attempt; and the connection is paused so its second job is not tried.
        expect(out.job.next_attempt_at.getTime() - NOW.getTime()).toBe(hours(2));
        expect(out.cooldownUntil?.getTime()).toBe(NOW.getTime() + hours(2));
        expect(out.consecutiveFailures).toBe(1);
        expect(out.calls.length).toBeLessThanOrEqual(1);
      });
    });
  }

  it("makes one rejected request per connection, not one per job", async () => {
    await asContext(SERVICE, async (db) => {
      const out = await run(db, { fetch: token(401, { error: "invalid_client" }) });
      expect(out.calls).toEqual(["oauth2.googleapis.com"]);
    });
  });

  it("a missing key or missing OAuth variables also leave the connection alone (unchanged behaviour)", async () => {
    await asContext(SERVICE, async (db) => {
      const noClient = await run(db, { fetch: token(200, {}), deps: { googleClientId: undefined, googleClientSecret: undefined } });
      expect(noClient).toMatchObject({ result: "not_configured", status: "connected", secretUnchanged: true });
      expect(noClient.job).toMatchObject({ state: "queued", attempts: 0, safe_error_code: "not_configured" });
      expect(noClient.calls).toEqual([]);
    });
  });
});

describe("C1: a genuinely revoked or missing grant still disconnects", () => {
  it("Google invalid_grant (the grant was revoked or has expired)", async () => {
    await asContext(SERVICE, async (db) => {
      const out = await run(db, { fetch: token(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }) });
      expect(out).toMatchObject({ result: "reconnect", status: "reconnect_required" });
      expect(out.job).toMatchObject({ state: "reconnect_required", safe_error_code: "reconnect_required" });
    });
  });

  it("Wix invalid_grant", async () => {
    await asContext(SERVICE, async (db) => {
      const out = await run(db, { provider: "wix", fetch: async (url) => (url.includes("oauth2") ? response(400, { error: "invalid_grant" }) : response(500, {})) });
      expect(out).toMatchObject({ result: "reconnect", status: "reconnect_required" });
    });
  });

  it("there is no refresh token to refresh with", async () => {
    await asContext(SERVICE, async (db) => {
      const out = await run(db, { token: { refreshToken: null }, fetch: token(200, {}) });
      expect(out).toMatchObject({ result: "reconnect", status: "reconnect_required" });
      expect(out.calls).toEqual([]);
    });
  });

  it("a Wix connection has no site reference", async () => {
    await asContext(SERVICE, async (db) => {
      const out = await run(db, { provider: "wix", siteRef: null, fetch: async () => response(500, {}) });
      expect(out).toMatchObject({ result: "reconnect", status: "reconnect_required" });
    });
  });

  it("the data API says the credentials are no longer valid (401 UNAUTHENTICATED), or access to the property was withdrawn (403 PERMISSION_DENIED)", async () => {
    await asContext(SERVICE, async (db) => {
      const valid = { expiresAt: "2100-01-01T00:00:00.000Z" };
      const unauth = await run(db, { token: valid, fetch: async () => response(401, { error: { status: "UNAUTHENTICATED", message: "Request had invalid authentication credentials." } }) });
      expect(unauth).toMatchObject({ result: "reconnect", status: "reconnect_required" });
      const denied = await run(db, { token: valid, fetch: async () => response(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "User does not have sufficient permissions for this property." } }) });
      expect(denied).toMatchObject({ result: "reconnect", status: "reconnect_required" });
    });
  });
});

describe("C1: recovery once the server setting is fixed", () => {
  it("the same connection syncs normally after the key is corrected, without having been touched", async () => {
    await asContext(SERVICE, async (db) => {
      const admin = await staffByEmail("admin@example.invalid");
      await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      process.env.ANALYTICS_TOKEN_KEY = KEY;
      const sealed = sealedToken({ accessToken: "ok-access", refreshToken: "r", expiresAt: "2100-01-01T00:00:00.000Z" });
      const c = await saveConnection(db, { clientId, websiteId, provider: "ga4", externalPropertyId: "700001", streamOrSiteRef: null, providerTimezone: "Asia/Singapore", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id });
      await enqueueJob(db, { clientId, websiteId, connectionId: c.id, templateKey: "ga4.traffic_range", start: "2026-11-01", end: "2026-11-07", now: NOW });
      const ok: FetchLike = async () => response(200, { dimensionHeaders: [], metricHeaders: [{ name: "sessions" }, { name: "totalUsers" }], rows: [{ dimensionValues: [], metricValues: [{ value: "5" }, { value: "4" }] }], rowCount: 1 });
      // The server starts with the wrong key.
      process.env.ANALYTICS_TOKEN_KEY = "a-different-key-0123456789abcdef";
      const first = await runWorkerOnce(async (fn) => fn(db), "t", { fetch: ok, now: NOW, ...CLIENT });
      expect(first.result).toBe("not_configured");
      // Still waiting two hours later? No: two hours and a minute later, with the right key.
      process.env.ANALYTICS_TOKEN_KEY = KEY;
      const later = new Date(NOW.getTime() + hours(2) + 60_000);
      const second = await runWorkerOnce(async (fn) => fn(db), "t", { fetch: ok, now: later, ...CLIENT });
      expect(second.result).toBe("succeeded");
      const row = (await db.query<{ status: string; consecutive_failures: number; cooldown_until: Date | null }>("select status, consecutive_failures, cooldown_until from analytics_connections where id = $1", [c.id])).rows[0]!;
      expect(row).toMatchObject({ status: "connected", consecutive_failures: 0, cooldown_until: null });
      const job = (await db.query<{ attempts: number; state: string }>("select attempts, state from analytics_jobs where connection_id = $1", [c.id])).rows[0]!;
      // The failed attempt did not use up the retry budget.
      expect(job).toEqual({ attempts: 1, state: "succeeded" });
    });
  });

  it("three connections failing on the same bad OAuth client hold the rest back, so a bad setting is not hammered", async () => {
    await asContext(SERVICE, async (db) => {
      const admin = await staffByEmail("admin@example.invalid");
      await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
      await db.query("update analytics_connections set status = 'disconnected', disconnected_at = now() where status = 'connected'");
      process.env.ANALYTICS_TOKEN_KEY = KEY;
      let tokenRequests = 0;
      for (let i = 0; i < 5; i += 1) {
        const { clientId, websiteId } = await provisionClinic(db, admin.id);
        const sealed = sealedToken({ accessToken: "x", refreshToken: "r", expiresAt: "2026-01-01T00:00:00.000Z" });
        const c = await saveConnection(db, { clientId, websiteId, provider: "ga4", externalPropertyId: `70010${i}`, streamOrSiteRef: null, providerTimezone: "Asia/Singapore", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id });
        await enqueueJob(db, { clientId, websiteId, connectionId: c.id, templateKey: "ga4.traffic_range", start: "2026-11-01", end: "2026-11-07", now: NOW });
      }
      const fetch: FetchLike = async (url): Promise<FetchResponse> => {
        if (url.includes("oauth2")) tokenRequests += 1;
        return response(401, { error: "invalid_client" });
      };
      for (let i = 0; i < 8; i += 1) {
        const step = await runWorkerOnce(async (fn) => fn(db), "t", { fetch, now: NOW, ...CLIENT });
        if (!step.worked) break;
      }
      expect(tokenRequests).toBe(3);
      const states = await db.query<{ status: string }>("select status from analytics_connections where status <> 'disconnected'");
      expect(states.rows.every((r) => r.status === "connected")).toBe(true);
    });
  });
});
