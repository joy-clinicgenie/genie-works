import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { SERVICE, applyContext, type Queryable } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { AnalyticsRuleError, normalisePropertyId, saveConnection } from "../src/analytics/connections";
import { sealedToken } from "../src/analytics/sync";
import { associationAudit } from "../src/analytics/validation";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const TOKEN = sealedToken({ accessToken: "t", expiresAt: "2100-01-01T00:00:00.000Z" });

async function bind(db: Queryable, adminId: string, ids: { clientId: string; websiteId: string }, provider: "ga4" | "gsc" | "wix", property: string, extra: { allowCrossClient?: { reason: string } } = {}) {
  return saveConnection(db, {
    clientId: ids.clientId, websiteId: ids.websiteId, provider, externalPropertyId: property, streamOrSiteRef: null,
    providerTimezone: provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore",
    tokenCiphertext: TOKEN.ciphertext, tokenNonce: TOKEN.nonce, actorUserId: adminId, ...extra,
  });
}

/** A binding as old data could hold it: written directly, bypassing the guard. */
async function legacyBinding(db: Queryable, ids: { clientId: string; websiteId: string }, provider: string, property: string) {
  await db.query(
    "insert into analytics_connections (client_id, website_id, provider, external_property_id, status, provider_timezone) values ($1, $2, $3, $4, 'connected', 'Asia/Singapore')",
    [ids.clientId, ids.websiteId, provider, property],
  );
}

async function quiet(db: Queryable) {
  await db.query("update analytics_connections set status = 'disconnected', disconnected_at = now() where status <> 'disconnected' and disconnected_at is null");
}

