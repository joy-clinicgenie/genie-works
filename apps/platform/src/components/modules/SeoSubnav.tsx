import { seoHref, type SeoContext } from "@/lib/seo-workspace";
import { InnerNavGroup, InnerNavLink } from "@/components/shell/InnerNav";

const DESTINATIONS = [
  ["/seo", "SEO Overview", true],
  ["/seo/tasks", "Checklist & Tasks", false],
  ["/seo/pages", "Pages & Content", false],
  ["/seo/site-health", "Site Health", false],
  ["/seo/redirects", "URL Redirects", false],
  ["/seo/business-profile", "Google Business Profile", false],
  ["/seo/ai-visibility", "AI Visibility", false],
  ["/seo/reports", "Reports", false],
  ["/seo/settings", "Settings & Connections", false],
] as const;

export function SeoSectionLinks({ pathname, ctx }: { pathname: string; ctx: SeoContext }) {
  return (
    <InnerNavGroup title="SEO">
      {DESTINATIONS.map(([href, title, exact]) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return <InnerNavLink key={href} href={seoHref(href, ctx)} current={active}>{title}</InnerNavLink>;
      })}
    </InnerNavGroup>
  );
}

export function SeoPageLinks({ pathname, ctx, tabs, current, extra, title }: { pathname: string; ctx: SeoContext; tabs: ReadonlyArray<readonly [string, string]>; current: string; extra?: Record<string, string | undefined>; title: string }) {
  return (
    <InnerNavGroup title={title}>
      {tabs.map(([id, label]) => (
        <InnerNavLink key={id} href={seoHref(pathname, ctx, { ...extra, tab: id })} current={current === id}>{label}</InnerNavLink>
      ))}
    </InnerNavGroup>
  );
}
