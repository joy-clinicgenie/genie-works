import Link from "next/link";
import { redirect } from "next/navigation";
import { BLOG_QUEUE_LABEL, BLOG_QUEUES, canEditClient, countArticleQueues, listArticles } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card, CardHeader } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { InnerNavFrame } from "@/components/shell/InnerNav";
import { BlogNav } from "@/components/modules/blog/BlogNav";
import { BlogScopeView } from "@/components/modules/blog/BlogScopeView";
import { POSTS_ONLY_PARAMS, blogHref, resolveBlogScope } from "@/lib/blog-scope";
import { articleStatus, workingLabel } from "@/lib/blog-status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blog" };

function stamp(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function BlogOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  // Bookmarks of the old /blog register (status, author, search, sort, page) keep their destination.
  if (POSTS_ONLY_PARAMS.some((key) => params[key])) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
    redirect(`/blog/posts?${search.toString()}`);
  }
  const access = await requireAccess();
  const data = await staffTx(access, async (db) => {
    const scope = await resolveBlogScope(db, params);
    if (!scope.clientId || scope.websites.length === 0) return { scope, queues: null, recent: null };
    const filter = { clientId: scope.clientId, websiteId: scope.websiteId };
    return {
      scope,
      queues: await countArticleQueues(db, filter),
      recent: await listArticles(db, { clientId: scope.clientId, websiteId: scope.websiteId ?? undefined, sort: "updated", pageSize: 5 }),
    };
  });
  const { scope } = data;
  const overviewHref = blogHref("/blog", scope);
  const canCreate = Boolean(scope.clientId && scope.websites.length > 0 && canEditClient(access, scope.clientId));
  // From All websites the destination is chosen first (D87); a single website is the destination.
  const createHref = blogHref("/blog/new", scope, { return: overviewHref });
  const websiteNames = new Map(scope.websites.map((site) => [site.id, site.name]));
  const showWebsite = scope.multiple && !scope.websiteId;

  return (
    <InnerNavFrame label="Blog" nav={<BlogNav active="overview" scope={scope} />}>
      <PageHeader title="Blog" description="Choose a client to see its articles, review queues and publishing." />
      {scope.denied && <div className="mb-4"><Notice tone="neutral">That client is not available.</Notice></div>}
      <BlogScopeView clients={scope.clients} clientId={scope.clientId}>
        {scope.client && (
          <div className="space-y-6" data-testid="blog-overview" data-client={scope.client.id}>
            <Card>
              <CardHeader
                title={scope.client.name}
                description={scope.websites.length === 0 ? "This client has no active website." : scope.multiple ? `${scope.websites.length} websites` : scope.websites[0]!.name}
                action={
                  <span className="flex flex-wrap items-center gap-2">
                    {canCreate && <LinkButton href={createHref}>Create post</LinkButton>}
                    {scope.websites.length > 0 && (
                      <details className="relative">
                        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-full border border-line px-4 text-sm font-medium hover:bg-brand-pale">More actions</summary>
                        <ul className="absolute right-0 z-40 mt-1 min-w-52 overflow-hidden rounded-2xl bg-surface py-1 text-ink shadow-pop">
                          <li><Link href={blogHref("/blog/publishing", scope)} className="block px-3 py-2 text-sm hover:bg-brand-pale">Publishing settings</Link></li>
                        </ul>
                      </details>
                    )}
                  </span>
                }
              />
              {scope.websites.length > 0 && (
                <div className="space-y-3 px-5 pb-5 text-sm">
                  <ul className="space-y-1">
                    {scope.websites.map((site) => (
                      <li key={site.id}>{site.name} · {site.platform}{site.url ? <> · <a href={site.url} className="text-action underline" target="_blank" rel="noreferrer">{site.url.replace(/^https?:\/\//, "")}</a></> : null}</li>
                    ))}
                  </ul>
                  {scope.multiple && (
                    <nav aria-label="Website" className="flex flex-wrap gap-2">
                      <Link href={blogHref("/blog", { clientId: scope.clientId, websiteId: null })} aria-current={!scope.websiteId ? "page" : undefined} className={`rounded-full px-3 py-1 ${!scope.websiteId ? "bg-brand-pale font-medium" : "text-action underline"}`}>All websites</Link>
                      {scope.websites.map((site) => (
                        <Link key={site.id} href={blogHref("/blog", { clientId: scope.clientId, websiteId: site.id })} aria-current={scope.websiteId === site.id ? "page" : undefined} className={`rounded-full px-3 py-1 ${scope.websiteId === site.id ? "bg-brand-pale font-medium" : "text-action underline"}`}>{site.name}</Link>
                      ))}
                    </nav>
                  )}
                  {scope.websiteReplaced && <Notice tone="neutral">That website does not belong to this client. Showing {scope.website ? scope.website.name : "all of its websites"}.</Notice>}
                </div>
              )}
            </Card>

            {data.queues && (
              <section aria-label="Queues" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {BLOG_QUEUES.map((queue) => (
                  <Link key={queue} href={blogHref("/blog/posts", scope, { queue })} className="rounded-2xl border border-line bg-surface p-4 hover:bg-brand-pale/40" data-testid={`queue-${queue}`}>
                    <span className="block text-sm text-muted">{BLOG_QUEUE_LABEL[queue]}</span>
                    <span className="mt-1 block text-3xl font-semibold tabular-nums" data-count>{data.queues![queue]}</span>
                  </Link>
                ))}
              </section>
            )}

            {data.recent && (
              <Card>
                <CardHeader title="Recently updated" description={showWebsite ? "Across all websites" : scope.website?.name} action={<Link href={blogHref("/blog/posts", scope)} className="text-sm text-action underline">All posts</Link>} />
                {data.recent.articles.length === 0
                  ? <div className="px-5 pb-5"><EmptyState title="No articles yet" action={canCreate ? <LinkButton href={createHref}>Create post</LinkButton> : undefined}>Articles for this client will appear here.</EmptyState></div>
                  : (
                    <Table caption="Recently updated articles">
                      <thead><tr><Th>Article</Th>{showWebsite && <Th>Website</Th>}<Th>Status</Th><Th>Last updated</Th></tr></thead>
                      <tbody>
                        {data.recent.articles.map((article) => {
                          const label = articleStatus(article);
                          const working = workingLabel(article);
                          return (
                            <tr key={article.id}>
                              <Td><Link href={`/blog/${article.id}?return=${encodeURIComponent(overviewHref)}`} className="font-medium text-action hover:underline">{article.title.trim() || "Untitled article"}</Link></Td>
                              {showWebsite && <Td>{websiteNames.get(article.website_id) ?? article.website_name}</Td>}
                              <Td><Badge tone={label.tone}>{label.label}</Badge>{working && <Badge tone="info" className="ml-2">{working}</Badge>}</Td>
                              <Td>{stamp(article.updated_at)}</Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  )}
              </Card>
            )}

            <Card>
              <CardHeader title="Analytics" action={<Link href={blogHref("/blog/analytics", scope)} className="text-sm text-action underline">Open Analytics</Link>} />
              <p className="px-5 pb-5 text-sm"><Badge tone="neutral">Analytics not connected</Badge> <span className="text-muted">Article views and enquiries appear here once measurement is connected for this client&apos;s blog.</span></p>
            </Card>
          </div>
        )}
      </BlogScopeView>
    </InnerNavFrame>
  );
}
