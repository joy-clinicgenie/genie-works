import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChecklistHealth } from "@clinic-genie/db";
import { ProgressRing, SeoAssistantPanel, TOOL_GROUPS, ToolsAndSettings } from "@/components/modules/seo/SeoAssistant";
import { SeoSectionLinks, SeoTabs } from "@/components/modules/SeoSubnav";
import { SEO_SECTIONS, seoSection } from "@/lib/seo-sections";
import { GenAiVisibilityPanel, GooglePerformancePanel } from "@/components/modules/seo/OverviewInsights";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const WEBSITE = "11111111-2222-4333-8444-555555555555";
const ctx = { client: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", website: WEBSITE, demo: false } as Parameters<typeof ToolsAndSettings>[0]["ctx"];

function health(over: Partial<ChecklistHealth> = {}): ChecklistHealth {
  return {
    counts: { setupDone: 3, setupTotal: 5, unresolvedIssues: 4, newRecommendations: 2, completedTasks: 7 },
    setupPercent: 60,
    next: null,
    completedWindow: { start: "2026-10-25", end: "2026-11-23", days: 30 },
    lastCheck: null,
    lastUpdated: new Date("2026-11-22T03:15:00.000Z"),
    ...over,
  };
}

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!.replaceAll("&amp;", "&"));

describe("SEO Assistant panel (D74)", () => {
  it("shows the setup percentage inside the ring and each count above its label", () => {
    const markup = html(createElement(SeoAssistantPanel, { ctx, health: health() }));
    expect(markup).toContain("SEO Assistant");
    expect(markup).toMatch(/data-setup-ring[^]*?60%/);
    expect(markup).toContain("3 of 5 setup steps complete");
    expect(markup).toMatch(/data-count="issues"[^>]*><span[^>]*>4<\/span><span[^>]*>Issues<\/span>/);
    expect(markup).toMatch(/data-count="recommendations"[^>]*><span[^>]*>2<\/span>/);
    expect(markup).toMatch(/data-count="completed"[^>]*><span[^>]*>7<\/span>/);
    expect(markup).toContain("Last updated");
  });

  it("links every figure to its Checklist & Tasks tab with the same website", () => {
    const links = hrefs(html(createElement(SeoAssistantPanel, { ctx, health: health() })));
    for (const link of links) expect(link).toContain(`website=${WEBSITE}`);
    expect(links).toContain(`/seo/tasks?client=${ctx.client}&website=${WEBSITE}&tab=setup`);
    expect(links.some((link) => link.includes("tab=issues"))).toBe(true);
    expect(links.some((link) => link.includes("tab=recommendations"))).toBe(true);
    expect(links.some((link) => link.includes("tab=completed") && link.includes("days=30"))).toBe(true);
  });

  it("shows a dash when no setup step applies, and says when nothing is recorded yet", () => {
    const markup = html(createElement(SeoAssistantPanel, {
      ctx,
      health: health({ counts: { setupDone: 0, setupTotal: 0, unresolvedIssues: 0, newRecommendations: 0, completedTasks: 0 }, setupPercent: null, lastUpdated: null }),
    }));
    expect(markup).toMatch(/data-setup-ring[^]*?–/);
    expect(markup).not.toContain("NaN");
    expect(markup).toContain("No setup step applies");
    expect(markup).toContain("no activity recorded yet");
    expect(html(createElement(ProgressRing, { percent: null }))).not.toContain("stroke-action");
  });
});

describe("Tools and settings (D74, D79)", () => {
  it("lists the three groups, headed exactly as the sidebar, each tool opening its existing destination", () => {
    expect(TOOL_GROUPS.map((group) => group.title)).toEqual(SEO_SECTIONS.slice(1).map((section) => section.label));
    expect(TOOL_GROUPS.map((group) => group.tools.map((tool) => tool.label))).toEqual([
      ["SEO Setup Checklist", "SEO Settings", "Google Business Profile"],
      ["Site Inspection", "Site Verification", "Sitemaps", "Robots.txt", "Redirect Checks"],
      ["AI crawl activity", "llms.txt", "NLWeb"],
    ]);
    const markup = html(createElement(ToolsAndSettings, { ctx }));
    expect(markup).toContain(">Tools and settings</h2>");
    const links = hrefs(markup);
    // 11 tools plus the three group headings, which open the group pages.
    expect(links).toHaveLength(14);
    for (const link of links) expect(link).toContain(`website=${WEBSITE}`);
    for (const tool of TOOL_GROUPS.flatMap((group) => [...group.tools, ...group.more])) {
      expect(readFileSync(resolve(root, `apps/platform/src/app/(app)${tool.path}/page.tsx`), "utf8"), tool.label).toContain(`["${tool.tab}"`);
    }
  });

  it("puts every tool in the group the sidebar highlights for it", () => {
    for (const group of TOOL_GROUPS) {
      for (const tool of [...group.tools, ...group.more]) expect(seoSection(tool.path, tool.tab), `${group.title}: ${tool.label}`).toBe(group.key);
    }
  });
});