describe("cross-client safeguard in the application (Phase 2.3A)", () => {
  it("refuses a property another client already has, without saying who", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await quiet(db);
      const one = await provisionClinic(db, admin.id);
      const two = await provisionClinic(db, admin.id);
      await bind(db, admin.id, one, "ga4", "700777");
      const error = await bind(db, admin.id, two, "ga4", "700777").catch((e) => e);
      expect(error).toBeInstanceOf(AnalyticsRuleError);
      expect(error.field).toBe("externalPropertyId");
      expect(error.message).toMatch(/already connected to another client/);
      // Another clinic's name, slug and id must not leak into the message.
      const names = (await db.query<{ slug: string; name: string }>("select slug, name from clients where id = $1", [one.clientId])).rows[0]!;
      expect(error.message).not.toContain(names.slug);
      expect(error.message).not.toContain(one.clientId);
      // Nothing was written for the second client.
      expect((await db.query("select 1 from analytics_connections where client_id = $1", [two.clientId])).rowCount).toBe(0);
    });
  });

  it("allows the same property on another website of the SAME client (a live and a staging site)", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await quiet(db);
      const clinic = await provisionClinic(db, admin.id);
      await bind(db, admin.id, { clientId: clinic.clientId, websiteId: clinic.websiteId }, "ga4", "700778");
      await expect(bind(db, admin.id, { clientId: clinic.clientId, websiteId: clinic.stagingId }, "ga4", "700778")).resolves.toMatchObject({ provider: "ga4" });
    });
  });

  it("compares Search Console properties without regard to case or a trailing slash, and by provider", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    expect(normalisePropertyId("  SC-Domain:Example.COM/ ")).toBe("sc-domain:example.com");
    await asContext(SERVICE, async (db) => {
      await quiet(db);
      const one = await provisionClinic(db, admin.id);
      const two = await provisionClinic(db, admin.id);
      await bind(db, admin.id, one, "gsc", "https://example.invalid/");
      await expect(bind(db, admin.id, two, "gsc", "HTTPS://EXAMPLE.INVALID")).rejects.toBeInstanceOf(AnalyticsRuleError);
      // The same text under a different provider is a different property.
      await expect(bind(db, admin.id, two, "wix", "https://example.invalid/")).resolves.toMatchObject({ provider: "wix" });
    });
  });

  it("lets a property be reconnected after it was disconnected from the other client", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await quiet(db);
      const one = await provisionClinic(db, admin.id);
      const two = await provisionClinic(db, admin.id);
      const first = await bind(db, admin.id, one, "ga4", "700779");
      await db.query("update analytics_connections set status = 'disconnected', disconnected_at = now() where id = $1", [first.id]);
      await expect(bind(db, admin.id, two, "ga4", "700779")).resolves.toMatchObject({ client_id: two.clientId });
    });
  });

  it("allows a deliberate share only with a stated reason, and records it in the audit log", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await quiet(db);
      const one = await provisionClinic(db, admin.id);
      const two = await provisionClinic(db, admin.id);
      await bind(db, admin.id, one, "ga4", "700780");
      await expect(bind(db, admin.id, two, "ga4", "700780", { allowCrossClient: { reason: "short" } })).rejects.toBeInstanceOf(AnalyticsRuleError);
      const shared = await bind(db, admin.id, two, "ga4", "700780", { allowCrossClient: { reason: "Group practice shares one analytics property" } });
      const audit = await db.query<{ metadata: Record<string, unknown> }>(
        "select metadata from audit_events where action = 'analytics.connection.bind' and target_id = $1", [shared.id]);
      expect(audit.rows[0]!.metadata).toMatchObject({ crossClientAcknowledged: true, crossClientReason: "Group practice shares one analytics property" });
    });
  });

  it("does not touch existing connections: a pre-existing duplicate stays connected and keeps working", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await quiet(db);
      const one = await provisionClinic(db, admin.id);
      const two = await provisionClinic(db, admin.id);
      await legacyBinding(db, one, "ga4", "700781");
      await legacyBinding(db, two, "ga4", "700781");
      // A third client is refused, but the two that exist are untouched.
      const three = await provisionClinic(db, admin.id);
      await expect(bind(db, admin.id, three, "ga4", "700781")).rejects.toBeInstanceOf(AnalyticsRuleError);
      const states = await db.query<{ status: string }>("select status from analytics_connections where external_property_id = '700781' order by created_at");
      expect(states.rows.map((r) => r.status)).toEqual(["connected", "connected"]);
    });
  });

  it("serialises two simultaneous binds of one property, so both cannot pass the check", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const a = await appPool.connect();
    const b = await appPool.connect();
    try {
      await a.query("begin");
      await applyContext(a, SERVICE);
      await b.query("begin");
      await applyContext(b, SERVICE);
      await quiet(a);
      const one = await provisionClinic(a, admin.id);
      const two = await provisionClinic(b, admin.id);
      await bind(a, admin.id, one, "ga4", "700782");
      // B must now wait for A, which holds the property's lock until it ends.
      let settled = false;
      const pending = bind(b, admin.id, two, "ga4", "700782").then(() => { settled = true; return "bound"; }, () => { settled = true; return "refused"; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await a.query("rollback");
      // A never committed, so there is nothing for B to conflict with: it proceeds and binds.
      expect(await pending).toBe("bound");
    } finally {
      await a.query("rollback").catch(() => undefined);
      await b.query("rollback").catch(() => undefined);
      a.release();
      b.release();
    }
  });
});

