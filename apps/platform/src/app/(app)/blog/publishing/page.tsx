import Link from "next/link";
import { isAdmin, listEligiblePublishers, listPublishingAdmins, listWebsitePublishers } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { InnerNavFrame } from "@/components/shell/InnerNav";
import { BlogNav } from "@/components/modules/blog/BlogNav";
import { BlogScopeView } from "@/components/modules/blog/BlogScopeView";
import { PublishingAccessPanel } from "@/components/modules/blog/PublishingAccessPanel";
import { blogHref, resolveBlogScope } from "@/lib/blog-scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Publishing settings" };

function domain(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}

/** D87: Blog Overview → More actions → Publishing settings, for one website of the selected client. */
export default async function BlogPublishingSettingsPage({ searchParams }: { searchParams: Promise<{ client?: string; website?: string }> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const admin = isAdmin(access);
  const data = await staffTx(access, async (db) => {
    const scope = await resolveBlogScope(db, params);
    if (!scope.website) return { scope, publishers: null, eligible: [], admins: [] };
    return {
      scope,
      publishers: await listWebsitePublishers(db, scope.website.id),
      eligible: admin ? await listEligiblePublishers(db, scope.website.id) : [],
      admins: await listPublishingAdmins(db),
    };
  });
  const { scope } = data;
  const site = scope.website;
  const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);

  return (
    <InnerNavFrame label="Blog" nav={<BlogNav scope={scope} />}>
      <PageHeader title="Publishing settings" description="Who can release articles to a website." />
      <p className="-mt-4 mb-6 text-sm"><Link href={blogHref("/blog", scope)} className="text-action underline">Back to Overview</Link></p>
      {scope.denied && <div className="mb-4"><Notice tone="neutral">That client is not available.</Notice></div>}
      <BlogScopeView clients={scope.clients} clientId={scope.clientId}>
        {scope.client && scope.websites.length === 0 && <EmptyState title="No website for this client">This client has no active website.</EmptyState>}
        {scope.client && scope.multiple && !site && (
          <Card>
            <CardHeader title="Choose a website" description={`${scope.client.name} has more than one website. Publishing access is set for one website at a time.`} />
            <ul className="divide-y divide-line">
              {scope.websites.map((option) => (
                <li key={option.id} className="px-5 py-3 text-sm">
                  <Link href={blogHref("/blog/publishing", { clientId: scope.clientId, websiteId: option.id })} className="font-medium text-action hover:underline">{option.name}</Link>
                  {domain(option.url) && <span className="text-muted"> · {domain(option.url)}</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}
        {scope.client && site && data.publishers && (
          <div className="space-y-6" data-testid="publishing-settings" data-website={site.id}>
            <Card>
              <CardHeader title={<span data-testid="publishing-destination">{scope.client.name} · {site.name}{domain(site.url) ? ` · ${domain(site.url)}` : ""}</span>} description={site.platform} />
              <div className="space-y-2 px-5 pb-5 text-sm">
                {scope.multiple && <p><Link href={blogHref("/blog/publishing", { clientId: scope.clientId, websiteId: null })} className="text-action underline">Choose another website</Link></p>}
                <p><Badge tone="neutral">Website delivery not connected</Badge> <span className="text-muted">Ship to site, which delivers articles to the website and checks them there, is not available yet. Releasing to the content API leaves website publication unverified. Changing publishing access does not connect or test the website.</span></p>
              </div>
            </Card>
            <PublishingAccessPanel
              websiteId={site.id}
              websiteName={site.name}
              grants={data.publishers.active.map((row) => ({ ...row, granted_at: iso(row.granted_at)!, revoked_at: iso(row.revoked_at) }))}
              revoked={data.publishers.revoked.map((row) => ({ ...row, granted_at: iso(row.granted_at)!, revoked_at: iso(row.revoked_at) }))}
              eligible={data.eligible}
              admins={data.admins}
              canManage={admin}
            />
          </div>
        )}
      </BlogScopeView>
    </InnerNavFrame>
  );
}