describe("SEO sidebar groups (D79)", () => {
  it("has exactly four flat destinations in order, and SEO performance opens SEO Overview", () => {
    expect(SEO_SECTIONS.map((section) => [section.label, section.path])).toEqual([
      ["SEO Overview", "/seo"],
      ["SEO setup & local presence", "/seo/setup"],
      ["Crawling & indexing", "/seo/crawling"],
      ["AI visibility", "/seo/ai"],
    ]);
    const layout = readFileSync(resolve(root, "apps/platform/src/app/(app)/layout.tsx"), "utf8");
    expect(layout).toContain('{ href: "/seo", label: "SEO performance"');
  });

  it("highlights the parent group of every existing SEO page and tab", () => {
    const cases: Array<[string, string | null, string]> = [
      ["/seo", null, "overview"],
      ["/seo/reports", "google-search", "overview"],
      ["/seo/reports", null, "overview"],
      ["/seo/tasks", "issues", "setup"],
      ["/seo/tasks", "setup", "setup"],
      ["/seo/checklist", null, "setup"],
      ["/seo/reports", "work", "setup"],
      ["/seo/settings", "defaults", "setup"],
      ["/seo/settings", "publishing", "setup"],
      ["/seo/settings", "access", "setup"],
      ["/seo/business-profile", "locations", "setup"],
      ["/seo/business-profile/3f0c", null, "setup"],
      ["/seo/business-profiles", null, "setup"],
      ["/seo/settings", "connections", "crawling"],
      ["/seo/site-health", "crawl", "crawling"],
      ["/seo/site-health", "indexing", "crawling"],
      ["/seo/redirects", "redirects", "crawling"],
      ["/seo/pages", "pages", "crawling"],
      ["/seo/pages/3f0c/inspection", null, "crawling"],
      ["/seo/new", null, "crawling"],
      ["/seo/ai-visibility", "visibility", "ai"],
      ["/seo/ai-visibility", "access", "ai"],
      ["/seo/reports", "ai", "ai"],
    ];
    for (const [path, tab, group] of cases) expect(seoSection(path, tab), `${path} ${tab}`).toBe(group);
  });

  it("keeps every former sidebar destination reachable from a group page or the overview", () => {
    const reachable = new Set(TOOL_GROUPS.flatMap((group) => [...group.tools, ...group.more]).map((tool) => tool.path));
    const overview = readFileSync(resolve(root, "apps/platform/src/components/modules/seo/OverviewInsights.tsx"), "utf8");
    expect(overview).toContain('seoHref("/seo/reports", ctx, { tab: "google-search"');
    for (const path of ["/seo/tasks", "/seo/pages", "/seo/site-health", "/seo/redirects", "/seo/business-profile", "/seo/ai-visibility", "/seo/reports", "/seo/settings"]) {
      expect(reachable.has(path), path).toBe(true);
    }
  });

  it("highlights SEO setup & local presence for Issues, with the Issues tab selected and the website kept", () => {
    const sidebar = html(createElement(SeoSectionLinks, { pathname: "/seo/tasks", tab: "issues", ctx }));
    expect(sidebar).toMatch(/aria-current="page"[^>]*><span[^>]*>SEO setup &amp; local presence</);
    expect(sidebar.match(/aria-current="page"/g)).toHaveLength(1);
    for (const link of hrefs(sidebar)) expect(link).toContain(`website=${WEBSITE}`);
    const issues = hrefs(html(createElement(SeoAssistantPanel, { ctx, health: health() }))).find((link) => link.includes("tab=issues"))!;
    expect(seoSection(issues.split("?")[0]!, new URLSearchParams(issues.split("?")[1]).get("tab"))).toBe("setup");
  });
});

describe("flat SEO sidebar (D74)", () => {
  it("renders section pages as horizontal tabs, with the current one marked and the website kept", () => {
    const markup = html(createElement(SeoTabs, { pathname: "/seo/tasks", ctx, tabs: [["setup", "Setup"], ["issues", "Issues"], ["recommendations", "Recommendations"], ["completed", "Completed"]], current: "issues", title: "Checklist & Tasks" }));
    expect(markup).toContain('aria-label="Checklist &amp; Tasks sections"');
    expect([...markup.matchAll(/>([A-Za-z]+)<\/a>/g)].map((match) => match[1])).toEqual(["Setup", "Issues", "Recommendations", "Completed"]);
    expect(markup).toMatch(/aria-current="page"[^>]*>Issues</);
    for (const link of hrefs(markup)) expect(link).toContain(`website=${WEBSITE}`);
  });

  it("keeps section pages out of the sidebar", () => {
    const frame = readFileSync(resolve(root, "apps/platform/src/components/modules/seo/SeoFrame.tsx"), "utf8");
    expect(frame).toContain("nav={<SeoSectionLinks pathname={pathname} tab={currentTab} ctx={ctx} />}");
    expect(frame).not.toContain("SeoPageLinks");
  });
});

