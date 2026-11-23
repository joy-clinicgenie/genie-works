import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, type Queryable } from "../src/client";
import { fictionalProviders, response } from "../src/testing/fictional-analytics-provider";
import { adminPool, appPool, asContext, staffByEmail } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { publishedReport } from "../src/analytics/read";
import { enqueueJob, leaseNext, probeConnectionCredentials, sealedToken, type FetchLike } from "../src/analytics/sync";
import { withReadOnlyContext } from "../src/client";
import {
  PILOT_MAX_JOBS, PilotError, connectionRef, parseAllowList, parsePilotRequest, pilotPlan, runPilotProbe, runPilotSync,
  type PilotRun,
} from "../src/analytics/pilot";

const KEY = "analytics-test-key-0123456789";
process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || KEY;

afterAll(async () => {
  process.env.ANALYTICS_TOKEN_KEY = KEY;
  await adminPool.end();
  await appPool.end();
});

const NOW = new Date("2026-11-12T04:00:00.000Z"); // 12:00 on 12 Nov in Singapore, 20:00 on 11 Nov in Los Angeles
const CLIENT = { googleClientId: "client-id", googleClientSecret: "client-secret", wixAppId: "wix-id", wixAppSecret: "wix-secret" };

// ---------------------------------------------------------------------------------------------
// Fixture: three connections on two clients. Each has its own token, so a call can be attributed to exactly one of them.

interface Conn { id: string; ref: string; clientId: string; websiteId: string; provider: "ga4" | "gsc" | "wix"; token: string; property: string }
let serial = 0;

async function connect(db: Queryable, adminId: string, ids: { clientId: string; websiteId: string }, provider: Conn["provider"], token: string, tokenFields: { refreshToken?: string | null; expiresAt?: string } = {}): Promise<Conn> {
  process.env.ANALYTICS_TOKEN_KEY = KEY;
  serial += 1;
  const property = provider === "ga4" ? `7200${serial}` : provider === "gsc" ? `sc-domain:pilot${serial}.example.invalid` : `wix-pilot-${serial}`;
  const sealed = sealedToken({
    accessToken: token, ...(tokenFields.refreshToken === null ? {} : { refreshToken: tokenFields.refreshToken ?? `refresh-${token}` }),
    expiresAt: tokenFields.expiresAt ?? "2100-01-01T00:00:00.000Z",
  });
  const c = await saveConnection(db, {
    clientId: ids.clientId, websiteId: ids.websiteId, provider, externalPropertyId: property, streamOrSiteRef: provider === "wix" ? `instance-${serial}` : null,
    providerTimezone: provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore", tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: adminId,
  });
  return { id: c.id, ref: connectionRef(c.id), clientId: ids.clientId, websiteId: ids.websiteId, provider, token, property };
}

async function fixture(db: Queryable) {
  const admin = await staffByEmail("admin@example.invalid");
  await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
  await db.query("update analytics_connections set status = 'disconnected', disconnected_at = now() where status = 'connected'");
  await db.query("update analytics_worker_invocations set state = 'abandoned' where state = 'running'");
  const one = await provisionClinic(db, admin.id);
  const two = await provisionClinic(db, admin.id);
  const a = await connect(db, admin.id, one, "ga4", "tok-A");
  const b = await connect(db, admin.id, two, "ga4", "tok-B");
  const c = await connect(db, admin.id, { clientId: one.clientId, websiteId: one.stagingId }, "gsc", "tok-C");
  return { admin, one, two, a, b, c };
}

/** Everything a pilot run must not change, for the given connections, as a comparable string. */
async function snapshot(db: Queryable, ids: string[]): Promise<string> {
  const jobs = await db.query("select id, state, attempts, next_attempt_at, lease_owner, lease_until, heartbeat_at, safe_error_code, updated_at, template_key, start_date::text, end_date::text from analytics_jobs where connection_id = any($1::uuid[]) order by id", [ids]);
  const conns = await db.query("select id, status, provider_timezone, cooldown_until, consecutive_failures, last_served_at, secret_ref, version, disconnected_at, updated_at from analytics_connections where id = any($1::uuid[]) order by id", [ids]);
  const secrets = await db.query("select connection_id, ciphertext, nonce from analytics_secrets where connection_id = any($1::uuid[]) order by connection_id", [ids]);
  const partitions = await db.query("select count(*)::int as n from analytics_report_partitions where connection_id = any($1::uuid[])", [ids]);
  const runs = await db.query("select count(*)::int as n from analytics_sync_runs where connection_id = any($1::uuid[])", [ids]);
  return JSON.stringify({ jobs: jobs.rows, conns: conns.rows, secrets: secrets.rows, partitions: partitions.rows, runs: runs.rows });
}

// ---------------------------------------------------------------------------------------------
// Harness

interface Harness {
  state: { now: number; readOnlyDepth: number; calls: Array<{ host: string; auth: string; readOnly: boolean }> };
  run: PilotRun;
  deps: () => Parameters<typeof runPilotSync>[2];
  sync: (conn: Conn, over?: Record<string, unknown>, options?: Partial<Parameters<typeof runPilotSync>[3]>) => ReturnType<typeof runPilotSync>;
  probe: (conn: Conn) => ReturnType<typeof runPilotProbe>;
  allow: Set<string>;
}

