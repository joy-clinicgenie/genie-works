import { randomBytes } from "node:crypto";
import type { Queryable } from "../src/client";
import { createClient, createWebsite, grantMembership } from "../src/services/registry";

/** A rolled-back clinic with two websites. It is not part of the seed. */
export async function provisionClinic(db: Queryable, actorId: string, memberIds: string[] = []): Promise<{ clientId: string; websiteId: string; stagingId: string }> {
  const suffix = randomBytes(4).toString("hex");
  const client = await createClient(db, {
    slug: `check-${suffix}`,
    name: "Check clinic",
    ownerUserId: actorId,
    channels: ["website"],
    isSynthetic: true,
    notes: null,
  }, actorId);
  for (const userId of memberIds) {
    await grantMembership(db, { userId, clientId: client.id }, actorId);
  }
  const website = await createWebsite(db, {
    clientId: client.id,
    name: "Check website",
    url: "https://check.example.invalid",
    platform: "Next.js on Vercel",
    environment: "production",
    notes: null,
  }, actorId);
  const staging = await createWebsite(db, {
    clientId: client.id,
    name: "Check staging",
    url: "https://staging.check.example.invalid",
    platform: "Next.js on Vercel",
    environment: "staging",
    notes: null,
  }, actorId);
  return { clientId: client.id, websiteId: website.id, stagingId: staging.id };
}

/** A rolled-back website on the seeded Clinic Genie client, the only website analytics client (D61). */
export async function provisionAnalyticsWebsite(db: Queryable, actorId: string): Promise<{ clientId: string; websiteId: string }> {
  const { rows } = await db.query<{ id: string }>("select id from clients where slug = 'clinic-genie'");
  const clientId = rows[0]?.id;
  if (!clientId) throw new Error("Seed client clinic-genie missing. Run npm run db:seed.");
  const website = await createWebsite(db, {
    clientId,
    name: `Analytics check ${randomBytes(3).toString("hex")}`,
    url: "https://analytics-check.example.invalid",
    platform: "Next.js on Vercel",
    environment: "production",
    notes: null,
  }, actorId);
  return { clientId, websiteId: website.id };
}

/**
 * A fresh, empty analytics client for tests that count every website of the client. Inside the
 * caller's rolled-back transaction the seeded Clinic Genie record is renamed out of the way and a
 * new client takes the clinic-genie slug, so leftover rows from other runs cannot change the counts.
 */
export async function provisionEmptyAnalyticsClient(db: Queryable, actorId: string): Promise<{ id: string }> {
  const suffix = randomBytes(4).toString("hex");
  await db.query("update clients set slug = $1 where slug = 'clinic-genie'", [`held-${suffix}`]);
  const client = await createClient(db, {
    slug: "clinic-genie",
    name: "Analytics Test Client (fictional)",
    ownerUserId: actorId,
    channels: ["website"],
    isSynthetic: true,
    notes: null,
  }, actorId);
  return { id: client.id };
}
