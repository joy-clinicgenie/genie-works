import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { disconnectConnection, saveConnection } from "../src/analytics/connections";
import { queryHash } from "../src/analytics/measure";
import { sealedToken } from "../src/analytics/sync";
import { agencySessionSummary } from "../src/analytics/agency-sessions";
import { createClient, createWebsite, grantMembership } from "../src/services/registry";
import { createSavedReport, dashboardReportAttention } from "../src/services/saved-reports";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const window = { start: "2026-10-01", end: "2026-10-02", previousStart: "2026-09-29", previousEnd: "2026-09-30" };
const now = new Date("2026-10-03T12:00:00.000Z");
const staleAt = new Date("2026-10-01T00:00:00.000Z");

describe("agency command centre aggregates", () => {
  it("sums complete sessions, keeps a real zero, and leaves another website's gap out of the total", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    await asContext(SERVICE, async (db) => {
      const slug = `d${randomBytes(4).toString("hex")}`;
      const client = await createClient(db, {
        slug, name: "Dashboard Test Clinic (fictional)", ownerUserId: admin.id, channels: ["website"], isSynthetic: true, notes: null,
      }, admin.id);
      const bare = await createClient(db, {
        slug: `e${randomBytes(4).toString("hex")}`, name: "Dashboard Bare Clinic (fictional)", ownerUserId: admin.id, channels: ["website"], isSynthetic: true, notes: null,
      }, admin.id);
      const complete = await createWebsite(db, { clientId: client.id, name: "Complete site", url: "https://complete.example.invalid", platform: "Wix", environment: "production", notes: null }, admin.id);
      const incomplete = await createWebsite(db, { clientId: client.id, name: "Incomplete site", url: "https://incomplete.example.invalid", platform: "Wix", environment: "production", notes: null }, admin.id);
      const unconnected = await createWebsite(db, { clientId: client.id, name: "Unconnected site", url: "https://unconnected.example.invalid", platform: "Wix", environment: "production", notes: null }, admin.id);
      const conflict = await createWebsite(db, { clientId: client.id, name: "Conflict site", url: "https://conflict.example.invalid", platform: "Wix", environment: "production", notes: null }, admin.id);
      const disconnected = await createWebsite(db, { clientId: client.id, name: "Disconnected site", url: "https://disconnected.example.invalid", platform: "Wix", environment: "production", notes: null }, admin.id);
      await createWebsite(db, { clientId: bare.id, name: "Bare site", url: "https://bare.example.invalid", platform: "Wix", environment: "production", notes: null }, admin.id);
      void unconnected;

      const completeConnection = await connect(db, client.id, complete.id, "ga4", "prop-complete", admin.id);
      const incompleteConnection = await connect(db, client.id, incomplete.id, "ga4", "prop-incomplete", admin.id);
      await connect(db, client.id, conflict.id, "ga4", "prop-conflict-ga4", admin.id);
      await connect(db, client.id, conflict.id, "wix", "prop-conflict-wix", admin.id);
      const dropped = await connect(db, client.id, disconnected.id, "ga4", "prop-disconnected", admin.id);
      await disconnectConnection(db, { connectionId: dropped.id, actorUserId: admin.id });
      await seedDays(db, {
        connectionId: completeConnection.id, clientId: client.id, websiteId: complete.id, provider: "ga4", fetchedAt: staleAt,
        days: [
          { date: "2026-09-29", sessions: 2 },
          { date: "2026-09-30", sessions: 2 },
          { date: "2026-10-01", sessions: 0 },
          { date: "2026-10-02", sessions: 8 },
        ],
      });
      await seedDays(db, {
        connectionId: incompleteConnection.id, clientId: client.id, websiteId: incomplete.id, provider: "ga4", fetchedAt: now,
        days: [{ date: "2026-10-02", sessions: 100 }],
      });

      const older = await draft(db, client.id, admin.id, "Older draft");
      const newer = await draft(db, client.id, admin.id, "Newer draft");
      await draft(db, client.id, admin.id, "Finished report", false);
      await db.query("update saved_reports set updated_at = $2 where id = $1", [older, "2026-10-01T00:00:00.000Z"]);
      await db.query("update saved_reports set updated_at = $2 where id = $1", [newer, "2026-10-20T00:00:00.000Z"]);
      await grantMembership(db, { userId: specA.id, clientId: client.id }, admin.id);

      await applyContext(db, staffCtx(admin));
      const summary = await agencySessionSummary(db, { clientId: client.id, ...window, now });
      expect(summary.total).toBe(8);
      expect(summary.previous).toBe(4);
      expect(summary.state).toBe("partial");
      expect(summary.series?.map((point) => point.value)).toEqual([0, 8]);
      expect(summary.top.map((site) => site.sessions)).toEqual([8]);
      expect(summary.top.map((site) => site.websiteName)).toEqual(["Complete site"]);
      expect(summary.unconnectedCount).toBe(1);
      expect(summary.notices.map((notice) => notice.kind).sort()).toEqual(["conflict", "disconnected", "not_synchronised", "stale"]);
      expect(summary.notices.some((notice) => notice.kind === "not_connected")).toBe(false);
      const reports = await dashboardReportAttention(db, client.id);
      expect(reports.draftCount).toBe(2);
      expect(reports.latest?.name).toBe("Newer draft");
      expect(reports.latest?.id).toBe(newer);

      await applyContext(db, staffCtx(specA));
      expect((await agencySessionSummary(db, { clientId: client.id, ...window, now })).total).toBe(8);
      expect((await dashboardReportAttention(db, client.id)).latest?.name).toBe("Newer draft");

      await applyContext(db, staffCtx(specB));
      const hiddenSessions = await agencySessionSummary(db, { clientId: client.id, ...window, now });
      expect(hiddenSessions.total).toBeNull();
      expect(hiddenSessions.websiteCount).toBe(0);
      expect(hiddenSessions.top).toEqual([]);
      expect(await dashboardReportAttention(db, client.id)).toEqual({ draftCount: 0, latest: null });

      await applyContext(db, SERVICE);
      await db.query("update analytics_metric_values set value_numeric = 0 where website_id = $1", [complete.id]);
      await applyContext(db, staffCtx(admin));
      const zero = await agencySessionSummary(db, { clientId: client.id, ...window, now });
      expect(zero.total).toBe(0);
      expect(zero.state).toBe("partial");
      const bareSummary = await agencySessionSummary(db, { clientId: bare.id, ...window, now });
      expect(bareSummary.state).toBe("not_connected");
      expect(bareSummary.total).toBeNull();
      expect(bareSummary.notices.map((notice) => notice.message)).toEqual(["Website analytics is not connected."]);
    });
  });

  it("leaves GA4 and Wix sessions uncombined when both are connected", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const client = await createClient(db, {
        slug: `f${randomBytes(4).toString("hex")}`, name: "Separate Sources Clinic (fictional)", ownerUserId: admin.id, channels: ["website"], isSynthetic: true, notes: null,
      }, admin.id);
      const site = await createWebsite(db, { clientId: client.id, name: "Two sources", url: "https://two-sources.example.invalid", platform: "Wix", environment: "production", notes: null }, admin.id);
      const ga4 = await connect(db, client.id, site.id, "ga4", "prop-separate-ga4", admin.id);
      const wix = await connect(db, client.id, site.id, "wix", "prop-separate-wix", admin.id);
      const days = [{ date: "2026-10-01", sessions: 10 }, { date: "2026-10-02", sessions: 10 }];
      await seedDays(db, { connectionId: ga4.id, clientId: client.id, websiteId: site.id, provider: "ga4", fetchedAt: now, days });
      await seedDays(db, { connectionId: wix.id, clientId: client.id, websiteId: site.id, provider: "wix", fetchedAt: now, days: days.map((day) => ({ date: day.date, sessions: 40 })) });
      await applyContext(db, staffCtx(admin));
      const summary = await agencySessionSummary(db, { clientId: client.id, ...window, now });
      expect(summary.total).toBeNull();
      expect(summary.state).toBe("unavailable");
      expect(summary.notices.map((notice) => notice.kind)).toEqual(["conflict"]);
    });
  });
});

