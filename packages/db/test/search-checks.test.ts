import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { indexLabels } from "../src/services/site-health";
import { normalizeIndexPath, parseInspection, publicPageUrl } from "../src/analytics/providers/gsc";
import { parsePageSpeed } from "../src/analytics/providers/pagespeed";

describe("index and speed readings", () => {
  it("keeps a page URL on the website origin", () => {
    expect(publicPageUrl("https://index-check.example.invalid/en/", "/")).toBe("https://index-check.example.invalid/");
    expect(publicPageUrl("https://index-check.example.invalid/", "care")).toBe("https://index-check.example.invalid/care");
    expect(publicPageUrl("https://index-check.example.invalid/", "/care/")).toBe("https://index-check.example.invalid/care");
    expect(publicPageUrl("javascript:alert(1)", "/")).toBeNull();
    expect(normalizeIndexPath("/../secret")).toBeNull();
    expect(normalizeIndexPath("//evil.example")).toBeNull();
  });

  it("reads Google's index verdict without treating a preference as the verdict", () => {
    expect(parseInspection({
      inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", indexingState: "INDEXING_ALLOWED" } },
    })).toEqual({ live: "indexable", google: "indexed", coverage: "Submitted and indexed" });
    expect(parseInspection({
      inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "URL is unknown to Google" } },
    })).toEqual({ live: "not_checked", google: "not_indexed", coverage: "URL is unknown to Google" });
    expect(parseInspection({
      inspectionResult: { indexStatusResult: { verdict: "FAIL", coverageState: "Blocked by robots", indexingState: "BLOCKED_BY_META_TAG" } },
    })).toEqual({ live: "blocked", google: "not_indexed", coverage: "Blocked by robots" });
    expect(parseInspection({
      inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Crawled - currently not indexed", indexingState: "INDEXING_ALLOWED" } },
    })).toEqual({ live: "indexable", google: "not_indexed", coverage: "Crawled - currently not indexed" });
    expect(parseInspection({})).toEqual({ live: "not_checked", google: "unknown", coverage: null });
    expect(parseInspection({ inspectionResult: { indexStatusResult: { coverageState: "<script>" } } }).coverage).toBeNull();
  });

  it("reads a mobile lab score from the performance category", () => {
    expect(parsePageSpeed({
      lighthouseResult: {
        categories: { performance: { score: 0.91 } },
        audits: {
          "largest-contentful-paint": { numericValue: 2400.4 },
          "cumulative-layout-shift": { numericValue: 0.0124 },
          "total-blocking-time": { numericValue: 80.2 },
        },
      },
    })).toEqual({ score: 91, lcpMs: 2400, cls: 0.012, tbtMs: 80 });
    expect(parsePageSpeed({})).toEqual({ score: null, lcpMs: null, cls: null, tbtMs: null });
  });

  it("uses words for the index columns", () => {
    expect(indexLabels({ configured: "index_allowed", liveStatus: "not_checked", googleStatus: "connected" })).toEqual({
      configured: "Index allowed",
      live: "Not checked",
      google: "Connected",
    });
    expect(indexLabels({ configured: "noindex_saved", liveStatus: "blocked", googleStatus: "reconnect_required" }).google).toBe("Reconnect required");
  });

  it("locks one index row at a time so overlapping checks do not take the same page", () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/services/site-health.ts"), "utf8");
    expect(source).toContain("for update skip locked");
    expect(source).toContain("for update of k skip locked");
  });
});
