import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { SeoPageLinks, SeoSectionLinks } from "@/components/modules/SeoSubnav";
import { InnerNavFrame } from "@/components/shell/InnerNav";
import { SeoContextForm } from "@/components/modules/seo/SeoContextForm";
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
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={selected.environment === "production" ? "good" : "warn"}>{environmentLabel(selected.environment)}</Badge>
          <span className="font-medium">{selected.name}</span>
          <span className="text-muted">{selected.platform}</span>
          {selected.url ? <a href={selected.url} target="_blank" rel="noreferrer" className="text-action hover:underline">View public website</a> : <span className="text-muted">No public URL recorded</span>}
        </div>
      )}
      <details className="card mb-5 p-4" open={!selected}>
        <summary className="cursor-pointer text-sm font-semibold">Change clinic or website</summary>
        <SeoContextForm pathname={pathname} tab={currentTab} clients={ctx.clients} sites={ctx.sites} client={ctx.client} website={ctx.website} />
      </details>
      {blocked ? (
        <EmptyState title={ctx.sites.length === 0 ? "No active website is available" : ctx.client && ctx.sites.every((site) => site.clientId !== ctx.client) ? "This clinic has no active website" : "Choose a website"}>SEO data stays empty until a clinic and website are selected. No default clinic is assumed.</EmptyState>
      ) : children}
    </InnerNavFrame>
  );
}
