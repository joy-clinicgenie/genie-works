import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { SeoSectionLinks, SeoTabs } from "@/components/modules/SeoSubnav";
import { InnerNavFrame } from "@/components/shell/InnerNav";
import { SeoScopeProvider, SeoScopedContent, SeoWebsiteSelector } from "@/components/modules/seo/SeoScope";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { environmentLabel, seoHref, type SeoContext } from "@/lib/seo-workspace";
import { SEO_SECTIONS, seoSection, type SeoTab } from "@/lib/seo-sections";

export function HiddenSeoContext({ ctx, tab, extra }: { ctx: SeoContext; tab?: string; extra?: Record<string, string | undefined> }) {
  return (
    <>
      {ctx.demo ? <input type="hidden" name="demo" value="1" /> : (
        <>
          {ctx.client && <input type="hidden" name="client" value={ctx.client} />}
          {ctx.website && <input type="hidden" name="website" value={ctx.website} />}
        </>
      )}
      {tab && <input type="hidden" name="tab" value={tab} />}
      {Object.entries(extra ?? {}).map(([key, value]) => value ? <input key={key} type="hidden" name={key} value={value} /> : null)}
    </>
  );
}

export function Unavailable({ title, children }: { title: string; children: ReactNode }) {
  return <Notice tone="neutral" title={title}>{children}</Notice>;
}

export function SeoFrame({
  ctx,
  pathname,
  title,
  description,
  action,
  tabs,
  currentTab,
  tabExtra,
  requireWebsite = true,
  children,
}: {
  ctx: SeoContext;
  pathname: string;
  title: string;
  description: string;
  action?: ReactNode;
  tabs?: ReadonlyArray<SeoTab>;
  currentTab?: string;
  tabExtra?: Record<string, string | undefined>;
  requireWebsite?: boolean;
  children: ReactNode;
}) {
  const selected = ctx.selected;
  const group = SEO_SECTIONS.find((section) => section.key === seoSection(pathname, currentTab))!;
  const parent = group.key !== "overview" && pathname !== group.path ? group : null;
  const blocked = ctx.demoConflict || (!ctx.demo && requireWebsite && !selected);
  const sites = ctx.sites.map((site) => ({ id: site.id, clientName: site.clientName, name: site.name, environment: site.environment }));
  // With a website open, the selector sits in the header row beside the title. Without one, the page shows a single
  // "Choose a website" prompt holding the same selector instead.
  const selector = <SeoWebsiteSelector pathname={pathname} tab={currentTab} sites={sites} website={ctx.website} compact />;
  return (
    <SeoScopeProvider currentKey={selected?.id ?? ""} savedUnavailable={ctx.savedUnavailable}>
    <InnerNavFrame label="SEO" nav={<SeoSectionLinks pathname={pathname} tab={currentTab} ctx={ctx} />}>
      {/* Header row: the title on the left and the website selector on the right. The description and the selected
          website's details run full width beneath it, so a long label never squeezes the title. */}
      {/* A tool page keeps its parent group highlighted in the sidebar and links back to the group (D79). */}
      {parent && (
        <Link href={seoHref(parent.path, ctx)} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-action hover:underline" data-group-back>
          <ChevronLeft className="size-4" aria-hidden="true" />{parent.label}
        </Link>
      )}
      <header className="mb-5" data-seo-header>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {selected ? `${selected.clientName} · ${environmentLabel(selected.environment)}` : ctx.demo ? "Demonstration" : "No website selected"}
            </div>
            <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
          </div>
          {(selected || ctx.demo || action) && (
            <div className="flex flex-wrap items-end gap-2 lg:shrink-0">
              {(selected || ctx.demo) && selector}
              {action}
            </div>
          )}
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted">{description}</p>
        {selected && (
          <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-label="Selected website">
            <div className="flex gap-1"><dt className="text-muted">Organisation:</dt><dd className="font-medium">{selected.clientName}</dd></div>
            <div className="flex gap-1"><dt className="text-muted">Website:</dt><dd className="font-medium">{selected.name}</dd></div>
            <div className="flex items-center gap-1"><dt className="text-muted">Environment:</dt><dd><Badge tone={selected.environment === "production" ? "good" : "warn"}>{environmentLabel(selected.environment)}</Badge></dd></div>
            <div className="flex gap-1"><dt className="text-muted">Platform:</dt><dd>{selected.platform}</dd></div>
            <div>{selected.url ? <a href={selected.url} target="_blank" rel="noreferrer" className="text-action hover:underline">View public website</a> : <span className="text-muted">No public URL recorded</span>}</div>
            </dl>
        )}
      </header>
      {ctx.contextNote && <div className="mb-4"><Notice tone="neutral">{ctx.contextNote}</Notice></div>}
      {tabs && currentTab && !blocked ? <SeoTabs pathname={pathname} ctx={ctx} tabs={tabs} current={currentTab} extra={tabExtra} title={title} /> : null}
      <SeoScopedContent>
        {blocked ? (
          ctx.demoConflict || ctx.sites.length === 0 ? (
            <EmptyState title={ctx.sites.length === 0 ? "No active website is available" : "Choose a website"}>SEO data stays empty until a website and environment are selected. No default clinic is assumed.</EmptyState>
          ) : (
            <section className="card p-5" aria-labelledby="seo-choose-website" data-choose-website>
              <h2 id="seo-choose-website" className="text-base font-semibold">{ctx.client && ctx.sites.every((site) => site.clientId !== ctx.client) ? "This clinic has no active website" : "Choose a website"}</h2>
              <p className="mt-1 text-sm text-muted">SEO data stays empty until a website and environment are selected. No default clinic is assumed.</p>
              <div className="mt-3">{selector}</div>
            </section>
          )
        ) : children}
      </SeoScopedContent>
    </InnerNavFrame>
    </SeoScopeProvider>
  );
}
