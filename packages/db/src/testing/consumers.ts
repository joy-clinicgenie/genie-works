/**
 * Capability matrix for local website consumers.
 * An unsupported or blocked capability never counts as passed.
 * Native Blog publication already has a platform contract. This matrix does not
 * treat a missing live site, or a placeholder route, as published output.
 */

export type CapabilityState = "testable" | "blocked" | "pending" | "excluded";

export interface WebsiteCapability {
  id: string;
  platform: "native" | "wix" | "both";
  state: CapabilityState;
  requirementIds: string;
  summary: string;
}

export const WEBSITE_CAPABILITIES: WebsiteCapability[] = [
  {
    id: "native-seo-metadata",
    platform: "native",
    state: "testable",
    requirementIds: "SEO-07–SEO-14",
    summary: "Published SEO settings are read with the site bearer token from GET /api/public/seo/[websiteId]. The response carries title, description, canonical path and indexable.",
  },
  {
    id: "native-redirects",
    platform: "native",
    state: "testable",
    requirementIds: "SEO-07–SEO-14",
    summary: "Active redirects are included in the same published SEO response. The consumer applies them; this repository does not host the public clinic pages.",
  },
  {
    id: "native-indexing",
    platform: "native",
    state: "testable",
    requirementIds: "SEO-07–SEO-14",
    summary: "Staging pages stay non-indexable through the indexable flag. No public deployment is created here.",
  },
  {
    id: "native-blog-contract",
    platform: "native",
    state: "testable",
    requirementIds: "BL-12–BL-14",
    summary: "Published native articles are read from GET /api/public/blog/[websiteId]. The same token serves the listing HTML, article HTML and sitemap XML. Those responses are the local consumer. The sibling clinic site does not call them, and a database status change alone is not publication proof.",
  },
  {
    id: "native-staging-site",
    platform: "native",
    state: "blocked",
    requirementIds: "SEO-18, BL-12–BL-14",
    summary: "A protected staging website was not deployed. This task does not buy hosting or change a live site. The sibling template does not yet call these Genie Works read APIs.",
  },
  {
    id: "wix-analytics-seo",
    platform: "wix",
    state: "blocked",
    requirementIds: "SEO-18",
    summary: "No non-production Wix site, app credentials or property access is configured. Local mocks do not prove Wix behaviour.",
  },
  {
    id: "wix-blog-publishing",
    platform: "wix",
    state: "excluded",
    requirementIds: "BL-12–BL-14",
    summary: "Wix Blog publishing is excluded. Native Blog does not depend on Wix credentials.",
  },
  {
    id: "blog-performance",
    platform: "both",
    state: "excluded",
    requirementIds: "BL-15–BL-20",
    summary: "Blog Performance stays deferred and is outside this environment.",
  },
];

export function capabilityCountsAsPassed(state: CapabilityState, checked: boolean): boolean {
  return state === "testable" && checked;
}

export const NATIVE_CONSUMER_PAGES = [
  { path: "/", purpose: "Home metadata and staging noindex", indexableOnStaging: false },
  { path: "/request-appointment", purpose: "Canonical and indexable service page", indexableOnStaging: false },
  { path: "/contact", purpose: "Second representative page", indexableOnStaging: false },
  { path: "/blog", purpose: "Native blog index from the published blog contract", indexableOnStaging: false },
  { path: "/blog/routine-skin-care-note", purpose: "Native article route. Not a placeholder publication.", indexableOnStaging: false },
] as const;
