import Link from "next/link";
import { seoHref, type SeoContext } from "@/lib/seo-workspace";
import { SEO_SECTIONS, seoSection, type SeoTab } from "@/lib/seo-sections";
import { InnerNavGroup, InnerNavLink } from "@/components/shell/InnerNav";

/** The flat SEO sidebar (D79): four destinations; the current one follows the page's section, not its URL alone. */
export function SeoSectionLinks({ pathname, tab, ctx }: { pathname: string; tab?: string; ctx: SeoContext }) {
  const current = seoSection(pathname, tab);
  return (
    <InnerNavGroup title="SEO">
      {SEO_SECTIONS.map((section) => (
        <InnerNavLink key={section.key} href={seoHref(section.path, ctx)} current={current === section.key}>{section.label}</InnerNavLink>
      ))}
    </InnerNavGroup>
  );
}

/**
 * A section's own pages as horizontal tabs directly below the page heading. The SEO sidebar stays flat: it lists
 * only the top-level sections. Each tab is a link, so deep links, refresh and back/forward keep the tab.
 */
export function SeoTabs({ pathname, ctx, tabs, current, extra, title }: { pathname: string; ctx: SeoContext; tabs: ReadonlyArray<SeoTab>; current: string; extra?: Record<string, string | undefined>; title: string }) {
  return (
    <nav aria-label={`${title} sections`} className="mb-5 overflow-x-auto overflow-y-hidden" data-seo-tabs>
      <ul className="inline-flex min-w-max gap-1 rounded-full border border-white/80 bg-white/60 p-1 shadow-[0_1px_2px_rgba(23,60,64,0.04)]">
        {tabs.map(([id, label, path]) => {
          const active = current === id;
          // A tab on another route carries only the website and its own tab; page-specific extras stay behind.
          const href = path && path !== pathname ? seoHref(path, ctx, { tab: id }) : seoHref(pathname, ctx, { ...extra, tab: id });
          return (
            <li key={id}>
              <Link
                href={href}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors ${active ? "bg-brand-pale text-ink shadow-[inset_0_0_0_1px_var(--color-brand-pale-strong)]" : "text-ink-soft hover:bg-brand-pale/60 hover:text-ink"}`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