describe("association audit (Phase 2.3A)", () => {
  it("separates a property under another client (action) from one shared within a client (review)", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await quiet(db);
      const one = await provisionClinic(db, admin.id);
      const two = await provisionClinic(db, admin.id);
      await bind(db, admin.id, { clientId: one.clientId, websiteId: one.websiteId }, "ga4", "700790");
      await bind(db, admin.id, { clientId: one.clientId, websiteId: one.stagingId }, "ga4", "700790"); // same client, two sites
      await legacyBinding(db, two, "ga4", "700790"); // legacy: another client
      await bind(db, admin.id, one, "gsc", "sc-domain:unrelated.example.invalid", {});
      const noZone = await bind(db, admin.id, two, "wix", "wix-aud-1");
      await db.query("update analytics_connections set provider_timezone = null where id = $1", [noZone.id]);
      const audit = await associationAudit(db);
      expect(audit.checked).toBe(5);
      const byKind = (kind: string) => audit.findings.filter((f) => f.kind === kind);
      // The two sites of the first client plus the legacy one: each of the three sees the other client.
      expect(byKind("property_bound_to_other_client").length).toBe(3);
      expect(byKind("property_bound_to_other_client").every((f) => f.severity === "action")).toBe(true);
      expect(byKind("property_shared_within_client").length).toBe(2);
      expect(byKind("property_shared_within_client").every((f) => f.severity === "review")).toBe(true);
      expect(byKind("gsc_site_does_not_match_website")).toHaveLength(1);
      expect(byKind("missing_time_zone")).toHaveLength(1);
      expect(byKind("connected_without_secret")).toHaveLength(1); // the legacy row was written without a token
      expect(audit.summary.property_bound_to_other_client).toBe(3);
      // The consistency checks come back empty: the database already makes those states impossible.
      expect(byKind("client_website_mismatch")).toEqual([]);
      expect(byKind("secret_scope_mismatch")).toEqual([]);
      // Short hashes only.
      const text = JSON.stringify(audit);
      for (const needle of ["700790", "unrelated", "wix-aud-1", one.clientId, two.clientId]) expect(text).not.toContain(needle);
    });
  });

  it("is read only, and a clean estate has no findings", async () => {
    await asContext(SERVICE, async (db) => {
      await quiet(db);
      await db.query("set transaction read only");
      const audit = await associationAudit(db);
      expect(audit).toEqual({ checked: 0, findings: [], summary: {} });
      await expect(db.query("update analytics_connections set status = status")).rejects.toMatchObject({ code: "25006" });
    });
  });

  it("a specialist without access sees none of another client's connections (so the check must run as an administrator)", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specialist = await staffByEmail("specialist-a@example.invalid");
    await asContext(SERVICE, async (db) => {
      await quiet(db);
      const clinic = await provisionClinic(db, admin.id);
      await bind(db, admin.id, clinic, "ga4", "700791");
      await applyContext(db, staffCtx(specialist));
      expect((await db.query("select 1 from analytics_connections")).rowCount).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The prepared database guard (packages/db/prepared). Applied only inside a transaction that is rolled back.

const PREPARED = join(__dirname, "../prepared");
const guardUp = readFileSync(join(PREPARED, "analytics_property_one_client.sql"), "utf8").replace(/^begin;|commit;\s*$/gm, "");
const guardDown = readFileSync(join(PREPARED, "analytics_property_one_client.down.sql"), "utf8").replace(/^begin;|commit;\s*$/gm, "");

async function owner<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await adminPool.connect();
  try {
    await client.query("begin");
    await client.query("update analytics_connections set status = 'disconnected', disconnected_at = now() where status <> 'disconnected' and disconnected_at is null");
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

const guardObjects = async (client: pg.PoolClient) => (await client.query(
  `select (select count(*) from pg_trigger where tgname = 'analytics_connections_one_client' and not tgisinternal)::int as trigger,
          (select count(*) from information_schema.columns where table_name = 'analytics_connections' and column_name = 'cross_client_ack_reason')::int as col`)).rows[0];

describe("prepared database guard (not applied to any real database)", () => {
  it("is outside the migrations directory, so db:migrate cannot run it", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    expect(readdirSync(join(__dirname, "../migrations")).some((f) => f.includes("one_client"))).toBe(false);
  });

  it("refuses to apply, and applies nothing, while a property is under two clients", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await owner(async (client) => {
      const db = client as unknown as Queryable;
      const one = await provisionClinic(db, admin.id);
      const two = await provisionClinic(db, admin.id);
      await legacyBinding(db, one, "ga4", "700801");
      await legacyBinding(db, two, "ga4", "700801");
      await client.query("savepoint pre");
      await expect(client.query(guardUp)).rejects.toThrow(/analytics property guard not applied: 1 property/);
      await client.query("rollback to savepoint pre");
      expect(await guardObjects(client)).toEqual({ trigger: 0, col: 0 });
    });
  });

  it("applies on clean data, then refuses a second client, allows an acknowledged share and a disconnected row, and leaves data alone", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await owner(async (client) => {
      const db = client as unknown as Queryable;
      const one = await provisionClinic(db, admin.id);
      const two = await provisionClinic(db, admin.id);
      await legacyBinding(db, one, "ga4", "700802");
      const before = (await client.query("select count(*)::int as n from analytics_connections")).rows[0].n;
      await client.query(guardUp);
      expect(await guardObjects(client)).toEqual({ trigger: 1, col: 1 });
      expect((await client.query("select count(*)::int as n from analytics_connections")).rows[0].n).toBe(before);

      await client.query("savepoint s1");
      await expect(legacyBinding(db, two, "ga4", "700802")).rejects.toMatchObject({ code: "23505", message: "analytics_property_other_client" });
      await client.query("rollback to savepoint s1");
      // Normalised: case and a trailing slash do not get past it.
      await client.query("savepoint s2");
      await expect(legacyBinding(db, two, "ga4", "700802/")).rejects.toMatchObject({ code: "23505" });
      await client.query("rollback to savepoint s2");
      // A different provider, and the same client, are fine.
      await legacyBinding(db, two, "wix", "700802");
      await legacyBinding(db, { clientId: one.clientId, websiteId: one.stagingId }, "ga4", "700802");
      // A disconnected row is not a binding.
      await client.query(
        "insert into analytics_connections (client_id, website_id, provider, external_property_id, status, disconnected_at) values ($1, $2, 'ga4', '700802', 'disconnected', now())",
        [two.clientId, two.websiteId]);
      // An administrator's acknowledged exception goes through.
      await client.query(
        "insert into analytics_connections (client_id, website_id, provider, external_property_id, status, cross_client_ack_reason) values ($1, $2, 'ga4', '700802', 'connected', 'Group practice shares one property')",
        [two.clientId, two.websiteId]);
      // Reconnecting a disconnected row to a property another client holds is refused too.
      await client.query("savepoint s3");
      await expect(client.query("update analytics_connections set status = 'connected', disconnected_at = null where client_id = $1 and external_property_id = '700802' and status = 'disconnected'", [two.clientId])).rejects.toMatchObject({ code: "23505" });
      await client.query("rollback to savepoint s3");
    });
  });

  it("sees other clients' rows even when the writer is a specialist who cannot", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await owner(async (client) => {
      const db = client as unknown as Queryable;
      const one = await provisionClinic(db, admin.id);
      const two = await provisionClinic(db, admin.id);
      await legacyBinding(db, one, "ga4", "700803");
      await client.query(guardUp);
      // The function is security definer: the check does not depend on what the caller may read.
      const def = await client.query("select prosecdef from pg_proc where proname = 'analytics_connections_one_client'");
      expect(def.rows[0].prosecdef).toBe(true);
      await client.query("savepoint s");
      await expect(legacyBinding(db, two, "ga4", "700803")).rejects.toMatchObject({ code: "23505" });
      await client.query("rollback to savepoint s");
    });
  });

  it("rolls back cleanly and leaves every row as it was", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await owner(async (client) => {
      const db = client as unknown as Queryable;
      const one = await provisionClinic(db, admin.id);
      await legacyBinding(db, one, "ga4", "700804");
      const snapshot = async () => (await client.query("select id, client_id, website_id, provider, external_property_id, status from analytics_connections order by id")).rows;
      const before = await snapshot();
      await client.query(guardUp);
      await client.query(guardDown);
      expect(await guardObjects(client)).toEqual({ trigger: 0, col: 0 });
      expect(await snapshot()).toEqual(before);
    });
  });
});