function harness(db: Queryable, allow: Conn[], over: { provider?: FetchLike; run?: PilotRun } = {}): Harness {
  const state: Harness["state"] = { now: NOW.getTime(), readOnlyDepth: 0, calls: [] };
  const real = fictionalProviders().fetch;
  const fetch: FetchLike = async (url, init) => {
    const auth = ((init?.headers as Record<string, string> | undefined)?.Authorization ?? "").replace(/^Bearer /, "");
    // Whether this request was made inside the probe's read-only boundary.
    state.calls.push({ host: new URL(url).hostname, auth, readOnly: state.readOnlyDepth > 0 });
    state.now += 100;
    if (over.provider) return over.provider(url, init);
    if (url.includes("oauth2.googleapis.com") || url.includes("wixapis.com/oauth2")) return response(200, { access_token: "fresh-access-token", expires_in: 3600 });
    return real(url, init);
  };
  const run: PilotRun = over.run ?? (async (fn) => fn(db));
  // Stands in for withReadOnlyContext inside one test transaction: marks the boundary and refuses any statement that is not a read.
  const runReadOnly: PilotRun = async (fn) => {
    const guarded = { query: (text: unknown, ...rest: unknown[]) => {
      if (typeof text !== "string" || !/^\s*(select|show|with)\b/i.test(text)) throw new Error("a write was attempted inside the read-only probe");
      return (db.query as (...a: unknown[]) => unknown)(text, ...rest);
    } } as unknown as Queryable;
    state.readOnlyDepth += 1;
    try { return await fn(guarded); } finally { state.readOnlyDepth -= 1; }
  };
  const allowList = parseAllowList(allow.map((c) => c.ref).join(","));
  const deps = () => ({ fetch, now: new Date(state.now), ...CLIENT });
  return {
    state, run, allow: allowList, deps,
    sync: (conn, extra = {}, options = {}) => runPilotSync(run, parsePilotRequest({ connection: conn.ref, mode: "run", ...extra }), deps(), { allowList, clock: () => state.now, ...options }),
    probe: (conn) => runPilotProbe(run, parsePilotRequest({ connection: conn.ref, mode: "probe" }), deps(), { allowList, runReadOnly }),
  };
}

const auditFor = async (db: Queryable, action: string) =>
  (await db.query<{ action: string; outcome: string; actor_type: string; client_id: string | null; target_id: string | null; metadata: Record<string, unknown> }>(
    "select action, outcome, actor_type, client_id, target_id, metadata from audit_events where action = $1 order by occurred_at, id", [action])).rows;

// ---------------------------------------------------------------------------------------------

describe("pilot request and plan", () => {
  it("accepts only a reference, a mode and the few documented options", () => {
    expect(parsePilotRequest({ connection: "AbCdEf01", mode: "probe" })).toMatchObject({ connection: "abcdef01", mode: "probe", maxJobs: PILOT_MAX_JOBS, requeueWaiting: false });
    expect(parsePilotRequest({ connection: "abcdef01", mode: "run", templates: ["ga4.traffic_daily"], end: "2026-11-01", maxJobs: 1, requeueWaiting: true })).toMatchObject({ maxJobs: 1, requeueWaiting: true });
    const bad: unknown[] = [
      null, [], "x", {}, { connection: "abc", mode: "run" }, { connection: "abcdef01", mode: "delete" }, { connection: "abcdef01", mode: "run", maxJobs: 13 },
      { connection: "abcdef01", mode: "run", maxJobs: 0 }, { connection: "abcdef01", mode: "run", maxJobs: 1.5 }, { connection: "abcdef01", mode: "run", end: "tomorrow" },
      { connection: "abcdef01", mode: "run", templates: [] }, { connection: "abcdef01", mode: "run", templates: ["x; drop"] }, { connection: "abcdef01", mode: "run", templates: "ga4.traffic_daily" },
      { connection: "abcdef01", mode: "run", requeueWaiting: "yes" },
      // Fields that would widen the pilot are not accepted at all.
      { connection: "abcdef01", mode: "run", connectionId: "0000" }, { connection: "abcdef01", mode: "run", clientId: "x" }, { connection: "abcdef01", mode: "run", all: true },
    ];
    for (const body of bad) expect(() => parsePilotRequest(body), JSON.stringify(body)).toThrow(PilotError);
  });

  it("reads the allow-list as eight-character references and ignores anything else", () => {
    expect([...parseAllowList(" ABCDEF01, 12345678 ,not-a-ref,abc, 0123456789 ,,")].sort()).toEqual(["12345678", "abcdef01"]);
    expect(parseAllowList(undefined).size).toBe(0);
    expect(parseAllowList("").size).toBe(0);
    expect(connectionRef("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("plans a small fixed window per provider and puts the cheapest job first", () => {
    const ga4 = pilotPlan("ga4", NOW, "Asia/Singapore", {});
    expect(ga4).toHaveLength(11);
    expect(ga4[0]).toEqual({ templateKey: "ga4.traffic_daily", start: "2026-10-26", end: "2026-11-08" });
    expect(ga4.filter((j) => j.templateKey === "ga4.traffic_range")).toEqual([
      { templateKey: "ga4.traffic_range", start: "2026-11-02", end: "2026-11-08" },
      { templateKey: "ga4.traffic_range", start: "2026-10-26", end: "2026-11-01" },
    ]);
    const gsc = pilotPlan("gsc", NOW, "America/Los_Angeles", {});
    expect(gsc.map((j) => j.templateKey)).toEqual(["gsc.totals", "gsc.pages", "gsc.queries"]);
    expect(gsc[0]).toMatchObject({ start: "2026-11-02", end: "2026-11-08" }); // Los Angeles date 11 Nov, minus three days
    const wix = pilotPlan("wix", NOW, "Asia/Singapore", {});
    expect(wix).toEqual([{ templateKey: "wix.data_daily", start: "2026-09-12", end: "2026-11-12" }]);
    expect(pilotPlan("ga4", NOW, null, { templates: ["ga4.device"] })).toHaveLength(1);
  });

  it("refuses a window newer than the provider has settled, an unknown report, or an end date for Wix", () => {
    expect(() => pilotPlan("ga4", NOW, null, { end: "2026-11-10" })).toThrow(/later than the latest day/);
    expect(() => pilotPlan("ga4", NOW, null, { end: "2026-01-01" })).toThrow(/more than 90 days/);
    expect(() => pilotPlan("ga4", NOW, null, { templates: ["gsc.totals"] })).toThrow(/not part of the pilot/);
    expect(() => pilotPlan("wix", NOW, null, { end: "2026-11-01" })).toThrow(/Wix pilot always covers/);
    expect(pilotPlan("ga4", NOW, null, { end: "2026-11-01" })[0]).toMatchObject({ end: "2026-11-01" });
  });
});

describe("pilot allow-list and refusal", () => {
  it("refuses a reference that is not on the list, and an unknown one, with the same answer, and records both", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const h = harness(db, [f.a]);
      const unlisted = await h.sync(f.b).catch((e) => e);
      const unknown = await runPilotSync(h.run, parsePilotRequest({ connection: "deadbeef", mode: "run" }), h.deps(), { allowList: parseAllowList("deadbeef") }).catch((e) => e);
      for (const error of [unlisted, unknown]) {
        expect(error).toBeInstanceOf(PilotError);
        expect(error).toMatchObject({ status: 403, code: "not_allowed", message: "This connection is not allowed for the pilot." });
      }
      expect(h.state.calls).toHaveLength(0);
      const refused = await auditFor(db, "analytics.pilot.refused");
      expect(refused).toHaveLength(2);
      expect(refused.every((r) => r.outcome === "denied" && r.actor_type === "service")).toBe(true);
    });
  });

  it("refuses an empty allow-list entirely", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const h = harness(db, []);
      await expect(h.probe(f.a)).rejects.toMatchObject({ status: 403 });
      await expect(h.sync(f.a)).rejects.toMatchObject({ status: 403 });
      expect(h.state.calls).toHaveLength(0);
    });
  });

  it("refuses a connection that is not connected, even when allow-listed, and runs nothing", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      await db.query("update analytics_connections set status = 'reconnect_required' where id = $1", [f.a.id]);
      const before = await snapshot(db, [f.a.id]);
      const h = harness(db, [f.a]);
      await expect(h.sync(f.a)).rejects.toMatchObject({ status: 409, code: "not_connected" });
      await expect(h.probe(f.a)).rejects.toMatchObject({ status: 409 });
      expect(await snapshot(db, [f.a.id])).toBe(before);
      expect(h.state.calls).toHaveLength(0);
    });
  });
});

