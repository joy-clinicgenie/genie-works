import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const NOW = Date.now();
const mocks = vi.hoisted(() => ({
  reports: {} as Record<string, unknown>,
  lastSuccessAt: null as Date | null,
  period: { value: 12 as number | null, state: "available" as "available" | "unavailable", covered: 7, expected: 7 },
}));

vi.mock("@clinic-genie/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clinic-genie/db")>()),
  listConnections: async () => [{ id: "c1", client_id: "client-1", website_id: "web-1", provider: "ga4", status: "connected", disconnected_at: null }],
  listConnectionSyncStatus: async () => [{ connectionId: "c1", queued: 0, retryScheduled: 0, leased: 0, failed: 0, reconnectRequired: 0, lastSuccessAt: mocks.lastSuccessAt, safeError: null }],
  dailySessionSeriesWithPeriod: async () => ({ series: [], period: mocks.period }),
  publishedReport: async (_db: unknown, input: { templateKey: string }) => mocks.reports[input.templateKey] ?? null,
}));

import { loadLiveBundle } from "./live-analytics";
import { boardFromLive, boardFromSnapshots, liveFactsFromBundle } from "./analytics-board";
import type { SiteView } from "./site-view";
import { QualityNotices } from "@/components/modules/QualityNotices";

const view = { clientId: "client-1", websiteId: "web-1", current: { start: "2026-11-01", end: "2026-11-07" }, previous: { start: "2026-10-25", end: "2026-10-31" }, snapshots: [], periods: [] } as unknown as SiteView;
const report = (templateKey: string, quality: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: templateKey, templateKey, start: "2026-11-01", end: "2026-11-07", timezone: "Asia/Singapore", provenance: "api", completeness: "complete",
  generation: 1, fetchedAt: new Date(NOW), measuredThrough: null, quality, rows: [], ...extra,
});

describe("quality notes reach the analytics board (Phase 2.3A)", () => {
  it("says what is limited, in order, and carries it to the board without changing any figure", async () => {
    mocks.lastSuccessAt = new Date(NOW - 4 * 86_400_000);
    mocks.period = { value: 0, state: "available", covered: 7, expected: 7 };
    mocks.reports = {
      "ga4.landing": report("ga4.landing", { truncated: true, withheldByPrivacyFilter: { rows: 2, sessions: 5, byReason: { opaque_identifier: 2 } } }),
      "ga4.pages": report("ga4.pages", { truncated: true }),
      "ga4.traffic_range": report("ga4.traffic_range", { subjectToThresholding: true }),
      "ga4.device": report("ga4.device", {}, { completeness: "empty" }),
    };
    const bundle = await loadLiveBundle({ query: async () => ({ rows: [], rowCount: 0 }) } as never, view);
    expect(bundle.quality.map((note) => note.label)).toEqual(["Out of date", "Partial", "Truncated", "Rows left out", "No data", "Recorded zero"]);
    const truncated = bundle.quality.find((note) => note.state === "truncated")!;
    expect(truncated.text.startsWith("Landing pages, Pages: ")).toBe(true);
    expect(bundle.quality.find((note) => note.state === "withheld")!.text).toContain("2 rows were left out (5 sessions)");
    // The board carries the same notes and its numbers are those of the bundle.
    const board = boardFromLive(boardFromSnapshots({ snapshots: [], current: view.current, previous: view.previous, updatedAt: null } as never), liveFactsFromBundle(bundle));
    expect(board.qualityNotes).toEqual(bundle.quality);
    expect(board.sessions.current).toBe(0);
  });

  it("says nothing when everything is complete and recent", async () => {
    mocks.lastSuccessAt = new Date(NOW - 3_600_000);
    mocks.period = { value: 120, state: "available", covered: 7, expected: 7 };
    mocks.reports = { "ga4.landing": report("ga4.landing", {}), "ga4.traffic_range": report("ga4.traffic_range", {}) };
    const bundle = await loadLiveBundle({ query: async () => ({ rows: [], rowCount: 0 }) } as never, view);
    expect(bundle.quality).toEqual([]);
  });

  it("separates 'some days missing' from 'zero': a partial period is not reported as zero", async () => {
    mocks.lastSuccessAt = new Date(NOW - 3_600_000);
    mocks.reports = {};
    mocks.period = { value: null, state: "unavailable", covered: 5, expected: 7 };
    const bundle = await loadLiveBundle({ query: async () => ({ rows: [], rowCount: 0 }) } as never, view);
    expect(bundle.quality.map((note) => note.label)).toEqual(["Partial"]);
    expect(bundle.quality.some((note) => note.state === "genuine_zero")).toBe(false);
  });
});

describe("QualityNotices component", () => {
  const notes = [
    { state: "truncated" as const, severity: "attention" as const, label: "Truncated", text: "Landing pages: This list stopped at the number of rows the system reads. More rows exist and are not shown." },
    { state: "genuine_zero" as const, severity: "info" as const, label: "Recorded zero", text: "Sessions: Google Analytics measured this period and counted 0 sessions." },
  ];

  it("renders nothing when there is nothing to say", () => {
    expect(renderToStaticMarkup(createElement(QualityNotices, { notes: [] }))).toBe("");
    expect(renderToStaticMarkup(createElement(QualityNotices, { notes: undefined }))).toBe("");
  });

  it("states each note with a leading word, in a labelled status region, not by colour alone", () => {
    const html = renderToStaticMarkup(createElement(QualityNotices, { notes }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Data notes");
    expect(html).toContain("<span class=\"font-semibold\">Truncated:</span>");
    expect(html).toContain("<span class=\"font-semibold\">Recorded zero:</span>");
    expect(html).toContain("<ul");
  });

  it("escapes anything it is given", () => {
    const html = renderToStaticMarkup(createElement(QualityNotices, { notes: [{ state: "partial", severity: "info", label: "Partial", text: "<img src=x onerror=alert(1)>" }] }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
