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
