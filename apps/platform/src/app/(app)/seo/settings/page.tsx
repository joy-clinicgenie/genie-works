import Link from "next/link";
import { canExport, canManageRegistry, canPublishClient, canReviewClient } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { Badge, label, type Tone } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { SeoSiteSettingsEditor } from "@/components/modules/SeoSoftLaunchForms";
import { SeoFrame, Unavailable } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { environmentLabel, loadSeoContext, loadWebsiteSeo, queryText, searchConsoleCapability, selectedTab, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO settings" };

const TABS = [
  ["connections", "Connections"],
  ["defaults", "Website Defaults"],
  ["publishing", "Publishing & History"],
  ["access", "Access & Schedules"],
] as const;

export default async function SeoSettingsPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const bundle = ctx.selected ? await loadWebsiteSeo(access, ctx.selected) : null;
  const tab = selectedTab(queryText(query, "tab"), TABS, "connections");
  const site = ctx.selected;
  const search = bundle?.searchConsole ?? null;
  const searchTone: Tone = search?.status === "connected" ? "good" : search?.status === "reconnect_required" ? "warn" : "neutral";
  const searchLabel = search?.status === "connected" ? "Connected" : search?.status === "reconnect_required" ? "Reconnect required" : "Not connected";
  return (
    <SeoFrame ctx={ctx} pathname="/seo/settings" title="Settings & Connections" description="Administration stays separate from routine editing. Credentials are not shown again after they are saved." tabs={TABS} currentTab={tab} requireWebsite={tab !== "access"}>
      {ctx.demo && tab !== "access" ? <DemoNote>Connection status is not simulated.</DemoNote> : bundle && site && tab === "connections" ? (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold">Search Console</h2>
              <Badge tone={searchTone}>{searchLabel}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">Capability: {searchConsoleCapability(search, bundle.verification)}</p>
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold">Website settings API</h2>
            <p className="mt-1 text-sm text-muted">Capability: {bundle.connected ? "Can publish saved page settings and redirects to a connected Next.js deployment." : "Not connected."} This is not a full website management integration.</p>
            {site.platform.toLowerCase().includes("next") ? (
              <div className="mt-4">
                <SeoSiteSettingsEditor clientId={site.clientId} website={site} settings={[]} verificationToken={bundle.verification} connected={bundle.connected} canManageIntegration={canManageRegistry(access)} canPublish={canPublishClient(access, site.clientId)} section="connection" />
              </div>
            ) : <p className="mt-3 text-sm text-muted">This website platform does not accept the published-settings API.</p>}
          </Card>
          <Unavailable title="Other providers">Keyword research, analytics for AI referrals, crawler logs, AI test providers and deployment access beyond the settings API are not connected. Account switching is unavailable.</Unavailable>
        </div>
      ) : bundle && site && tab === "defaults" ? (
        <Card>
          <CardHeader title="Website defaults" description="The registry website is the canonical record. Page overrides are edited here." />
          <div className="space-y-4 px-5 pb-5">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs uppercase text-muted">Public domain</dt><dd>{site.url ?? "Not recorded"}</dd></div>
              <div><dt className="text-xs uppercase text-muted">Environment</dt><dd>{environmentLabel(site.environment)}</dd></div>
              <div><dt className="text-xs uppercase text-muted">Site name</dt><dd>{site.name}</dd></div>
              <div><dt className="text-xs uppercase text-muted">Platform</dt><dd>{site.platform}</dd></div>
            </dl>
            <details>
              <summary className="cursor-pointer text-sm font-medium">What does this mean?</summary>
              <p className="mt-2 text-sm text-muted">The domain and environment come from the clinic website record. Changing them in the client profile does not publish SEO by itself. Language, timezone, favicon and business-identity fields are not stored in this SEO module.</p>
            </details>
            <Link href={`/clients/${site.clientId}/profile`} className="text-sm text-action hover:underline">Edit the website record</Link>
            {site.platform.toLowerCase().includes("next") && (
              <SeoSiteSettingsEditor clientId={site.clientId} website={site} settings={bundle.settings} verificationToken={null} connected={bundle.connected} canManageIntegration={false} canPublish={bundle.canPublish} section="pages" />
            )}
          </div>
        </Card>
      ) : bundle && tab === "publishing" ? (
        <div className="space-y-4">
          <Unavailable title="Release rollback is not available">Draft batches, protected previews and a website release connection are not implemented. Saving a page setting updates the settings API record only.</Unavailable>
          <Card>
            <CardHeader title="Change history" description="Staff-recorded before and after values." />
            <ul className="divide-y divide-line">
              {bundle.changes.length === 0 && <li className="px-5 py-3 text-sm text-muted">No changes for this website.</li>}
              {bundle.changes.map((change) => (
                <li key={change.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{change.verification_on ? "Verified" : change.approval_id ? "Approved" : "Draft"}</Badge>
                    <Link href={`/seo/pages/${change.seo_page_id}`} className="text-action hover:underline">{change.page_path}</Link>
                    <span>{label(change.change_type)} · {change.changed_on} · {change.changed_by_name}</span>
                  </div>
                  <p className="mt-1 text-muted">Before: {change.before_value ?? "Not recorded"} · After: {change.after_value ?? "Not recorded"}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : tab === "access" ? (
        <Card className="p-5 text-sm">
          <h2 className="font-semibold">Access for {access.user.display_name}</h2>
          <ul className="mt-3 space-y-2">
            <li>Role: {label(access.user.platform_role)}</li>
            <li>View clinics in this session: allowed.</li>
            <li>Edit SEO: {bundle ? (bundle.canEdit ? "Allowed" : "Not allowed") : "Choose a website to check edit permission."}</li>
            <li>Publish SEO settings: {site ? (canPublishClient(access, site.clientId) ? "Allowed" : "Not allowed") : "Choose a website to check publish permission."}</li>
            <li>Review: {site ? (canReviewClient(access, site.clientId) ? "Allowed" : "Not allowed") : "Choose a website to check review permission."}</li>
            <li>Manage website credentials: {canManageRegistry(access) ? "Allowed" : "Not allowed"}</li>
            <li>Export: {canExport(access) ? "Your role may export, but SEO export is not available." : "Not allowed."}</li>
          </ul>
          <p className="mt-4 text-muted">No scan, sync, reminder or notification schedule is configured. Usage limits are not metered.</p>
        </Card>
      ) : null}
    </SeoFrame>
  );
}
