/**
 * The SEO sidebar (D79): four flat destinations. Every existing SEO route stays; each belongs to one group, so the
 * sidebar highlights the parent group whichever way a tool was opened. Client-safe: no server imports.
 */

export type SeoSectionKey = "overview" | "setup" | "crawling" | "ai";

/** In the sidebar order. The labels match the Tools and settings group headings on SEO Overview exactly. */
export const SEO_SECTIONS: ReadonlyArray<{ key: SeoSectionKey; label: string; path: string }> = [
  { key: "overview", label: "SEO Overview", path: "/seo" },
  { key: "setup", label: "SEO setup & local presence", path: "/seo/setup" },
  { key: "crawling", label: "Crawling & indexing", path: "/seo/crawling" },
  { key: "ai", label: "AI visibility", path: "/seo/ai" },
];

/**
 * The group a page belongs to.
 * - Setup & local presence: Checklist & Tasks (every tab, Issues included), Google Business Profile, SEO Settings
 *   and the other Settings & Connections tabs, and the SEO Work report.
 * - Crawling & indexing: Site Health, URL Redirects, Pages & Content with URL Inspection, and the Connections tab of
 *   Settings & Connections (Site Verification).
 * - AI visibility: AI Visibility (crawl activity, AI Access with llms.txt and NLWeb) and the AI Report.
 * - SEO Overview: the overview and the full Google Search report its Google panel opens.
 */
export function seoSection(pathname: string, tab?: string | null): SeoSectionKey {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/seo") return "overview";
  if (path === "/seo/reports") return tab === "work" ? "setup" : tab === "ai" ? "ai" : "overview";
  if (path === "/seo/ai" || path === "/seo/ai-visibility") return "ai";
  if (path === "/seo/settings") return tab === "connections" ? "crawling" : "setup";
  if (["/seo/crawling", "/seo/site-health", "/seo/redirects", "/seo/pages", "/seo/new"].some((root) => path === root || path.startsWith(`${root}/`))) return "crawling";
  return "setup";
}

/** A tab that may live on another route: [id, label, path?]. Without a path the tab stays on the current page. */
export type SeoTab = readonly [string, string, string?];

/** AI Visibility's tabs, shared by the AI Visibility page and the AI Report so both show the same bar. */
export const AI_SECTION_TABS: ReadonlyArray<SeoTab> = [
  ["visibility", "Visibility", "/seo/ai-visibility"],
  ["questions", "Questions & Tests", "/seo/ai-visibility"],
  ["sources", "Sources & Perception", "/seo/ai-visibility"],
  ["access", "AI Access", "/seo/ai-visibility"],
  ["ai", "AI Report", "/seo/reports"],
];