describe("read-only credential probe", () => {
  it("proves the credentials work, from inside a read-only transaction, and changes nothing but the audit log", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const h = harness(db, [f.a]);
      const before = await snapshot(db, [f.a.id, f.b.id, f.c.id]);
      const result = await h.probe(f.a);
      expect(result).toMatchObject({
        mode: "probe", connection: f.a.ref, provider: "ga4", decrypt: "ok", hasRefreshToken: true, oauthClientConfigured: true,
        refresh: "ok", ready: true, changedConnection: false,
      });
      // The one provider request was to the token endpoint, with the database refusing writes at that moment.
      expect(h.state.calls).toEqual([{ host: "oauth2.googleapis.com", auth: "", readOnly: true }]);
      expect(await snapshot(db, [f.a.id, f.b.id, f.c.id])).toBe(before);
      const audit = await auditFor(db, "analytics.pilot.probe");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ outcome: "success", actor_type: "service", client_id: f.a.clientId });
    });
  });

  it("never returns or records a token, a key, a property or a full id", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const h = harness(db, [f.a]);
      const result = await h.probe(f.a);
      // The audit table's own target and client columns hold ids by design; what must stay clean is the metadata and the result.
      const text = JSON.stringify({ result, audit: (await auditFor(db, "analytics.pilot.probe")).map((a) => a.metadata) });
      for (const secret of [f.a.token, "refresh-tok-A", KEY, "fresh-access-token", f.a.property, f.a.id, f.a.clientId, "client-secret"]) expect(text).not.toContain(secret);
    });
  });

  it("tells a wrong OAuth client, a revoked grant, a wrong key, a missing key, missing variables, throttling and an outage apart", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const oauth = (status: number, body: unknown): FetchLike => async () => response(status, body);
      const probe = async (provider: FetchLike, setup?: () => void, teardown?: () => void) => {
        const h = harness(db, [f.a], { provider });
        setup?.();
        try { return await h.probe(f.a); } finally { teardown?.(); process.env.ANALYTICS_TOKEN_KEY = KEY; }
      };
      expect(await probe(oauth(401, { error: "invalid_client" }))).toMatchObject({ decrypt: "ok", refresh: "oauth_client_rejected", ready: false });
      expect(await probe(oauth(400, { error: "invalid_grant" }))).toMatchObject({ refresh: "invalid_grant", ready: false });
      expect(await probe(oauth(429, {}))).toMatchObject({ refresh: "rate_limited" });
      expect(await probe(oauth(503, {}))).toMatchObject({ refresh: "provider_unavailable" });
      expect(await probe(oauth(200, { nothing: true }))).toMatchObject({ refresh: "invalid_response" });
      expect(await probe(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); })).toMatchObject({ refresh: "provider_unavailable" });
      const wrongKey = await probe(oauth(200, {}), () => { process.env.ANALYTICS_TOKEN_KEY = "a-different-key-0123456789abcdef"; });
      expect(wrongKey).toMatchObject({ decrypt: "unreadable", refresh: "skipped", ready: false });
      const noKey = await probe(oauth(200, {}), () => { process.env.ANALYTICS_TOKEN_KEY = ""; });
      expect(noKey).toMatchObject({ decrypt: "key_missing", refresh: "skipped", ready: false });
      // Missing OAuth variables on the server.
      const h = harness(db, [f.a]);
      const missing = await runPilotProbe(h.run, parsePilotRequest({ connection: f.a.ref, mode: "probe" }), { ...h.deps(), googleClientId: undefined, googleClientSecret: undefined }, { allowList: h.allow, runReadOnly: h.run });
      expect(missing).toMatchObject({ decrypt: "ok", oauthClientConfigured: false, refresh: "config_missing", ready: false });
      // After every one of those failures, the connection and its stored token are as they were.
      const row = (await db.query<{ status: string; consecutive_failures: number }>("select status, consecutive_failures from analytics_connections where id = $1", [f.a.id])).rows[0]!;
      expect(row).toMatchObject({ status: "connected", consecutive_failures: 0 });
    });
  });

  it("says so when there is no refresh token to test with, rather than guessing", async () => {
    await asContext(SERVICE, async (db) => {
      const admin = await staffByEmail("admin@example.invalid");
      const f = await fixture(db);
      const clinic = await provisionClinic(db, admin.id);
      const bare = await connect(db, admin.id, clinic, "ga4", "tok-bare", { refreshToken: null });
      const h = harness(db, [bare]);
      expect(await h.probe(bare)).toMatchObject({ decrypt: "ok", hasRefreshToken: false, refresh: "skipped", ready: false });
      void f;
    });
  });

  it("probes a Wix connection through the Wix token endpoint", async () => {
    await asContext(SERVICE, async (db) => {
      const admin = await staffByEmail("admin@example.invalid");
      await fixture(db);
      const clinic = await provisionClinic(db, admin.id);
      const wix = await connect(db, admin.id, clinic, "wix", "tok-W");
      const h = harness(db, [wix]);
      expect(await h.probe(wix)).toMatchObject({ provider: "wix", decrypt: "ok", hasSiteReference: true, refresh: "ok", ready: true });
      expect(h.state.calls[0]).toMatchObject({ host: "www.wixapis.com", readOnly: true });
    });
  });
});

