import { describe, expect, it, vi } from "vitest";
import { loadLiveBundle } from "./live-analytics";
import type { SiteView } from "./site-view";

describe("live analytics query planning", () => {
  it("derives Wix period totals from the same available days the chart shows, without duplicate reads", async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("from analytics_connections")) {
        return {
          rows: [{
            id: "connection-1",
            client_id: "client-1",
            website_id: "website-1",
            provider: "wix",
            external_property_id: "site-1",
            stream_or_site_ref: null,
            status: "connected",
            provider_timezone: "Asia/Singapore",
            verified_at: new Date("2026-11-01T00:00:00.000Z"),
            version: 1,
            disconnected_at: null,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("from analytics_coverage")) {
        const start = params?.[4];
        const dates = start === "2026-11-01"
          ? ["2026-11-01", "2026-11-02"]
          : ["2026-10-30", "2026-10-31"];
        return {
          rows: dates.map((source_date, index) => ({
            source_date,
            state: "complete",
            value_numeric: start === "2026-11-01" ? index + 4 : index + 2,
            value_state: start === "2026-11-01" && index === 1 ? "unavailable" : "available",
          })),
          rowCount: dates.length,
        };
      }
      // Sync status for the quality notes (Phase 2.3A): one read, no rows for this fixture.
      if (sql.includes("from analytics_connections c") && sql.includes("analytics_jobs")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const view = {
      clientId: "client-1",
      websiteId: "website-1",
      current: { start: "2026-11-01", end: "2026-11-02" },
      previous: { start: "2026-10-30", end: "2026-10-31" },
    } as SiteView;

    const bundle = await loadLiveBundle({ query } as never, view);

    // Day 2 is not an available value, so the chart leaves it out and the total must too (D51).
    expect(bundle.sessions).toMatchObject({ value: null, state: "unavailable" });
    expect(bundle.sessions.note).toContain("1 of 2 days recorded");
    expect(bundle.sessionsPrevious).toBe(5);
    expect(bundle.dailyCurrent).toEqual([
      { date: "2026-11-01", value: 4 },
      { date: "2026-11-02", value: null },
    ]);
    // Connections, current coverage, previous coverage, and (Phase 2.3A) one read of sync status for the quality notes.
    expect(query).toHaveBeenCalledTimes(4);
  });
});
