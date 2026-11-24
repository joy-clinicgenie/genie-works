import Link from "next/link";
import { BLOG_QUEUE_LABEL, BLOG_QUEUES, canEditClient, isBlogQueue, listActiveStaff, listArticles, type BlogStatus } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { FilterBar, FilterInput, FilterSelect } from "@/components/ui/Filters";
import { BlogClientFields } from "@/components/modules/blog/BlogClientFields";
import { BlogNav } from "@/components/modules/blog/BlogNav";
import { InnerNavFrame, InnerNavGroup, InnerNavLink } from "@/components/shell/InnerNav";
import { blogHref, resolveBlogScope } from "@/lib/blog-scope";
import { articleStatus, workingLabel } from "@/lib/blog-status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blog posts" };

const STATUS_LABEL: Record<BlogStatus, string> = { draft: "Draft", in_review: "In review", approved: "Approved", published: "Published", archived: "Archived" };
const FILTERS = ["all", "draft", "in_review", "approved", "published", "archived"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isStatus(value: string | undefined): value is BlogStatus {
  return value === "draft" || value === "in_review" || value === "approved" || value === "published" || value === "archived";
}

function stamp(value: Date | string | null, withTime = true) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}) }).format(new Date(value));
}

type Params = { client?: string; website?: string; status?: string; author?: string; q?: string; sort?: string; page?: string; queue?: string };