describe("the probe cannot write (database-enforced)", () => {
  it("withReadOnlyContext makes the database refuse any write, whatever the code inside does", async () => {
    await expect(withReadOnlyContext(SERVICE, (db) => db.query("update analytics_connections set status = status"))).rejects.toMatchObject({ code: "25006" });
    await expect(withReadOnlyContext(SERVICE, (db) => db.query("insert into audit_events (actor_type, action, target_type, outcome) values ('service', 'x', 'y', 'success')"))).rejects.toMatchObject({ code: "25006" });
    await expect(withReadOnlyContext(SERVICE, (db) => db.query("select 1 as ok").then((r) => r.rows[0]))).resolves.toEqual({ ok: 1 });
  });

  it("the real probe runs to completion inside a genuinely read-only transaction", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const h = harness(db, [f.a]);
      await db.query("set transaction read only");
      // Every statement the probe issues is a read, or the database would stop it here.
      const probe = await probeConnectionCredentials(db, f.a.id, h.deps());
      expect(probe).toMatchObject({ decrypt: "ok", refresh: "ok" });
      await expect(db.query("update analytics_connections set status = status where id = $1", [f.a.id])).rejects.toMatchObject({ code: "25006" });
    });
  });
});

describe("bounded synchronisation of one connection", () => {
  it("syncs the GA4 pilot window, stores it under the right client and website, and records the run", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const h = harness(db, [f.a]);
      const result = await h.sync(f.a);
      expect(result).toMatchObject({
        mode: "run", connection: f.a.ref, provider: "ga4", plannedTotal: 11, queuedNow: 11, alreadyQueuedOrDone: 0, jobs: 11, succeeded: 11, failed: 0,
        retryScheduled: 0, reconnectRequired: 0, credentialOrConfigWaiting: 0, stopped: "empty", connectionStatusChanged: false,
        jobStates: { succeeded: 11 }, window: { start: "2026-10-26", end: "2026-11-08" },
      });
      expect(result.reports).toHaveLength(11);
      expect(result.reports.every((r) => r.completeness === "complete")).toBe(true);
      // Stored for the right client and website, and readable only there.
      const range = { templateKey: "ga4.traffic_range", start: "2026-11-02", end: "2026-11-08" };
      expect(await publishedReport(db, { clientId: f.a.clientId, websiteId: f.a.websiteId, ...range })).not.toBeNull();
      expect(await publishedReport(db, { clientId: f.b.clientId, websiteId: f.b.websiteId, ...range })).toBeNull();
      expect(await publishedReport(db, { clientId: f.b.clientId, websiteId: f.a.websiteId, ...range })).toBeNull();
      // Every provider request used this connection's token.
      expect(new Set(h.state.calls.map((c) => c.auth))).toEqual(new Set([f.a.token]));
      expect(h.state.calls).toHaveLength(11);
      // An invocation record and a success audit entry.
      const inv = (await db.query<{ owner: string; trigger: string; state: string; jobs: number; succeeded: number }>("select owner, trigger, state, jobs, succeeded from analytics_worker_invocations where owner like 'pilot:%'")).rows;
      expect(inv).toEqual([{ owner: `pilot:${f.a.ref}`, trigger: "manual", state: "finished", jobs: 11, succeeded: 11 }]);
      const audit = await auditFor(db, "analytics.pilot.run");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ outcome: "success", actor_type: "service", client_id: f.a.clientId, target_id: f.a.id });
      expect(audit[0]!.metadata).toMatchObject({ connection: f.a.ref, provider: "ga4", jobs: 11, succeeded: 11, connectionStatusChanged: false });
    });
  });

  it("is safe to repeat: a second identical call queues nothing and makes no request", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const h = harness(db, [f.a]);
      await h.sync(f.a);
      const calls = h.state.calls.length;
      const partitions = (await db.query<{ n: number }>("select count(*)::int as n from analytics_report_partitions where connection_id = $1", [f.a.id])).rows[0]!.n;
      const again = await h.sync(f.a);
      expect(again).toMatchObject({ queuedNow: 0, alreadyQueuedOrDone: 11, jobs: 0, stopped: "empty", jobStates: { succeeded: 11 } });
      expect(h.state.calls).toHaveLength(calls);
      expect((await db.query<{ n: number }>("select count(*)::int as n from analytics_report_partitions where connection_id = $1", [f.a.id])).rows[0]!.n).toBe(partitions);
    });
  });

  it("honours maxJobs: one job first, then the rest, with no repeated request", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const h = harness(db, [f.a]);
      const first = await h.sync(f.a, { maxJobs: 1 });
      expect(first).toMatchObject({ queuedNow: 1, jobs: 1, succeeded: 1, stopped: "limit" });
      expect(first.reports.map((r) => r.template)).toEqual(["ga4.traffic_daily"]);
      expect(h.state.calls).toHaveLength(1);
      const rest = await h.sync(f.a, { maxJobs: 12 });
      expect(rest).toMatchObject({ queuedNow: 10, alreadyQueuedOrDone: 1, jobs: 10, succeeded: 10 });
      expect(h.state.calls).toHaveLength(11);
    });
  });

  it("runs only the requested reports", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const h = harness(db, [f.a]);
      const result = await h.sync(f.a, { templates: ["ga4.device", "ga4.country"] });
      expect(result).toMatchObject({ plannedTotal: 2, jobs: 2, succeeded: 2 });
      expect(h.state.calls).toHaveLength(2);
      await expect(h.sync(f.a, { templates: ["gsc.totals"] })).rejects.toMatchObject({ status: 400 });
    });
  });

  it("syncs a Search Console and a Wix connection the same way", async () => {
    await asContext(SERVICE, async (db) => {
      const admin = await staffByEmail("admin@example.invalid");
      const f = await fixture(db);
      const clinic = await provisionClinic(db, admin.id);
      const wix = await connect(db, admin.id, clinic, "wix", "tok-W");
      const h = harness(db, [f.c, wix]);
      expect(await h.sync(f.c)).toMatchObject({ provider: "gsc", plannedTotal: 3, jobs: 3, succeeded: 3 });
      expect(await h.sync(wix)).toMatchObject({ provider: "wix", plannedTotal: 1, jobs: 1, succeeded: 1, window: { start: "2026-09-12", end: "2026-11-12" } });
      expect(await publishedReport(db, { clientId: wix.clientId, websiteId: wix.websiteId, templateKey: "wix.data_daily", start: "2026-09-12", end: "2026-11-12" })).not.toBeNull();
    });
  });
});

