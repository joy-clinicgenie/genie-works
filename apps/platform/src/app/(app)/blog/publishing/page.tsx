import Link from "next/link";
import { getWebsiteConnection, isAdmin, listEligiblePublishers, listPublishingAdmins, listWebsitePublishers } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { InnerNavFrame } from "@/components/shell/InnerNav";
import { BlogNav } from "@/components/modules/blog/BlogNav";
import { BlogScopeView } from "@/components/modules/blog/BlogScopeView";
import { PublishingAccessPanel } from "@/components/modules/blog/PublishingAccessPanel";
import { WebsiteConnectionForm } from "@/components/modules/blog/WebsiteConnectionForm";
import { blogHref, resolveBlogScope } from "@/lib/blog-scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Publishing settings" };

function stamp(value: Date | string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

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
    if (!scope.website) return { scope, publishers: null, eligible: [], admins: [], connection: null, lastVerified: null };
    return {
      scope,
      publishers: await listWebsitePublishers(db, scope.website.id),
      eligible: admin ? await listEligiblePublishers(db, scope.website.id) : [],
      admins: await listPublishingAdmins(db),
      connection: await getWebsiteConnection(db, scope.website.id),
      lastVerified: (await db.query<{ at: Date | null }>("select max(verified_at) as at from blog_deliveries where website_id = $1 and state = 'verified'", [scope.website.id])).rows[0]?.at ?? null,
    };
  });
  const { scope } = data;
  const site = scope.website;
  const appOrigin = (process.env.AUTH_URL ?? "").replace(/\/$/, "") || "the Genie Works address";
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
                {!data.connection?.configured && <p><Badge tone="neutral">Website delivery not connected</Badge> <span className="text-muted">Ship to site needs the website connection below. Until then, releasing to the content API leaves website publication unverified. Changing publishing access does not connect or test the website.</span></p>}
                {data.connection?.configured && !data.lastVerified && <p><Badge tone="warn">Connection saved, not yet verified</Badge> <span className="text-muted">Saved {stamp(data.connection.secretSetAt)}. It is proven only when an article is shipped and verified on the website.</span></p>}
                {data.connection?.configured && data.lastVerified && <p><Badge tone="good">Verified delivery</Badge> <span className="text-muted">Last article verified on the website {stamp(data.lastVerified)}.</span></p>}
              </div>
            </Card>
            <Card>
              <CardHeader title="Website connection" description="What the website needs in its own deployment settings, and the blog route and publish secret Genie Works uses for Ship to site." />
              <dl className="grid gap-3 px-5 pb-4 text-sm sm:grid-cols-2">
                <div><dt className="text-muted">GENIE_WORKS_URL</dt><dd className="break-all font-mono text-xs">{appOrigin}</dd></div>
                <div><dt className="text-muted">GENIE_WORKS_WEBSITE_ID</dt><dd className="break-all font-mono text-xs" data-testid="website-id">{site.id}</dd></div>
                <div><dt className="text-muted">GENIE_WORKS_SITE_TOKEN</dt><dd>Issue it in SEO → Website connections for this website. It is shown once.</dd></div>
                <div><dt className="text-muted">GENIE_WORKS_PUBLISH_SECRET</dt><dd>{data.connection?.configured ? `Saved ${stamp(data.connection.secretSetAt)} (not shown)` : "Not saved"}</dd></div>
                <div><dt className="text-muted">Blog route</dt><dd>{data.connection?.basePath ?? "/blog"}</dd></div>
              </dl>
              {admin
                ? <WebsiteConnectionForm websiteId={site.id} websiteName={site.name} basePath={data.connection?.basePath ?? "/blog"} configured={Boolean(data.connection?.configured)} />
                : <p className="px-5 pb-5 text-sm text-muted">Only an administrator can change the website connection.</p>}
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
