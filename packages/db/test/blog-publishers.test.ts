import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyContext } from "../src/client";
import { runMigrations } from "../src/migrate";
import { seedDemo } from "../src/seed";
import { canShipWebsite } from "../src/services/blog";
import { grantWebsitePublisher, listEligiblePublishers, listPublishingAdmins, listWebsitePublishers, revokeWebsitePublisher } from "../src/services/blog-publishing";
import { createIsolatedDatabase, staffContext, type IsolatedDatabase } from "./isolated";
import { provisionClinic } from "./provision";

/** D87: administrator management of website publishing grants, on an isolated database. */

type Staff = { id: string; platform_role: "admin" | "manager" | "specialist" | "reviewer" | "read_only" };
let db: IsolatedDatabase;
let admin: Staff, manager: Staff, specA: Staff, specB: Staff, reviewer: Staff, readonly: Staff;

beforeAll(async () => {
  db = await createIsolatedDatabase("publishers");
  await runMigrations(db.admin);
  await seedDemo(db.admin);
  [admin, manager, specA, specB, reviewer, readonly] = (await Promise.all(
    ["admin", "manager", "specialist-a", "specialist-b", "reviewer", "readonly"].map((name) => db.staff(`${name}@example.invalid`)),
  )) as [Staff, Staff, Staff, Staff, Staff, Staff];
}, 180_000);
afterAll(async () => { await db?.drop(); });

describe("website publishing grants (D87)", () => {
  it("grants only eligible staff, never duplicates, keeps revoked records and re-grants as a new record", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const clinic = await provisionClinic(tx, admin.id, [specA.id, reviewer.id, readonly.id]);
      const siteA = clinic.websiteId;
      const siteB = clinic.stagingId;
      const connectionsBefore = (await tx.query<{ n: number }>("select (select count(*) from website_blog_publishing)::int + (select count(*) from analytics_connections)::int as n")).rows[0]!.n;

      const eligible = (await listEligiblePublishers(tx, siteA)).map((person) => person.id);
      expect(eligible).toEqual(expect.arrayContaining([manager.id, specA.id]));
      for (const excluded of [admin.id, specB.id, reviewer.id, readonly.id]) expect(eligible).not.toContain(excluded);
      expect((await listPublishingAdmins(tx)).map((person) => person.id)).toContain(admin.id);

      for (const [person, message] of [[admin, /already release/], [reviewer, /managers and specialists/], [readonly, /managers and specialists/], [specB, /not assigned to the client/]] as const) {
        await tx.query("savepoint refuse");
        await expect(grantWebsitePublisher(tx, { websiteId: siteA, userId: person.id }, admin.id)).rejects.toThrow(message);
        await tx.query("rollback to savepoint refuse");
      }

      const first = await grantWebsitePublisher(tx, { websiteId: siteA, userId: manager.id }, admin.id);
      const repeat = await grantWebsitePublisher(tx, { websiteId: siteA, userId: manager.id }, admin.id);
      expect(first.created).toBe(true);
      expect(repeat).toEqual({ id: first.id, created: false });
      let listed = await listWebsitePublishers(tx, siteA);
      expect(listed.active.map((row) => row.user_id)).toEqual([manager.id]);
      expect(await listEligiblePublishers(tx, siteA)).not.toContainEqual(expect.objectContaining({ id: manager.id }));
      // A grant applies to the selected website only.
      expect((await listWebsitePublishers(tx, siteB)).active).toEqual([]);
      await applyContext(tx, staffContext(manager));
      expect(await canShipWebsite(tx, siteA)).toBe(true);
      expect(await canShipWebsite(tx, siteB)).toBe(false);

      await applyContext(tx, staffContext(admin));
      expect(await revokeWebsitePublisher(tx, { websiteId: siteA, userId: manager.id }, admin.id)).toBe(true);
      expect(await revokeWebsitePublisher(tx, { websiteId: siteA, userId: manager.id }, admin.id)).toBe(false);
      await applyContext(tx, staffContext(manager));
      expect(await canShipWebsite(tx, siteA)).toBe(false);

      await applyContext(tx, staffContext(admin));
      const again = await grantWebsitePublisher(tx, { websiteId: siteA, userId: manager.id }, admin.id);
      expect(again.created).toBe(true);
      expect(again.id).not.toBe(first.id);
      listed = await listWebsitePublishers(tx, siteA);
      expect(listed.active.map((row) => row.id)).toEqual([again.id]);
      expect(listed.revoked.map((row) => [row.id, row.revoked_by_name !== null])).toEqual([[first.id, true]]);

      // Granting staff access never marks a website connection as set up, tested or connected.
      const connectionsAfter = (await tx.query<{ n: number }>("select (select count(*) from website_blog_publishing)::int + (select count(*) from analytics_connections)::int as n")).rows[0]!.n;
      expect(connectionsAfter).toBe(connectionsBefore);
    });
  });

  it("refuses grant changes from anyone but an administrator session, in the service and the database", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const clinic = await provisionClinic(tx, admin.id, [specA.id]);
      await grantWebsitePublisher(tx, { websiteId: clinic.websiteId, userId: specA.id }, admin.id);
      for (const person of [manager, specA, reviewer]) {
        await applyContext(tx, staffContext(person));
        await tx.query("savepoint attempt");
        await expect(grantWebsitePublisher(tx, { websiteId: clinic.websiteId, userId: manager.id }, person.id)).rejects.toThrow(/Only an administrator/);
        await expect(revokeWebsitePublisher(tx, { websiteId: clinic.websiteId, userId: specA.id }, person.id)).rejects.toThrow(/Only an administrator/);
        // Claiming to be the admin does not help: the signed-in session is what counts.
        await expect(grantWebsitePublisher(tx, { websiteId: clinic.websiteId, userId: manager.id }, admin.id)).rejects.toThrow(/Only an administrator/);
        await tx.query("rollback to savepoint attempt");
        await tx.query("savepoint direct");
        await expect(tx.query("insert into website_publishers (website_id, client_id, user_id, granted_by) values ($1, $2, $3, $4)",
          [clinic.websiteId, clinic.clientId, manager.id, admin.id])).rejects.toThrow(/row-level security/);
        await tx.query("rollback to savepoint direct");
        const updated = await tx.query("update website_publishers set revoked_at = now(), revoked_by = $2 where website_id = $1", [clinic.websiteId, person.id]);
        expect(updated.rowCount).toBe(0);
      }
      await applyContext(tx, staffContext(admin));
      expect((await listWebsitePublishers(tx, clinic.websiteId)).active.map((row) => row.user_id)).toEqual([specA.id]);
    });
  });

  it("two simultaneous grants of the same person leave one active grant", async () => {
    const clinic = await db.asContext(staffContext(admin), (tx) => provisionClinic(tx, admin.id, []), { commit: true });
    const grant = () => db.asContext(staffContext(admin), (tx) => grantWebsitePublisher(tx, { websiteId: clinic.websiteId, userId: manager.id }, admin.id), { commit: true });
    const results = await Promise.all([grant(), grant(), grant()]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    const { rows } = await db.admin.query("select count(*)::int as n from website_publishers where website_id = $1 and revoked_at is null", [clinic.websiteId]);
    expect(rows[0].n).toBe(1);
  });
});