describe("one-connection isolation", () => {
  it("changes nothing for any other connection, never reads another connection's token, and leaves the pilot connection's older backlog alone", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      // Other connections have work waiting, an expired lease, and a pause. The pilot connection has an older backlog.
      for (const conn of [f.b, f.c]) {
        for (const [s, e] of [["2026-10-01", "2026-10-07"], ["2026-10-08", "2026-10-14"]]) {
          await enqueueJob(db, { clientId: conn.clientId, websiteId: conn.websiteId, connectionId: conn.id, templateKey: conn.provider === "ga4" ? "ga4.traffic_range" : "gsc.totals", start: s!, end: e!, now: NOW });
        }
      }
      await db.query(`update analytics_jobs set state = 'leased', lease_owner = 'other-worker', lease_until = $2, attempts = 1
                      where id = (select id from analytics_jobs where connection_id = $1 order by end_date limit 1)`, [f.b.id, new Date(NOW.getTime() - 3_600_000).toISOString()]);
      await db.query("update analytics_connections set cooldown_until = $2, consecutive_failures = 2 where id = $1", [f.c.id, new Date(NOW.getTime() + 3_600_000).toISOString()]);
      const backlog: string[] = [];
      for (const [s, e] of [["2026-09-01", "2026-09-07"], ["2026-09-08", "2026-09-14"], ["2026-09-15", "2026-09-21"]]) {
        backlog.push((await enqueueJob(db, { clientId: f.a.clientId, websiteId: f.a.websiteId, connectionId: f.a.id, templateKey: "ga4.landing", start: s!, end: e!, now: NOW })).id);
      }
      const othersBefore = await snapshot(db, [f.b.id, f.c.id]);
      const backlogBefore = (await db.query("select id, state, attempts, next_attempt_at, updated_at, lease_owner from analytics_jobs where id = any($1::uuid[]) order by id", [backlog])).rows;

      const h = harness(db, [f.a]);
      const result = await h.sync(f.a);

      expect(result).toMatchObject({ jobs: 11, succeeded: 11, connectionStatusChanged: false });
      // 1. Every other connection is byte-for-byte as it was: jobs (including the expired lease), status, pause, token, reports, runs.
      expect(await snapshot(db, [f.b.id, f.c.id])).toBe(othersBefore);
      // 2. No request used another connection's token.
      expect(h.state.calls.filter((c) => c.auth === f.b.token || c.auth === f.c.token)).toEqual([]);
      expect(new Set(h.state.calls.map((c) => c.auth))).toEqual(new Set([f.a.token]));
      // 3. The pilot connection's older backlog was neither run nor changed.
      expect((await db.query("select id, state, attempts, next_attempt_at, updated_at, lease_owner from analytics_jobs where id = any($1::uuid[]) order by id", [backlog])).rows).toEqual(backlogBefore);
      // 4. The only partitions written belong to the pilot connection.
      const written = await db.query<{ connection_id: string }>("select distinct connection_id from analytics_report_partitions where fetched_at >= $1::timestamptz - interval '1 minute'", [NOW.toISOString()]);
      expect(written.rows.map((r) => r.connection_id)).toEqual([f.a.id]);
    });
  });

  it("recovers an expired lease on the pilot connection itself, and only there", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const stuck = await enqueueJob(db, { clientId: f.a.clientId, websiteId: f.a.websiteId, connectionId: f.a.id, templateKey: "ga4.landing", start: "2026-09-01", end: "2026-09-07", now: NOW });
      const other = await enqueueJob(db, { clientId: f.b.clientId, websiteId: f.b.websiteId, connectionId: f.b.id, templateKey: "ga4.landing", start: "2026-09-01", end: "2026-09-07", now: NOW });
      const expired = new Date(NOW.getTime() - 3_600_000).toISOString();
      await db.query("update analytics_jobs set state = 'leased', lease_owner = 'dead-worker', lease_until = $2, attempts = 1 where id = any($1::uuid[])", [[stuck.id, other.id], expired]);
      const h = harness(db, [f.a]);
      // Without recovering the pilot connection's own stuck lease, nothing on that connection could be leased at all.
      const result = await h.sync(f.a);
      expect(result.succeeded).toBe(11);
      const states = Object.fromEntries((await db.query<{ id: string; state: string }>("select id, state from analytics_jobs where id = any($1::uuid[])", [[stuck.id, other.id]])).rows.map((r) => [r.id, r.state]));
      expect(states[stuck.id]).toBe("queued"); // reaped
      expect(states[other.id]).toBe("leased"); // another connection's lease is not ours to touch
    });
  });

  it("does nothing while another worker holds a live lease on this connection, and takes no second lease", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const busy = await enqueueJob(db, { clientId: f.a.clientId, websiteId: f.a.websiteId, connectionId: f.a.id, templateKey: "ga4.landing", start: "2026-09-01", end: "2026-09-07", now: NOW });
      await db.query("update analytics_jobs set state = 'leased', lease_owner = 'live-worker', lease_until = $2, attempts = 1 where id = $1", [busy.id, new Date(NOW.getTime() + 150_000).toISOString()]);
      const h = harness(db, [f.a]);
      const result = await h.sync(f.a);
      expect(result).toMatchObject({ jobs: 0, stopped: "empty", jobStates: { queued: 11 } });
      expect(h.state.calls).toHaveLength(0);
      expect((await db.query<{ n: number }>("select count(*)::int as n from analytics_jobs where connection_id = $1 and state = 'leased'", [f.a.id])).rows[0]!.n).toBe(1);
    });
  });
});

