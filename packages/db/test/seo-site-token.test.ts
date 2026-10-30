import { afterAll, describe, expect, it } from "vitest";
import { adminPool, appPool, asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";
import { PermissionDeniedError } from "../src/services/auth";
import { getPublishedSeoConfiguration, hasActiveSeoSiteToken, issueSeoSiteToken } from "../src/services/seo-soft-launch";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

async function meridianProductionSite(): Promise<{ clientId: string; websiteId: string }> {
  const clientId = await clientBySlug("meridian-skin");
  const { rows } = await adminPool.query<{ id: string }>(
    "select id from websites where client_id = $1 and platform = 'Next.js on Vercel' and environment = 'production'",
    [clientId],
  );
  if (!rows[0]) throw new Error("Seed Meridian production website missing.");
  return { clientId, websiteId: rows[0].id };
}

describe("SEO website API tokens", () => {
  it("lets an admin create and rotate a token that the public API can read", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const { clientId, websiteId } = await meridianProductionSite();
    await asContext(staffCtx(admin), async (db) => {
      const first = await issueSeoSiteToken(db, clientId, websiteId, admin.id);
      const second = await issueSeoSiteToken(db, clientId, websiteId, admin.id);
      expect(first).not.toEqual(second);
      expect(await hasActiveSeoSiteToken(db, websiteId)).toBe(true);
      expect(await getPublishedSeoConfiguration(db, websiteId, second)).not.toBeNull();
      expect(await getPublishedSeoConfiguration(db, websiteId, first)).toBeNull();
    });
  });

  it("lets a manager create a token", async () => {
    const manager = await staffByEmail("manager@example.invalid");
    const { clientId, websiteId } = await meridianProductionSite();
    const token = await asContext(staffCtx(manager), (db) => issueSeoSiteToken(db, clientId, websiteId, manager.id));
    expect(token.length).toBeGreaterThan(20);
  });

  it("refuses a specialist, reviewer and read-only user", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const reviewer = await staffByEmail("reviewer@example.invalid");
    const readonly = await staffByEmail("readonly@example.invalid");
    const { clientId, websiteId } = await meridianProductionSite();
    await expect(asContext(staffCtx(specA), (db) => issueSeoSiteToken(db, clientId, websiteId, specA.id))).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(asContext(staffCtx(reviewer), (db) => issueSeoSiteToken(db, clientId, websiteId, reviewer.id))).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(asContext(staffCtx(readonly), (db) => issueSeoSiteToken(db, clientId, websiteId, readonly.id))).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("blocks a specialist raw insert even for a client they can edit", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const { clientId, websiteId } = await meridianProductionSite();
    await expect(
      asContext(staffCtx(specA), (db) =>
        db.query("insert into seo_site_tokens (client_id, website_id, token_hash, created_by) values ($1, $2, $3, $4)", [
          clientId,
          websiteId,
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          specA.id,
        ]),
      ),
    ).rejects.toThrow();
  });
});