describe("Site performance on Google and Gen AI Visibility (D76)", () => {
  const controls = { range: "7", metric: "impressions", record: "pages", direction: "increased", changeMetric: "clicks" } as const;
  const day = (date: string, impressions: number, clicks: number) => ({ date, impressions, clicks, ctr: null, position: null });
  const report = {
    connection: { state: "connected", property: "sc-domain:fictional.example.invalid" },
    requested: { start: "2026-11-13", end: "2026-11-19" },
    window: { start: "2026-11-13", end: "2026-11-19" },
    timezone: "America/Los_Angeles",
    totals: { clicks: 12, impressions: 340, ctr: 0.035, position: 9.1, fetchedAt: new Date("2026-11-20T00:00:00Z") },
    quality: [],
    previous: { window: { start: "2026-11-06", end: "2026-11-12" }, totals: { clicks: 9, impressions: 300, ctr: null, position: null } },
    pages: { status: "not_stored" },
    queries: { status: "not_stored" },
    daily: { status: "available", fetchedAt: new Date(), rows: [day("2026-11-18", 40, 2), day("2026-11-19", 55, 3)] },
    latestDate: "2026-11-19",
  } as unknown as Parameters<typeof GooglePerformancePanel>[0]["report"];
  const changes = { status: "available", increased: [{ key: "/services", current: 30, previous: 10, change: 20 }], decreased: [], previousWindow: { start: "2026-11-06", end: "2026-11-12" } } as Parameters<typeof GooglePerformancePanel>[0]["changes"];

  it("shows the source, latest date, two metrics and the chart for the selected metric, keeping the website", () => {
    const markup = html(createElement(GooglePerformancePanel, { ctx, controls, metric: "impressions", report, changes }));
    expect(markup).toContain("Source: Google Search Console");
    expect(markup).toContain("Latest reporting date: 19 Nov");
    expect([...markup.matchAll(/data-metric="([a-z]+)"/g)].map((match) => match[1])).toEqual(["impressions", "clicks"]);
    expect(markup).toContain('data-trend="impressions"');
    expect(markup).toMatch(/aria-current="true"[^>]*><span[^>]*>Last\u00a0<\/span>7\u00a0days</);
    expect(markup).toContain("/services");
    for (const link of hrefs(markup).filter((link) => link.startsWith("/seo"))) expect(link).toContain(`website=${WEBSITE}`);
    expect(hrefs(markup)).toContain(`/seo?client=${ctx.client}&website=${WEBSITE}&range=7&metric=clicks&record=pages&direction=increased`);
  });

  it("shows compact empty states when Search Console has nothing stored", () => {
    const markup = html(createElement(GooglePerformancePanel, { ctx, controls, metric: "clicks", report: null, changes: null }));
    expect(markup).toContain("Latest reporting date: not available");
    expect(markup).toContain("Google Search Console is not connected");
    expect(markup).toContain("Changes not available");
  });

  it("lists exactly ChatGPT, Gemini and Claude with their crawl dates and no invented AI figures", () => {
    const crawls = [
      { provider: "chatgpt", state: "measured", lastCrawledAt: new Date("2026-11-03T02:00:00Z") },
      { provider: "gemini", state: "not_measured", lastCrawledAt: null },
      { provider: "claude", state: "measured", lastCrawledAt: null },
    ] as const;
    const markup = html(createElement(GenAiVisibilityPanel, { ctx, crawls: [...crawls] }));
    expect([...markup.matchAll(/data-crawl="([a-z]+)"/g)].map((match) => match[1])).toEqual(["chatgpt", "gemini", "claude"]);
    expect(markup).toMatch(/data-crawl="chatgpt"[^]*?3 Nov</);
    expect(markup).toContain("Not measured");
    expect(markup).toContain("No crawl recorded");
    expect(markup).toContain("Last 30 days");
    expect(markup).toContain("User queries on AI by page");
    expect(markup).toContain("ChatGPT visibility score");
    expect(markup.match(/No data source/g)).toHaveLength(2);
    expect(markup).toContain("Crawl activity cannot");
    expect(hrefs(markup)).toContain(`/seo/ai-visibility?client=${ctx.client}&website=${WEBSITE}&tab=visibility&range=30`);
  });
});