describe("failure, retry and recovery", () => {
  it("a provider timeout is retried with backoff, the connection is untouched, and finishing later repeats no request", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      let failing = true;
      const real = fictionalProviders().fetch;
      const provider: FetchLike = async (url, init) => {
        if (failing && url.includes("analyticsdata")) throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
        return real(url, init);
      };
      const h = harness(db, [f.a], { provider });
      const first = await h.sync(f.a);
      expect(first).toMatchObject({ jobs: 1, retryScheduled: 1, succeeded: 0, connectionStatusChanged: false });
      expect(first.jobStates.queued).toBe(11); // the retried job waits; the connection is paused, so the others are not tried
      expect(h.state.calls).toHaveLength(1);
      failing = false;
      h.state.now += 40 * 60_000; // past the connection's pause and the job's backoff
      const later = await h.sync(f.a);
      expect(later).toMatchObject({ succeeded: 11, failed: 0, connectionStatusChanged: false });
      expect(h.state.calls).toHaveLength(1 + 11);
      const row = (await db.query<{ status: string; consecutive_failures: number }>("select status, consecutive_failures from analytics_connections where id = $1", [f.a.id])).rows[0]!;
      expect(row).toEqual({ status: "connected", consecutive_failures: 0 });
    });
  });

  it("a rate limit waits for Retry-After and is retried", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      let limited = true;
      const real = fictionalProviders().fetch;
      const provider: FetchLike = async (url, init) => (limited ? response(429, {}, { "retry-after": "900" }) : real(url, init));
      const h = harness(db, [f.a], { provider });
      expect(await h.sync(f.a, { maxJobs: 2 })).toMatchObject({ retryScheduled: 1 });
      const wait = (await db.query<{ next_attempt_at: Date }>("select next_attempt_at from analytics_jobs where connection_id = $1 and state = 'queued' and attempts = 1", [f.a.id])).rows[0]!.next_attempt_at;
      expect(wait.getTime() - h.state.now).toBeGreaterThanOrEqual(900_000 - 1000);
      limited = false;
      h.state.now += 16 * 60_000;
      expect((await h.sync(f.a, { maxJobs: 12 })).succeeded).toBe(11);
    });
  });

  it("an unusable provider answer is retried and never stored over a report", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const h = harness(db, [f.a], { provider: async () => response(200, "<html>maintenance</html>") });
      const result = await h.sync(f.a, { maxJobs: 1 });
      expect(result).toMatchObject({ retryScheduled: 1, succeeded: 0, reports: [] });
      expect((await db.query<{ n: number }>("select count(*)::int as n from analytics_report_partitions where connection_id = $1", [f.a.id])).rows[0]!.n).toBe(0);
    });
  });

  it("a server credential problem during a run leaves the connection alone, waits, and can be retried once fixed", async () => {
    await asContext(SERVICE, async (db) => {
      const admin = await staffByEmail("admin@example.invalid");
      const f = await fixture(db);
      const clinic = await provisionClinic(db, admin.id);
      const stale = await connect(db, admin.id, clinic, "ga4", "tok-stale", { expiresAt: "2026-01-01T00:00:00.000Z" });
      let clientOk = false;
      const real = fictionalProviders().fetch;
      const provider: FetchLike = async (url, init) => {
        if (url.includes("oauth2.googleapis.com")) return clientOk ? response(200, { access_token: "fresh", expires_in: 3600 }) : response(401, { error: "invalid_client" });
        return real(url, init);
      };
      const h = harness(db, [stale], { provider });
      const secretBefore = (await db.query("select ciphertext, nonce from analytics_secrets where connection_id = $1", [stale.id])).rows[0];
      const bad = await h.sync(stale);
      expect(bad).toMatchObject({ jobs: 1, succeeded: 0, credentialOrConfigWaiting: 1, reconnectRequired: 0, connectionStatusChanged: false });
      expect((await db.query("select ciphertext, nonce from analytics_secrets where connection_id = $1", [stale.id])).rows[0]).toEqual(secretBefore);
      expect((await db.query<{ status: string }>("select status from analytics_connections where id = $1", [stale.id])).rows[0]!.status).toBe("connected");
      expect(h.state.calls.filter((c) => c.host === "oauth2.googleapis.com")).toHaveLength(1);
      expect((await auditFor(db, "analytics.pilot.run")).at(-1)).toMatchObject({ outcome: "failure" });
      // Fixed. The jobs are waiting two hours; asking again with requeueWaiting makes them due now.
      clientOk = true;
      expect((await h.sync(stale)).jobs).toBe(0);
      const fixed = await h.sync(stale, { requeueWaiting: true });
      expect(fixed).toMatchObject({ succeeded: 11, credentialOrConfigWaiting: 0, connectionStatusChanged: false });
      expect(f.a.id).not.toBe(stale.id);
    });
  });

  it("a genuinely revoked grant is still reported, and the status change is shown in the result", async () => {
    await asContext(SERVICE, async (db) => {
      const admin = await staffByEmail("admin@example.invalid");
      await fixture(db);
      const clinic = await provisionClinic(db, admin.id);
      const stale = await connect(db, admin.id, clinic, "ga4", "tok-revoked", { expiresAt: "2026-01-01T00:00:00.000Z" });
      const h = harness(db, [stale], { provider: async () => response(400, { error: "invalid_grant" }) });
      // One rejected request, not one per queued job: once flagged, the connection's other jobs are not worked.
      expect(await h.sync(stale)).toMatchObject({ jobs: 1, reconnectRequired: 1, connectionStatusChanged: true });
      expect(h.state.calls).toHaveLength(1);
      // The other ten jobs ended the same way, without being worked.
      expect((await h.sync(stale).catch((e) => e))).toMatchObject({ status: 409 });
      expect((await db.query<{ state: string; n: number }>("select state, count(*)::int as n from analytics_jobs where connection_id = $1 group by 1", [stale.id])).rows).toEqual([{ state: "reconnect_required", n: 11 }]);
    });
  });

  it("a database failure while storing leaves the job to be recovered, closes the record, and the next call finishes", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      let calls = 0;
      // Calls: 1 resolve, 2 register, 3 enqueue, 4 claim, 5 store. The store is lost, as a dropped connection would lose it.
      const flaky: PilotRun = async (fn) => {
        calls += 1;
        if (calls === 5) throw new Error("connection terminated unexpectedly");
        return fn(db);
      };
      const h = harness(db, [f.a], { run: flaky });
      await expect(h.sync(f.a, { maxJobs: 1 })).rejects.toThrow("connection terminated");
      const inv = (await db.query<{ state: string; stop_reason: string; safe_error_code: string }>("select state, stop_reason, safe_error_code from analytics_worker_invocations where owner like 'pilot:%'")).rows[0]!;
      expect(inv).toMatchObject({ state: "finished", stop_reason: "error", safe_error_code: "worker_error" });
      expect((await auditFor(db, "analytics.pilot.run")).at(-1)).toMatchObject({ outcome: "failure" });
      expect((await db.query<{ status: string }>("select status from analytics_connections where id = $1", [f.a.id])).rows[0]!.status).toBe("connected");
      // The lease runs out (150 s); the next call recovers it and completes.
      const retry = harness(db, [f.a]);
      retry.state.now = NOW.getTime() + 10 * 60_000;
      const recovered = await retry.sync(f.a, { maxJobs: 12 });
      // The recovered job waits out its 30-second backoff; every other job runs now.
      expect(recovered).toMatchObject({ succeeded: 10, failed: 0 });
      retry.state.now += 60_000;
      expect(await retry.sync(f.a, { maxJobs: 12 })).toMatchObject({ jobs: 1, succeeded: 1, jobStates: { succeeded: 11 } });
      expect(retry.state.calls).toHaveLength(11); // the lost store was the only repeated work, and it was never counted twice
    });
  });
});

