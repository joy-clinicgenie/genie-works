import { describe, expect, it } from "vitest";
import { BLOG_PAGES, POSTS_ONLY_PARAMS, blogHref, safeBlogReturn } from "@/lib/blog-scope";
import { articleStatus, workingLabel } from "@/lib/blog-status";

const C = "11111111-1111-4111-8111-111111111111";
const W = "22222222-2222-4222-8222-222222222222";

describe("Blog scope (D87)", () => {
  it("lists the five locked pages in order", () => {
    expect(BLOG_PAGES.map((page) => page.label)).toEqual(["Overview", "Posts", "Categories", "Tags", "Analytics"]);
  });

  it("carries the client and a website narrowing, never a website without a client", () => {
    expect(blogHref("/blog/posts", { clientId: C, websiteId: W }, { queue: "awaiting_review" })).toBe(`/blog/posts?client=${C}&website=${W}&queue=awaiting_review`);
    expect(blogHref("/blog/tags", { clientId: C, websiteId: null })).toBe(`/blog/tags?client=${C}`);
    expect(blogHref("/blog", { clientId: null, websiteId: W })).toBe("/blog");
  });

  it("treats the old register's filters as Posts-only", () => {
    expect([...POSTS_ONLY_PARAMS]).toEqual(["status", "author", "q", "sort", "page", "queue"]);
  });

  it("only returns to a Blog list or Overview address", () => {
    expect(safeBlogReturn(`/blog/posts?client=${C}&status=draft&page=2`)).toBe(`/blog/posts?client=${C}&status=draft&page=2`);
    expect(safeBlogReturn(`/blog?client=${C}`)).toBe(`/blog?client=${C}`);
    for (const bad of ["https://evil.example/blog/posts", "//evil.example/blog/posts", "/blog/../admin", "/blog/abc", "/blog/posts#x", "javascript:alert(1)", undefined, ""]) {
      expect(safeBlogReturn(bad)).toBeNull();
    }
  });
});

describe("Blog status labels (D87)", () => {
  const base = { working_status: null, website_status: "not_published", latest_decision: null } as const;
  it("names every state, and an unverified internal release honestly", () => {
    expect(articleStatus({ ...base, status: "draft" }).label).toBe("Draft");
    expect(articleStatus({ ...base, status: "draft", latest_decision: "returned" }).label).toBe("Changes requested");
    expect(articleStatus({ ...base, status: "in_review" }).label).toBe("Awaiting review");
    expect(articleStatus({ ...base, status: "approved" }).label).toBe("Ready to publish");
    expect(articleStatus({ ...base, status: "published", website_status: "unverified" }).label).toBe("Website publication unverified");
    expect(articleStatus({ ...base, status: "published", website_status: "verified" })).toEqual({ label: "Verified on website", tone: "good" });
    expect(articleStatus({ ...base, status: "published", website_status: "delivery_failed" }).tone).toBe("bad");
    expect(articleStatus({ ...base, status: "archived" }).label).toBe("Archived");
    for (const status of ["draft", "in_review", "approved", "published", "archived"] as const) {
      expect(articleStatus({ ...base, status }).label).not.toMatch(/ship to site/i);
    }
  });

  it("labels the working copy of a live article", () => {
    expect(workingLabel({ status: "published", working_status: "draft", latest_decision: null })).toBe("Unpublished changes");
    expect(workingLabel({ status: "published", working_status: "draft", latest_decision: "returned" })).toBe("Update: changes requested");
    expect(workingLabel({ status: "published", working_status: null, latest_decision: null })).toBeNull();
  });
});
