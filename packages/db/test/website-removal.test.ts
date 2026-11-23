import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { disconnectConnection, saveConnection } from "../src/analytics/connections";
import { sealedToken } from "../src/analytics/sync";
import { listActiveWebsiteSummaries, listWebsites, setWebsiteRemoved } from "../src/services/registry";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("removing a website (D82)", () => {
  it("archives the website so it leaves every active list, keeps it, and restores it", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      await applyContext(db, staffCtx(admin));
      await setWebsiteRemoved(db, { websiteId: clinic.websiteId, clientId: clinic.clientId, removed: true, actorUserId: admin.id });
      const site = (await listWebsites(db, clinic.clientId)).find((row) => row.id === clinic.websiteId)!;
      expect(site.status).toBe("archived");
      expect(site.archived_at).toBeInstanceOf(Date);
      expect((await listActiveWebsiteSummaries(db)).some((row) => row.id === clinic.websiteId)).toBe(false);
      const audit = await db.query("select action from audit_events where target_id = $1 and action like 'website.%' order by occurred_at", [clinic.websiteId]);
      expect(audit.rows.map((row) => row.action)).toContain("website.remove");

      await setWebsiteRemoved(db, { websiteId: clinic.websiteId, clientId: clinic.clientId, removed: false, actorUserId: admin.id });
      const restored = (await listWebsites(db, clinic.clientId)).find((row) => row.id === clinic.websiteId)!;
      expect(restored.status).toBe("active");
      expect(restored.archived_at).toBeNull();
      expect((await listActiveWebsiteSummaries(db)).some((row) => row.id === clinic.websiteId)).toBe(true);
    });
  });

  it("refuses while an analytics connection is active, and allows it once disconnected", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const token = sealedToken({ accessToken: "fixture", expiresAt: "2100-01-01T00:00:00.000Z" });
      const connection = await saveConnection(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, provider: "gsc", externalPropertyId: "sc-domain:removal.example.invalid", streamOrSiteRef: null, providerTimezone: "America/Los_Angeles", tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId: admin.id });
      await applyContext(db, staffCtx(admin));
      await expect(setWebsiteRemoved(db, { websiteId: clinic.websiteId, clientId: clinic.clientId, removed: true, actorUserId: admin.id })).rejects.toThrow(/analytics connection/);
      expect((await listWebsites(db, clinic.clientId)).find((row) => row.id === clinic.websiteId)!.status).toBe("active");
      await applyContext(db, SERVICE);
      await disconnectConnection(db, { connectionId: connection.id, actorUserId: admin.id });
      await applyContext(db, staffCtx(admin));
      await setWebsiteRemoved(db, { websiteId: clinic.websiteId, clientId: clinic.clientId, removed: true, actorUserId: admin.id });
      expect((await listWebsites(db, clinic.clientId)).find((row) => row.id === clinic.websiteId)!.status).toBe("archived");
    });
  });

  it("does not let a specialist remove a website, nor anyone remove it through another client", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specialist = await staffByEmail("specialist-a@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id, [specialist.id]);
      const other = await provisionClinic(db, admin.id);
      await applyContext(db, staffCtx(specialist));
      await expect(setWebsiteRemoved(db, { websiteId: clinic.websiteId, clientId: clinic.clientId, removed: true, actorUserId: specialist.id })).rejects.toThrow();
      await applyContext(db, staffCtx(admin));
      await expect(setWebsiteRemoved(db, { websiteId: clinic.websiteId, clientId: other.clientId, removed: true, actorUserId: admin.id })).rejects.toThrow();
      expect((await listWebsites(db, clinic.clientId)).find((row) => row.id === clinic.websiteId)!.status).toBe("active");
    });
  });
});