describe("overlap and audit", () => {
  it("refuses to start while the allowed number of invocations is already running", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      for (let i = 0; i < 2; i += 1) {
        await db.query("insert into analytics_worker_invocations (owner, trigger, started_at, budget_ms, job_limit) values ('other', 'schedule', $1, 90000, 40)", [NOW.toISOString()]);
      }
      const h = harness(db, [f.a]);
      h.state.now += 60_000;
      const result = await h.sync(f.a);
      expect(result).toMatchObject({ stopped: "overlap", jobs: 0, queuedNow: 0 });
      expect(h.state.calls).toHaveLength(0);
      expect((await db.query("select 1 from analytics_jobs where connection_id = $1", [f.a.id])).rowCount).toBe(0);
      expect((await auditFor(db, "analytics.pilot.run")).at(-1)).toMatchObject({ outcome: "failure", metadata: expect.objectContaining({ stopped: "overlap" }) });
    });
  });

  it("writes a complete audit trail, and nothing in it or in any result can identify a token, property, site or client", async () => {
    await asContext(SERVICE, async (db) => {
      const f = await fixture(db);
      const h = harness(db, [f.a]);
      const results = [await h.probe(f.a), await h.sync(f.a, { maxJobs: 2 }), await h.sync(f.a)];
      await h.sync(f.b).catch(() => undefined);
      const trail = (await db.query<{ action: string; outcome: string; metadata: unknown }>(
        "select action, outcome, metadata from audit_events where action like 'analytics.pilot.%' order by occurred_at, id")).rows;
      // Rows written in one test transaction share a timestamp, so compare the set, not the order.
      expect(trail.map((t) => `${t.action}:${t.outcome}`).sort()).toEqual([
        "analytics.pilot.probe:success", "analytics.pilot.refused:denied", "analytics.pilot.run:success", "analytics.pilot.run:success",
      ]);
      const text = JSON.stringify({ results, trail });
      const names = (await db.query<{ slug: string; name: string }>("select slug, name from clients where id = $1", [f.a.clientId])).rows[0]!;
      for (const secret of [f.a.token, f.b.token, KEY, "client-secret", "refresh-tok", f.a.property, f.a.id, f.a.clientId, f.a.websiteId, names.slug, "check.example.invalid", "example.invalid"]) {
        expect(text, secret).not.toContain(secret);
      }
    });
  });
});

