import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { PermissionDeniedError } from "../src/services/auth";
import { getPublishedSeoConfiguration, hasActiveSeoSiteToken, issueSeoSiteToken } from "../src/services/seo-soft-launch";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("SEO website API tokens", () => {
  it("lets an admin create and rotate a token that the public API can read", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(staffCtx(admin), async (db) => {
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      const first = await issueSeoSiteToken(db, clientId, websiteId, admin.id);
      const second = await issueSeoSiteToken(db, clientId, websiteId, admin.id);
      expect(first).not.toEqual(second);
      expect(await hasActiveSeoSiteToken(db, websiteId)).toBe(true);
      expect(await getPublishedSeoConfiguration(db, websiteId, second)).not.toBeNull();
      expect(await getPublishedSeoConfiguration(db, websiteId, first)).toBeNull();
      const audit = await db.query<{ metadata: string }>(
        "select metadata::text as metadata from audit_events where action = 'seo.site_token.rotate' and target_id = $1",
        [websiteId],
      );
      const recorded = audit.rows.map((row) => row.metadata).join("\n");
      expect(recorded).not.toContain(first);
      expect(recorded).not.toContain(second);
    });
  });

  it("refuses a manager service call, raw insert and raw update", async () => {
    const manager = await staffByEmail("manager@example.invalid");
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(staffCtx(admin), async (db) => {
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      await applyContext(db, staffCtx(manager));
      await expect(issueSeoSiteToken(db, clientId, websiteId, manager.id)).rejects.toBeInstanceOf(PermissionDeniedError);
      await applyContext(db, SERVICE);
      await expect(issueSeoSiteToken(db, clientId, websiteId, manager.id)).rejects.toBeInstanceOf(PermissionDeniedError);
      await applyContext(db, staffCtx(manager));
      await db.query("savepoint manager_token");
      await expect(db.query("insert into seo_site_tokens (client_id, website_id, token_hash, created_by) values ($1, $2, $3, $4)", [
        clientId,
        websiteId,
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        manager.id,
      ])).rejects.toThrow(/row-level security/);
      await db.query("rollback to savepoint manager_token");
      await applyContext(db, staffCtx(admin));
      await issueSeoSiteToken(db, clientId, websiteId, admin.id);
      await applyContext(db, staffCtx(manager));
      const updated = await db.query("update seo_site_tokens set revoked_at = now() where website_id = $1 and revoked_at is null", [websiteId]);
      expect(updated.rowCount).toBe(0);
      expect((await db.query("select 1 from seo_site_tokens where website_id = $1 and revoked_at is null", [websiteId])).rows).toHaveLength(1);
    });
  });

  it("refuses a specialist, reviewer and read-only user", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const reviewer = await staffByEmail("reviewer@example.invalid");
    const readonly = await staffByEmail("readonly@example.invalid");
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(staffCtx(admin), async (db) => {
      const { clientId, websiteId } = await provisionClinic(db, admin.id);
      await applyContext(db, staffCtx(specA));
      await expect(issueSeoSiteToken(db, clientId, websiteId, specA.id)).rejects.toBeInstanceOf(PermissionDeniedError);
      await applyContext(db, staffCtx(reviewer));
      await expect(issueSeoSiteToken(db, clientId, websiteId, reviewer.id)).rejects.toBeInstanceOf(PermissionDeniedError);
      await applyContext(db, staffCtx(readonly));
      await expect(issueSeoSiteToken(db, clientId, websiteId, readonly.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    });
  });

  it("blocks a specialist raw insert even for a client they can edit", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(staffCtx(admin), async (db) => {
      const { clientId, websiteId } = await provisionClinic(db, admin.id, [specA.id]);
      await applyContext(db, staffCtx(specA));
      await expect(db.query("insert into seo_site_tokens (client_id, website_id, token_hash, created_by) values ($1, $2, $3, $4)", [
        clientId,
        websiteId,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        specA.id,
      ])).rejects.toThrow();
    });
  });
});
