import { afterAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { saveSeoBusinessProfile } from "../src/services/seo-soft-launch";
import { branchMapping, getBranch, listBranchReviews, listBranches, recordBranchReview } from "../src/services/business-profiles";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

async function addBranch(db: pg.PoolClient, clientId: string, actorId: string, input: { name: string; url?: string; location?: string; phone?: string }) {
  await saveSeoBusinessProfile(db, clientId, {
    branchName: input.name, profileUrl: input.url ?? null, externalIdentifier: input.location ?? null, setupStatus: "in_progress", notes: null,
    address: "1 Fixture Road, Singapore 000001", phone: input.phone ?? "+65 6000 0001", openingHours: "Mon–Fri 09:00–17:00",
  }, actorId);
  return (await listBranches(db, clientId)).find((branch) => branch.branch_name === input.name)!;
}

describe("Google Business Profile branch list (SEO-06.1)", () => {
  it("shows a location mapping, a public link mapping and an unmapped branch, each opening its own branch", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    await asContext(staffCtx(admin), async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const a = await addBranch(db, clinic.clientId, admin.id, { name: "Branch A", location: "locations/1234567890" });
      const b = await addBranch(db, clinic.clientId, admin.id, { name: "Branch B", url: "https://maps.app.goo.gl/fixtureB" });
      const c = await addBranch(db, clinic.clientId, admin.id, { name: "Branch C" });
      const rows = await listBranches(db, clinic.clientId);
      expect(rows.map((row) => [row.branch_name, row.mapping])).toEqual([["Branch A", "location"], ["Branch B", "public_link"], ["Branch C", "unmapped"]]);
      for (const branch of [a, b, c]) expect((await getBranch(db, clinic.clientId, branch.id))?.branch_name).toBe(branch.branch_name);

      // A location ID must be in the documented form; a legacy value is not a mapping.
      await expect(saveSeoBusinessProfile(db, clinic.clientId, { branchName: "Branch D", profileUrl: null, externalIdentifier: "ChIJplaceid", setupStatus: "not_started", notes: null }, admin.id)).rejects.toThrow(/locations\//);
      expect(branchMapping({ external_identifier: "legacy-id", profile_url: null })).toBe("unmapped");

      // Another organisation's id or staff get nothing.
      const other = await provisionClinic(db, admin.id);
      expect(await getBranch(db, other.clientId, a.id)).toBeNull();
      await applyContext(db, staffCtx(specB));
      expect(await listBranches(db, clinic.clientId)).toEqual([]);
      expect(await getBranch(db, clinic.clientId, a.id)).toBeNull();
    });
  });
});

describe("Branch profile details and reviews (SEO-06.2)", () => {
  it("keeps a phone mismatch with its reviewer and date for that branch only", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id, [specA.id]);
      await applyContext(db, staffCtx(admin));
      const a = await addBranch(db, clinic.clientId, admin.id, { name: "Branch A", url: "https://maps.app.goo.gl/fixtureA", phone: "+65 6000 0001" });
      const b = await addBranch(db, clinic.clientId, admin.id, { name: "Branch B", url: "https://maps.app.goo.gl/fixtureB" });

      await applyContext(db, staffCtx(specA));
      await recordBranchReview(db, {
        clientId: clinic.clientId, branchId: a.id, reviewedOn: "2026-11-20", fieldsReviewed: ["name", "phone"],
        discrepancies: [{ field: "phone", observed: "+65 6000 9999", note: "Listing shows an old number" }], actorUserId: specA.id,
      });
      const reviews = await listBranchReviews(db, clinic.clientId, a.id);
      expect(reviews).toHaveLength(1);
      expect(reviews[0]).toMatchObject({
        method: "public_link", reviewedOn: "2026-11-20", fieldsReviewed: ["name", "phone"], reviewedBy: specA.id, reviewedByName: "Demo Specialist A",
        discrepancies: [{ field: "phone", saved: "+65 6000 0001", observed: "+65 6000 9999", note: "Listing shows an old number" }],
      });
      expect(await listBranchReviews(db, clinic.clientId, b.id)).toEqual([]);
      expect((await listBranches(db, clinic.clientId)).find((row) => row.id === a.id)?.lastReview).toEqual({ reviewedOn: "2026-11-20", reviewedByName: "Demo Specialist A", discrepancyCount: 1 });

      // A discrepancy must be for a reviewed field, and reviews cannot be edited afterwards.
      await expect(recordBranchReview(db, { clientId: clinic.clientId, branchId: b.id, reviewedOn: "2026-11-20", fieldsReviewed: ["name"], discrepancies: [{ field: "phone", observed: "x" }], actorUserId: specA.id })).rejects.toThrow(/field you reviewed/);
      await expect(db.query("update seo_branch_reviews set reviewed_on = '2026-01-01' where branch_id = $1", [a.id])).rejects.toThrow(/permission denied/);
    });
  });

  it("refuses a review for another organisation's branch and from a staff member without edit access", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    await asContext(staffCtx(admin), async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const other = await provisionClinic(db, admin.id);
      const a = await addBranch(db, clinic.clientId, admin.id, { name: "Branch A", url: "https://maps.app.goo.gl/fixtureA" });
      await expect(recordBranchReview(db, { clientId: other.clientId, branchId: a.id, reviewedOn: "2026-11-20", fieldsReviewed: ["phone"], discrepancies: [], actorUserId: admin.id })).rejects.toThrow(/not part of this organisation/);
      await applyContext(db, staffCtx(specB));
      await expect(db.query(
        `insert into seo_branch_reviews (client_id, branch_id, method, reviewed_on, fields_reviewed, reviewed_by) values ($1, $2, 'public_link', '2026-11-20', array['phone'], $3)`,
        [clinic.clientId, a.id, specB.id],
      )).rejects.toThrow(/row-level security/);
    });
  });
});
