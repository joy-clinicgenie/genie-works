import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { SeoPageLinks, SeoSectionLinks } from "@/components/modules/SeoSubnav";
import { InnerNavFrame } from "@/components/shell/InnerNav";
import { SeoScopeProvider, SeoScopedContent, SeoWebsiteSelector } from "@/components/modules/seo/SeoScope";
import { environmentLabel, type SeoContext } from "@/lib/seo-workspace";

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
  tabs?: ReadonlyArray<readonly [string, string]>;
  currentTab?: string;
  tabExtra?: Record<string, string | undefined>;
  requireWebsite?: boolean;
  children: ReactNode;
}) {
  const selected = ctx.selected;
  const blocked = ctx.demoConflict || (!ctx.demo && requireWebsite && !selected);
  return (
    <SeoScopeProvider currentKey={selected?.id ?? ""} savedUnavailable={ctx.savedUnavailable}>
    <InnerNavFrame
      label="SEO"
      nav={
        <>
          <SeoSectionLinks pathname={pathname} ctx={ctx} />
          {tabs && currentTab ? <SeoPageLinks pathname={pathname} ctx={ctx} tabs={tabs} current={currentTab} extra={tabExtra} title={title} /> : null}
        </>
      }
    >
      <PageHeader
        eyebrow={selected ? `${selected.clientName} · ${environmentLabel(selected.environment)}` : ctx.demo ? "Demonstration" : "No website selected"}
        title={title}
        description={description}
        action={action}
      />
      {ctx.contextNote && <div className="mb-4"><Notice tone="neutral">{ctx.contextNote}</Notice></div>}
      {selected && (
        <dl className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-label="Selected website">
          <div className="flex gap-1"><dt className="text-muted">Organisation:</dt><dd className="font-medium">{selected.clientName}</dd></div>
          <div className="flex gap-1"><dt className="text-muted">Website:</dt><dd className="font-medium">{selected.name}</dd></div>
          <div className="flex items-center gap-1"><dt className="text-muted">Environment:</dt><dd><Badge tone={selected.environment === "production" ? "good" : "warn"}>{environmentLabel(selected.environment)}</Badge></dd></div>
          <div className="flex gap-1"><dt className="text-muted">Platform:</dt><dd>{selected.platform}</dd></div>
          <div>{selected.url ? <a href={selected.url} target="_blank" rel="noreferrer" className="text-action hover:underline">View public website</a> : <span className="text-muted">No public URL recorded</span>}</div>
        </dl>
      )}
      <details className="card mb-5 p-4" open={!selected}>
        <summary className="cursor-pointer text-sm font-semibold">Change website or environment</summary>
        <SeoWebsiteSelector
          pathname={pathname}
          tab={currentTab}
          sites={ctx.sites.map((site) => ({ id: site.id, clientName: site.clientName, name: site.name, environment: site.environment }))}
          website={ctx.website}
        />
      </details>
      <SeoScopedContent>
        {blocked ? (
          <EmptyState title={ctx.sites.length === 0 ? "No active website is available" : ctx.client && ctx.sites.every((site) => site.clientId !== ctx.client) ? "This clinic has no active website" : "Choose a website"}>SEO data stays empty until a website and environment are selected. No default clinic is assumed.</EmptyState>
        ) : children}
      </SeoScopedContent>
    </InnerNavFrame>
    </SeoScopeProvider>
  );
}
