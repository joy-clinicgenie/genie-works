import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionAnalyticsWebsite, provisionClinic } from "./provision";
import { AnalyticsRuleError, createOAuthState, saveConnection } from "../src/analytics/connections";
import { enqueueDue, sealedToken } from "../src/analytics/sync";
import { ANALYTICS_CLIENT_SLUGS, analyticsProviderAllowed, isAnalyticsClient } from "../src/analytics/scope";
import { PermissionDeniedError } from "../src/services/auth";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const redirectUri = "http://127.0.0.1:3400/api/analytics/google/callback";

async function connect(db: Parameters<typeof saveConnection>[0], input: { clientId: string; websiteId: string; provider: "ga4" | "gsc"; property: string; actorUserId: string }) {
  const token = sealedToken({ accessToken: input.property, expiresAt: "2100-01-01T00:00:00.000Z" });
  return saveConnection(db, {
    clientId: input.clientId, websiteId: input.websiteId, provider: input.provider, externalPropertyId: input.property, streamOrSiteRef: null,
    providerTimezone: input.provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore",
    tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId: input.actorUserId,
  });
}

describe("website analytics is limited to Clinic Genie (D61)", () => {
  it("names Clinic Genie as the only analytics client", () => {
    expect(ANALYTICS_CLIENT_SLUGS).toEqual(["clinic-genie"]);
    expect(isAnalyticsClient({ slug: "clinic-genie" })).toBe(true);
    expect(isAnalyticsClient({ slug: "meridian-skin" })).toBe(false);
  });

  it("lets GA4 start only for Clinic Genie and keeps Search Console open to every client", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const other = await provisionClinic(db, admin.id);
      const genie = await provisionAnalyticsWebsite(db, admin.id);

      expect(await analyticsProviderAllowed(db, other.clientId, "ga4")).toBe(false);
      expect(await analyticsProviderAllowed(db, other.clientId, "gsc")).toBe(true);
      expect(await analyticsProviderAllowed(db, genie.clientId, "ga4")).toBe(true);

      const refused = createOAuthState(db, { actorUserId: admin.id, clientId: other.clientId, websiteId: other.websiteId, provider: "ga4", redirectUri });
      await expect(refused).rejects.toBeInstanceOf(AnalyticsRuleError);
      await expect(refused).rejects.toThrow("analytics_scope");

      const search = await createOAuthState(db, { actorUserId: admin.id, clientId: other.clientId, websiteId: other.websiteId, provider: "gsc", redirectUri });
      expect(search.state).toBeTruthy();
      const ga4 = await createOAuthState(db, { actorUserId: admin.id, clientId: genie.clientId, websiteId: genie.websiteId, provider: "ga4", redirectUri });
      expect(ga4.state).toBeTruthy();
    });
  });

  it("still refuses a non-administrator before the scope is considered", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const manager = await staffByEmail("manager@example.invalid");
    await asContext(SERVICE, async (db) => {
      const genie = await provisionAnalyticsWebsite(db, admin.id);
      await expect(createOAuthState(db, { actorUserId: manager.id, clientId: genie.clientId, websiteId: genie.websiteId, provider: "ga4", redirectUri }))
        .rejects.toBeInstanceOf(PermissionDeniedError);
    });
  });

  it("queues GA4 only for Clinic Genie, and Search Console for every client", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
      const other = await provisionClinic(db, admin.id);
      const genie = await provisionAnalyticsWebsite(db, admin.id);
      // A GA4 connection left over from before D61 on another client.
      const otherGa4 = await connect(db, { clientId: other.clientId, websiteId: other.websiteId, provider: "ga4", property: "7101", actorUserId: admin.id });
      const otherGsc = await connect(db, { clientId: other.clientId, websiteId: other.websiteId, provider: "gsc", property: "sc-domain:other.example.invalid", actorUserId: admin.id });
      const genieGa4 = await connect(db, { clientId: genie.clientId, websiteId: genie.websiteId, provider: "ga4", property: "7102", actorUserId: admin.id });

      const now = new Date("2026-11-17T04:00:00.000Z");
      await enqueueDue(db, now, other.websiteId);
      await enqueueDue(db, now, genie.websiteId);
      const queued = await db.query<{ connection_id: string; count: number }>(
        "select connection_id, count(*)::int as count from analytics_jobs where connection_id = any($1::uuid[]) and state = 'queued' group by connection_id",
        [[otherGa4.id, otherGsc.id, genieGa4.id]],
      );
      const byConnection = new Map(queued.rows.map((row) => [row.connection_id, row.count]));
      expect(byConnection.get(otherGa4.id) ?? 0).toBe(0);
      expect(byConnection.get(otherGsc.id) ?? 0).toBeGreaterThan(0);
      expect(byConnection.get(genieGa4.id) ?? 0).toBeGreaterThan(0);
    });
  });

  it("keeps another client's connections hidden from a specialist without membership", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specialistB = await staffByEmail("specialist-b@example.invalid");
    await asContext(SERVICE, async (db) => {
      const genie = await provisionAnalyticsWebsite(db, admin.id);
      await connect(db, { clientId: genie.clientId, websiteId: genie.websiteId, provider: "ga4", property: "7103", actorUserId: admin.id });
      await applyContext(db, staffCtx(specialistB));
      const visible = await db.query("select id from analytics_connections where client_id = $1", [genie.clientId]);
      expect(visible.rows).toEqual([]);
    });
  });
});
