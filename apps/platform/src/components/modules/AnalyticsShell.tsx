import type { ReactNode } from "react";
import { requireAccess } from "@/lib/session";
import type { PoolClient } from "@clinic-genie/db";
import { loadSiteView, loadSiteViewWithDb, type SiteView } from "@/lib/site-view";
import { analyticsPeriod, formatCompared } from "@/lib/period-range";
import type { PeriodRangeId } from "@/lib/period-options";
import { breakdownLinks, type BreakdownLinks } from "@/lib/report-link";
import { SiteHeader } from "@/components/modules/SiteHeader";
import { AnalyticsSubnav } from "@/components/modules/AnalyticsSubnav";
import { EmptyState, Notice } from "@/components/ui/Notice";

export async function loadAnalytics(client?: string, range?: string, from?: string, to?: string, website?: string) {
  const access = await requireAccess();
  return loadAnalyticsForAccess(access, undefined, client, range, from, to, website);
}

export async function loadAnalyticsForAccess(access: Awaited<ReturnType<typeof requireAccess>>, db: PoolClient | undefined, client?: string, range?: string, from?: string, to?: string, website?: string, live = false) {
  const period = analyticsPeriod({ range, from, to, live });
  const { rangeId, windows } = period;
  const custom = period.custom ? windows : null;
  const loaded = db
    ? await loadSiteViewWithDb(db, client, windows, period.exact, website)
    : await loadSiteView(access, client, windows, period.exact, website);
  const denied = loaded === "denied";
  const view = loaded === "denied" ? null : loaded;
  const reportLinks: BreakdownLinks | null = view ? breakdownLinks(view.clientId, rangeId, custom?.current.start, custom?.current.end, view.websiteId ?? undefined) : null;
  return { denied, rangeId, from: custom?.current.start, to: custom?.current.end, view, reportLinks };
}

export function UnavailableClient() {
  return <EmptyState title="That client is not available">The link does not open a client you can view.</EmptyState>;
}

export function NoWebsites() {
  return <EmptyState title="No websites yet">Analytics appear here once a client website is on the platform.</EmptyState>;
}

export function AnalyticsShell({ view, range, from, to, title = "Analytics", children }: { view: SiteView; range: PeriodRangeId; from?: string; to?: string; title?: string; children: ReactNode }) {
  return (
    <AnalyticsSubnav clientId={view.clientId} websiteId={view.websiteId} range={range} from={from} to={to}>
      {view.websiteCleared && <div className="mb-4"><Notice tone="neutral">The website in the link does not belong to this client, so it was left out.</Notice></div>}
      <SiteHeader
        title={title}
        clients={view.clients}
        clientId={view.clientId}
        clientName={view.clientName}
        clientReference={view.clientReference}
        clientSpecialty={view.clientSpecialty}
        websiteUrl={view.websiteUrl}
        current={view.current}
        previous={view.previous}
        updatedAt={view.updatedAt}
        range={range}
        from={from}
        to={to}
        websiteId={view.websiteId}
        comparedLabel={view.previous ? formatCompared(view.previous) : undefined}
      />
      {children}
    </AnalyticsSubnav>
  );
}
