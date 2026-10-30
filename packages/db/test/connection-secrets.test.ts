import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";
import { PermissionDeniedError } from "../src/services/auth";
import { createOAuthState, disconnectConnection, listConnections, saveConnection } from "../src/analytics/connections";
import { sealedToken } from "../src/analytics/sync";
import { updateWebsite } from "../src/services/registry";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("connection credential writes", () => {
  it("lets an administrator store a connection and keeps the secret out of the staff row, list and audit", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    const marker = "staff-must-not-see-this";
    await asContext(SERVICE, async (db) => {
      const site = (await db.query<{ id: string }>("select id from websites where client_id = $1 order by created_at limit 1", [harbour])).rows[0]!.id;
      const token = sealedToken({ accessToken: marker, expiresAt: "2100-01-01T00:00:00.000Z" });
      const connection = await saveConnection(db, {
        clientId: harbour,
        websiteId: site,
        provider: "ga4",
        externalPropertyId: "gw011-admin",
        streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore",
        tokenCiphertext: token.ciphertext,
        tokenNonce: token.nonce,
        actorUserId: admin.id,
      });
      expect(connection).not.toHaveProperty("ciphertext");
      expect(connection).not.toHaveProperty("nonce");
      expect(connection).not.toHaveProperty("secret_ref");
      const listed = await listConnections(db, harbour);
      expect(listed.some((row) => row.id === connection.id)).toBe(true);
      expect(Object.keys(listed.find((row) => row.id === connection.id) ?? {})).not.toEqual(expect.arrayContaining(["ciphertext", "nonce", "secret_ref"]));
      const audit = await db.query<{ metadata: string }>(
        "select metadata::text as metadata from audit_events where action = 'analytics.connection.bind' and target_id = $1",
        [connection.id],
      );
      const recorded = audit.rows.map((row) => row.metadata).join("\n");
      expect(recorded).not.toContain(marker);
      expect(recorded).not.toContain(token.ciphertext);
      expect(recorded).not.toContain(token.nonce);
      await disconnectConnection(db, { connectionId: connection.id, actorUserId: admin.id });

      await applyContext(db, staffCtx(admin));
      await db.query(
        "insert into analytics_connections (client_id, website_id, provider, external_property_id, provider_timezone, created_by) values ($1, $2, 'gsc', 'gw011-admin-row', 'UTC', $3)",
        [harbour, site, admin.id],
      );
      expect((await db.query("select ciphertext from analytics_secrets")).rows).toEqual([]);
    });
  });

  it("refuses manager, specialist, reviewer and read-only secret writes, including a direct insert", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const manager = await staffByEmail("manager@example.invalid");
    const specialist = await staffByEmail("specialist-a@example.invalid");
    const reviewer = await staffByEmail("reviewer@example.invalid");
    const reader = await staffByEmail("readonly@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    await asContext(SERVICE, async (db) => {
      const site = (await db.query<{ id: string; name: string; url: string | null; platform: string; environment: "production" | "staging" | "development"; status: "active" | "archived"; notes: string | null }>(
        "select id, name, url, platform, environment, status, notes from websites where client_id = $1 order by created_at limit 1",
        [harbour],
      )).rows[0]!;
      const token = sealedToken({ accessToken: "manager-must-not-store-this", expiresAt: "2100-01-01T00:00:00.000Z" });
      const connection = await saveConnection(db, {
        clientId: harbour,
        websiteId: site.id,
        provider: "ga4",
        externalPropertyId: "gw011-deny",
        streamOrSiteRef: null,
        providerTimezone: "Asia/Singapore",
        tokenCiphertext: token.ciphertext,
        tokenNonce: token.nonce,
        actorUserId: admin.id,
      });
      for (const actor of [manager, specialist, reviewer, reader]) {
        await expect(saveConnection(db, {
          clientId: harbour,
          websiteId: site.id,
          provider: "gsc",
          externalPropertyId: `gw011-${actor.platform_role}`,
          streamOrSiteRef: null,
          providerTimezone: "Asia/Singapore",
          tokenCiphertext: token.ciphertext,
          tokenNonce: token.nonce,
          actorUserId: actor.id,
        })).rejects.toBeInstanceOf(PermissionDeniedError);
        await expect(createOAuthState(db, {
          actorUserId: actor.id,
          clientId: harbour,
          websiteId: site.id,
          provider: "ga4",
          redirectUri: "http://127.0.0.1:3400/api/analytics/google/callback",
        })).rejects.toBeInstanceOf(PermissionDeniedError);
        await expect(disconnectConnection(db, { connectionId: connection.id, actorUserId: actor.id })).rejects.toBeInstanceOf(PermissionDeniedError);
      }

      await applyContext(db, staffCtx(manager));
      await db.query("savepoint denied_insert");
      await expect(db.query(
        "insert into analytics_connections (client_id, website_id, provider, external_property_id, provider_timezone, created_by) values ($1, $2, 'ga4', 'gw011-manager', 'UTC', $3)",
        [harbour, site.id, manager.id],
      )).rejects.toThrow(/row-level security/);
      await db.query("rollback to savepoint denied_insert");
      const updated = await db.query("update analytics_connections set status = 'disconnected' where id = $1", [connection.id]);
      expect(updated.rowCount).toBe(0);
      expect((await db.query("select ciphertext, nonce from analytics_secrets")).rows).toEqual([]);
      expect((await db.query("select token_ciphertext, code_verifier_ciphertext from analytics_oauth_states")).rows).toEqual([]);
      await updateWebsite(db, site.id, {
        name: site.name,
        url: site.url,
        platform: site.platform,
        environment: site.environment,
        status: site.status,
        notes: site.notes,
      }, manager.id);

      for (const actor of [specialist, reviewer, reader]) {
        await applyContext(db, staffCtx(actor));
        await db.query("savepoint denied_insert");
        await expect(db.query(
          "insert into analytics_connections (client_id, website_id, provider, external_property_id, provider_timezone, created_by) values ($1, $2, 'ga4', $3, 'UTC', $4)",
          [harbour, site.id, `gw011-${actor.platform_role}`, actor.id],
        )).rejects.toThrow(/row-level security/);
        await db.query("rollback to savepoint denied_insert");
      }

      await applyContext(db, SERVICE);
      expect((await db.query<{ status: string }>("select status from analytics_connections where id = $1", [connection.id])).rows[0]?.status).toBe("connected");
    });
  });
});