export default async function BlogPostsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const status = isStatus(params.status) ? params.status : undefined;
  const queue = isBlogQueue(params.queue) ? params.queue : undefined;
  const page = Number(params.page) > 0 ? Number(params.page) : 1;
  const sort = params.sort === "published" ? "published" : "updated";
  const author = params.author && UUID.test(params.author) ? params.author : undefined;
  const data = await staffTx(access, async (db) => {
    const scope = await resolveBlogScope(db, params);
    const list = scope.clientId && scope.websites.length > 0
      ? await listArticles(db, { clientId: scope.clientId, websiteId: scope.websiteId ?? undefined, status, queue, authorUserId: author, query: params.q, sort, page })
      : null;
    return { scope, list, staff: await listActiveStaff(db) };
  });
  const { scope } = data;
  const filters = { author, q: params.q, sort: sort === "published" ? "published" : undefined, queue };
  const listHref = (extra: Record<string, string | undefined> = {}) => blogHref("/blog/posts", scope, { ...filters, status, ...extra });
  // The address to come back to from an article: the list exactly as it was opened (keys in their original order).
  const kept = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && ["client", "website", "status", "queue", "author", "q", "sort", "page"].includes(key)) kept.set(key, value);
  }
  const currentHref = kept.size ? `/blog/posts?${kept.toString()}` : "/blog/posts";
  const canCreate = Boolean(scope.clientId && scope.websites.length > 0 && canEditClient(access, scope.clientId));
  const newHref = blogHref("/blog/new", scope, { return: currentHref });
  const filtered = Boolean(params.q || author || status || queue);
  const websiteNames = new Map(scope.websites.map((site) => [site.id, site.name]));
  const showWebsite = scope.multiple && !scope.websiteId;

  return (
    <InnerNavFrame
      label="Blog"
      nav={
        <BlogNav active="posts" scope={scope}>
          {data.list && (
            <InnerNavGroup title="Status">
              {FILTERS.map((item) => {
                const active = item === "all" ? !status : status === item;
                return (
                  <InnerNavLink key={item} href={listHref({ status: item === "all" ? undefined : item })} current={active}>
                    <span className="flex w-full items-center justify-between gap-2"><span>{item === "all" ? "All" : STATUS_LABEL[item]}</span><span className="text-xs tabular-nums text-muted">{data.list!.counts[item]}</span></span>
                  </InnerNavLink>
                );
              })}
            </InnerNavGroup>
          )}
        </BlogNav>
      }
    >
      <PageHeader title="Posts" description="Every article for the selected client. Open an article to write, review or publish it." action={canCreate ? <LinkButton href={newHref}>Create post</LinkButton> : undefined} />
      {scope.denied && <div className="mb-4"><Notice tone="neutral">That client is not available.</Notice></div>}
      {scope.websiteReplaced && scope.clientId && <div className="mb-4"><Notice tone="neutral">That website does not belong to this client. Showing {scope.website ? scope.website.name : "all of its websites"}.</Notice></div>}
      <FilterBar formKey={`${scope.clientId ?? ""}:${scope.websiteId ?? ""}`} clearHref={blogHref("/blog/posts", scope)}>
        {status && <input type="hidden" name="status" value={status} />}
        <BlogClientFields
          path="/blog/posts"
          clients={scope.clients.map((client) => ({ value: client.id, label: client.label }))}
          websites={scope.websites.map((site) => ({ id: site.id, name: site.name, clientId: site.client_id }))}
          clientId={scope.clientId ?? undefined}
          websiteId={scope.websiteId ?? undefined}
          allWebsites={scope.multiple}
        />
        <FilterSelect name="queue" label="Queue" value={queue} allLabel="Any queue" options={BLOG_QUEUES.map((value) => ({ value, label: BLOG_QUEUE_LABEL[value] }))} />
        <FilterSelect name="author" label="Author" value={author} allLabel="All authors" options={data.staff.map((person) => ({ value: person.id, label: person.display_name }))} />
        <FilterSelect name="sort" label="Sort" value={sort} allLabel="Last updated" options={[{ value: "updated", label: "Last updated" }, { value: "published", label: "Published on" }]} />
        <FilterInput name="q" label="Search title" value={params.q} placeholder="Article title" />
      </FilterBar>
      {!scope.clientId && <EmptyState title="Choose a client">Choose a client to list its articles.</EmptyState>}
      {scope.clientId && scope.websites.length === 0 && <EmptyState title="No website for this client">This client has no active website.</EmptyState>}
      {data.list && (
        <>
          <p className="mb-4 text-sm text-muted" data-testid="posts-total">
            {scope.client?.name} · {scope.website ? scope.website.name : "All websites"} · {data.list.total === 1 ? "1 article" : `${data.list.total} articles`}{queue ? ` in ${BLOG_QUEUE_LABEL[queue]}` : ""}
          </p>
          {data.list.total === 0 && !filtered && <EmptyState title="No articles yet" action={canCreate ? <LinkButton href={newHref}>Create post</LinkButton> : undefined}>Articles you create for this client will appear here.</EmptyState>}
          {data.list.total === 0 && filtered && <EmptyState title="No articles found" action={<LinkButton href={blogHref("/blog/posts", scope)} variant="secondary">Clear filters</LinkButton>}>Try another queue, title, author or status.</EmptyState>}
          {data.list.articles.length > 0 && (
            <Card>
              <Table caption="Articles">
                <thead>
                  <tr>
                    <Th>Article</Th>
                    {showWebsite && <Th>Website</Th>}
                    <Th>Status</Th>
                    <Th>Author</Th>
                    <Th>Last updated</Th>
                    <Th>Published on</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.list.articles.map((article) => {
                    const label = articleStatus(article);
                    const working = workingLabel(article);
                    return (
                      <tr key={article.id}>
                        <Td>
                          <Link href={`/blog/${article.id}?return=${encodeURIComponent(currentHref)}`} className="font-medium text-action hover:underline">{article.title.trim() || "Untitled article"}</Link>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {article.current_version_id && <Link href={`/blog/${article.id}/preview?version=${article.current_version_id}`} className="text-xs text-action underline">Preview</Link>}
                          </div>
                        </Td>
                        {showWebsite && <Td>{websiteNames.get(article.website_id) ?? article.website_name}</Td>}
                        <Td>
                          <Badge tone={label.tone}>{label.label}</Badge>
                          {working && <Badge tone="info" className="ml-2">{working}</Badge>}
                        </Td>
                        <Td>{article.author_name ?? "—"}</Td>
                        <Td>{stamp(article.updated_at)}</Td>
                        <Td>{stamp(article.first_published_at, false)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <p>Showing {(data.list.page - 1) * data.list.pageSize + 1}–{Math.min(data.list.page * data.list.pageSize, data.list.total)} of {data.list.total}</p>
                <div className="flex gap-2">
                  {data.list.page > 1 && <Link href={listHref({ page: data.list.page - 1 > 1 ? String(data.list.page - 1) : undefined })} className="text-action underline">Previous</Link>}
                  {data.list.page * data.list.pageSize < data.list.total && <Link href={listHref({ page: String(data.list.page + 1) })} className="text-action underline">Next</Link>}
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </InnerNavFrame>
  );
}