describe("lease-level concurrency (committed fixture, removed afterwards)", () => {
  it("never leases outside the allowed jobs, never another connection, and never two jobs of one connection", async () => {
    const site = (await adminPool.query<{ id: string; client_id: string }>("select id, client_id from websites order by created_at limit 1")).rows[0];
    if (!site) throw new Error("Seed website missing. Run npm run db:seed.");
    const created: string[] = [];
    const jobIds: Record<string, string[]> = {};
    try {
      for (const property of ["pilot-concurrent-a", "pilot-concurrent-b"]) {
        const { rows } = await adminPool.query<{ id: string }>(
          `insert into analytics_connections (client_id, website_id, provider, external_property_id, provider_timezone, status)
           values ($1, $2, 'ga4', $3, 'UTC', 'connected') returning id`, [site.client_id, site.id, property]);
        created.push(rows[0]!.id);
        jobIds[rows[0]!.id] = [];
        for (let i = 0; i < 6; i += 1) {
          const job = await adminPool.query<{ id: string }>(
            `insert into analytics_jobs (client_id, website_id, connection_id, template_key, query_hash, start_date, end_date, priority, next_attempt_at)
             values ($1, $2, $3, 'ga4.traffic_range', $4, '2026-11-01', $5, 10, '2026-01-01T00:00:00Z') returning id`,
            [site.client_id, site.id, rows[0]!.id, `${i}`.padStart(64, "b"), `2026-11-0${i + 1}`]);
          jobIds[rows[0]!.id]!.push(job.rows[0]!.id);
        }
      }
      const [pilotConnection, otherConnection] = created as [string, string];
      const allowedJobs = jobIds[pilotConnection]!.slice(0, 4);
      const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) =>
        asContext(SERVICE, (db) => leaseNext(db, `pilot-${i}`, NOW, { connectionId: pilotConnection, jobIds: allowedJobs }), { commit: true })));
      const leased = attempts.filter((job) => job !== null);
      expect(leased.length).toBeGreaterThan(0);
      expect(leased.length).toBeLessThanOrEqual(1); // one lease per connection, enforced by the database
      for (const job of leased) {
        expect(job!.connection_id).toBe(pilotConnection);
        expect(allowedJobs).toContain(job!.id);
      }
      const touched = await adminPool.query("select 1 from analytics_jobs where connection_id = $1 and state <> 'queued'", [otherConnection]);
      expect(touched.rowCount).toBe(0);
      const outside = await adminPool.query("select 1 from analytics_jobs where connection_id = $1 and state = 'leased' and not (id = any($2::uuid[]))", [pilotConnection, allowedJobs]);
      expect(outside.rowCount).toBe(0);
    } finally {
      if (created.length > 0) {
        await adminPool.query("delete from analytics_sync_runs where connection_id = any($1::uuid[])", [created]);
        await adminPool.query("delete from analytics_jobs where connection_id = any($1::uuid[])", [created]);
        await adminPool.query("delete from analytics_connections where id = any($1::uuid[])", [created]);
      }
    }
  });
});
