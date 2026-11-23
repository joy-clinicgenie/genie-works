import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { disconnectConnection, saveConnection } from "../src/analytics/connections";
import { sealedToken } from "../src/analytics/sync";
import { deleteClient, getClient, listClients, listWebsites } from "../src/services/registry";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("deleting a client (D84)", () => {
  it("hides the client and its records from every staff role, keeps the history, and removes its websites", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const manager = await staffByEmail("manager@example.invalid");
    const specialist = await staffByEmail("specialist-a@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id, [specialist.id]);
      await applyContext(db, staffCtx(admin));
      await deleteClient(db, { clientId: clinic.clientId, confirmName: " Check clinic ", actorUserId: admin.id });

      for (const who of [admin, manager, specialist]) {
        await applyContext(db, staffCtx(who));
        expect(await getClient(db, clinic.clientId)).toBeNull();
        expect((await listClients(db, { status: "all" })).some((row) => row.id === clinic.clientId)).toBe(false);
        expect(await listWebsites(db, clinic.clientId)).toEqual([]);
        // The audit trail stays readable in the admin audit log, and only there.
        const audit = (await db.query("select 1 from audit_events where client_id = $1", [clinic.clientId])).rowCount;
        if (who === admin) expect(audit).toBeGreaterThan(0);
        else expect(audit).toBe(0);
      }
      // Nothing can be written to it either.
      await applyContext(db, staffCtx(specialist));
      expect((await db.query("update websites set name = 'x' where client_id = $1", [clinic.clientId])).rowCount).toBe(0);

      await applyContext(db, SERVICE);
      const row = (await db.query("select status, deleted_at, deleted_by from clients where id = $1", [clinic.clientId])).rows[0];
      expect(row.status).toBe("deleted");
      expect(row.deleted_at).toBeInstanceOf(Date);
      expect(row.deleted_by).toBe(admin.id);
      const sites = await db.query("select status from websites where client_id = $1", [clinic.clientId]);
      expect(sites.rows.every((site) => site.status === "archived")).toBe(true);
      const audit = await db.query("select actor_user_id from audit_events where client_id = $1 and action = 'client.delete'", [clinic.clientId]);
      expect(audit.rows).toEqual([{ actor_user_id: admin.id }]);
    });
  });

  it("refuses a name that does not match exactly, and leaves the client as it was", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      await applyContext(db, staffCtx(admin));
      await expect(deleteClient(db, { clientId: clinic.clientId, confirmName: "check clinic", actorUserId: admin.id })).rejects.toMatchObject({ field: "confirmName" });
      expect((await getClient(db, clinic.clientId))?.status).toBe("active");
    });
  });

  it("refuses managers, specialists and read-only staff, and another client's id cannot be reached", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specialist = await staffByEmail("specialist-a@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id, [specialist.id]);
      for (const email of ["manager@example.invalid", "specialist-a@example.invalid", "readonly@example.invalid"]) {
        const who = await staffByEmail(email);
        await applyContext(db, staffCtx(who));
        await expect(deleteClient(db, { clientId: clinic.clientId, confirmName: "Check clinic", actorUserId: who.id })).rejects.toThrow(/administrator/);
      }
      await applyContext(db, staffCtx(admin));
      expect((await getClient(db, clinic.clientId))?.status).toBe("active");
      await expect(deleteClient(db, { clientId: "00000000-0000-4000-8000-000000000000", confirmName: "Check clinic", actorUserId: admin.id })).rejects.toThrow(/not available/);
    });
  });

  it("refuses while an analytics connection is active, and allows it once disconnected", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const token = sealedToken({ accessToken: "fixture", expiresAt: "2100-01-01T00:00:00.000Z" });
      const connection = await saveConnection(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, provider: "gsc", externalPropertyId: "sc-domain:deletion.example.invalid", streamOrSiteRef: null, providerTimezone: "America/Los_Angeles", tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId: admin.id });
      await applyContext(db, staffCtx(admin));
      await expect(deleteClient(db, { clientId: clinic.clientId, confirmName: "Check clinic", actorUserId: admin.id })).rejects.toThrow(/analytics connection/);
      expect((await getClient(db, clinic.clientId))?.status).toBe("active");
      await applyContext(db, SERVICE);
      await disconnectConnection(db, { connectionId: connection.id, actorUserId: admin.id });
      await applyContext(db, staffCtx(admin));
      await deleteClient(db, { clientId: clinic.clientId, confirmName: "Check clinic", actorUserId: admin.id });
      expect(await getClient(db, clinic.clientId)).toBeNull();
    });
  });
});
