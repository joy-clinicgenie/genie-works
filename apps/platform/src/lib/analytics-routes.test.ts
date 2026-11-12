import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const analytics = resolve(root, "apps/platform/src/app/(app)/analytics");

describe("analytics tab loading", () => {
  it("loads every tab through the one shared page transaction", () => {
    for (const tab of ["page.tsx", "traffic/page.tsx", "behavior/page.tsx"]) {
      const source = readFileSync(resolve(analytics, tab), "utf8");
      expect(source, tab).toContain("loadAnalyticsOverview");
      // The second transaction came from resolving the view and then loading the board separately.
      expect(source, tab).not.toContain("loadAnalyticsBoard");
      expect(source, tab).not.toContain("loadAnalytics(");
    }
  });

  it("no longer exposes the separate board loader that opened a second transaction", () => {
    const loader = readFileSync(resolve(root, "apps/platform/src/lib/load-analytics-board.ts"), "utf8");
    expect(loader).not.toContain("export async function loadAnalyticsBoard");
    expect(loader).toContain("export async function loadAnalyticsOverviewForAccess");
    // One staffTx for the view and the live bundle together.
    expect(loader.match(/staffTx\(/g) ?? []).toHaveLength(1);
  });

  it("serves the British spelling alias from the redirect configuration, not a rendered page", () => {
    expect(existsSync(resolve(analytics, "behaviour/page.tsx"))).toBe(false);
    const config = readFileSync(resolve(root, "apps/platform/next.config.ts"), "utf8");
    expect(config).toContain("async redirects()");
    expect(config).toContain('source: "/analytics/behaviour"');
    expect(config).toContain('destination: "/analytics/behavior"');
    // permanent: false keeps the 307 the alias page returned, so the alias stays uncached.
    expect(config).toMatch(/source: "\/analytics\/behaviour", destination: "\/analytics\/behavior", permanent: false/);
  });
});