async function connect(db: pg.PoolClient, clientId: string, websiteId: string, provider: "ga4" | "wix", property: string, actorUserId: string) {
  const token = sealedToken({ accessToken: property, expiresAt: "2100-01-01T00:00:00.000Z" });
  return saveConnection(db, {
    clientId, websiteId, provider, externalPropertyId: property, streamOrSiteRef: null,
    providerTimezone: "Asia/Singapore", tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId,
  });
}

async function seedDays(db: pg.PoolClient, input: {
  connectionId: string;
  clientId: string;
  websiteId: string;
  provider: "ga4" | "wix";
  fetchedAt: Date;
  days: Array<{ date: string; sessions: number }>;
}) {
  const template = input.provider === "ga4" ? "ga4.traffic_daily" : "wix.data_daily";
  const metric = input.provider === "ga4" ? "sessions" : "total_sessions";
  const start = input.days[0]!.date;
  const end = input.days[input.days.length - 1]!.date;
  const hash = queryHash(template, 1, { websiteId: input.websiteId, start, end });
  const partition = await db.query<{ id: string }>(
    `insert into analytics_report_partitions
      (client_id, website_id, connection_id, template_key, query_hash, start_date, end_date, source_timezone, provenance, completeness, generation, published, fetched_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'Asia/Singapore', 'api', 'complete', 1, true, $8)
     returning id`,
    [input.clientId, input.websiteId, input.connectionId, template, hash, start, end, input.fetchedAt.toISOString()],
  );
  for (const day of input.days) {
    const row = await db.query<{ id: string }>(
      "insert into analytics_report_rows (partition_id, client_id, website_id, dimension_key) values ($1, $2, $3, $4) returning id",
      [partition.rows[0]!.id, input.clientId, input.websiteId, day.date],
    );
    await db.query(
      "insert into analytics_metric_values (report_row_id, client_id, website_id, metric_key, value_numeric, value_state) values ($1, $2, $3, $4, $5, 'available')",
      [row.rows[0]!.id, input.clientId, input.websiteId, metric, day.sessions],
    );
    await db.query(
      `insert into analytics_coverage
        (client_id, website_id, connection_id, template_key, source_date, state, tracking_active, fetched_at, measured_through)
       values ($1, $2, $3, $4, $5, 'complete', true, $6, $5)`,
      [input.clientId, input.websiteId, input.connectionId, template, day.date, input.fetchedAt.toISOString()],
    );
  }
}

async function draft(db: pg.PoolClient, clientId: string, actorUserId: string, name: string, isDraft = true) {
  return createSavedReport(db, {
    clientId,
    name,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    comparisonStart: null,
    comparisonEnd: null,
    sections: ["traffic"],
    summary: null,
    observations: null,
    actionsTaken: null,
    nextSteps: null,
    dataSourcesNote: null,
    missingConnections: null,
    measurementLimitations: null,
  }, actorUserId, { draft: isDraft });
}
