import type { ReactNode } from "react";
import { InnerNavGroup, InnerNavLink } from "@/components/shell/InnerNav";
import { BLOG_PAGES, blogHref, type BlogPageKey } from "@/lib/blog-scope";

/** D87: the five Blog pages, in order, each carrying the selected client and website scope. */
export function BlogNav({ active, scope, children }: { active?: BlogPageKey; scope: { clientId: string | null; websiteId: string | null }; children?: ReactNode }) {
  return (
    <>
      <InnerNavGroup title="Blog">
        {BLOG_PAGES.map((page) => (
          <InnerNavLink key={page.key} href={blogHref(page.href, scope)} current={page.key === active}>{page.label}</InnerNavLink>
        ))}
      </InnerNavGroup>
      {children}
    </>
  );
}
