import Link from "next/link";
import { canEditClient, listActiveStaff, listArticles, listBlogWebsites, listClientsForRequest, scopeWorkspace, type BlogStatus } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { FilterBar, FilterInput, FilterSelect } from "@/components/ui/Filters";
import { InnerNavFrame, InnerNavGroup, InnerNavLink } from "@/components/shell/InnerNav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blog" };

const STATUS_LABEL: Record<BlogStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  published: "Published",
  archived: "Archived",
};
const STATUS_TONE: Record<BlogStatus, Tone> = {
  draft: "neutral",
  in_review: "warn",
  approved: "info",
  published: "good",
  archived: "neutral",
};
const REVISION_LABEL = {
  draft_revision: "Draft revision",
  revision_in_review: "Revision in review",
  approved_revision: "Approved revision",
} as const;
const FILTERS = ["all", "draft", "in_review", "approved", "published", "archived"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isStatus(value: string | undefined): value is BlogStatus {
  return value === "draft" || value === "in_review" || value === "approved" || value === "published" || value === "archived";
}

function stamp(value: Date | string | null, withTime = true) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}) }).format(new Date(value));
}

function queryHref(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `/blog?${query}` : "/blog";
}

export default async function BlogPage({ searchParams }: { searchParams: Promise<{ client?: string; website?: string; status?: string; author?: string; q?: string; sort?: string; page?: string }> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const status = isStatus(params.status) ? params.status : undefined;
  const page = Number(params.page) > 0 ? Number(params.page) : 1;
  const sort = params.sort === "published" ? "published" : "updated";
  const data = await staffTx(access, async (db) => {
    const websites = await listBlogWebsites(db);
    const clients = await listClientsForRequest(db, params.client);
    const selection = scopeWorkspace({
      requestedClientId: params.client,
      requestedWebsiteId: params.website,
      clients,
      websites: websites.map((site) => ({ id: site.id, clientId: site.client_id })),
    });
    const list = selection.websiteId
      ? await listArticles(db, {
          clientId: selection.clientId ?? undefined,
          websiteId: selection.websiteId,
          status,
          authorUserId: params.author && UUID.test(params.author) ? params.author : undefined,
          query: params.q,
          sort,
          page,
        })
      : null;
    return { list, websites, clients, staff: await listActiveStaff(db), selection };
  });
  const website = data.websites.find((site) => site.id === data.selection.websiteId);
  const canCreate = Boolean(website && canEditClient(access, website.client_id));
  const base = { client: data.selection.clientId ?? undefined, website: data.selection.websiteId ?? undefined, author: params.author, q: params.q, sort: sort === "published" ? "published" : undefined };
  const newHref = website ? `/blog/new?client=${website.client_id}&website=${website.id}` : "/blog";
  const clientsById = new Map(data.clients.map((client) => [client.id, client.name]));
  for (const site of data.websites) clientsById.set(site.client_id, site.client_name);
  const filtered = Boolean(params.q || params.author || status);
  const publicBlog = website?.url ? `${website.url.replace(/\/$/, "")}/blog` : null;

  return (
    <InnerNavFrame
      label="Article status"
      nav={
        <InnerNavGroup title="Status">
          {FILTERS.map((item) => {
            const count = data.list?.counts[item] ?? 0;
            const active = item === "all" ? !status : status === item;
            const name = item === "all" ? "All" : STATUS_LABEL[item];
            return (
              <InnerNavLink key={item} href={queryHref({ ...base, status: item === "all" ? undefined : item })} current={active}>
                <span className="flex w-full items-center justify-between gap-2"><span>{name}</span><span className="text-xs tabular-nums text-muted">{count}</span></span>
              </InnerNavLink>
            );
          })}
        </InnerNavGroup>
      }
    >
      <PageHeader title="Blog" description="Draft, review and publish articles for native clinic websites. Article performance is not part of this version." action={canCreate ? <LinkButton href={newHref}>+ New article</LinkButton> : undefined} />
      {data.selection.denied && <div className="mb-4"><Notice tone="neutral">That client is not available.</Notice></div>}
      {data.selection.websiteReplaced && <div className="mb-4"><Notice tone="neutral">That website is not part of the selected client.</Notice></div>}
      <FilterBar clearHref={queryHref({ client: base.client, website: base.website })}>
        {status && <input type="hidden" name="status" value={status} />}
        <FilterSelect name="client" label="Client" value={data.selection.clientId ?? undefined} allLabel="Choose a client" options={[...clientsById.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))} />
        <FilterSelect name="website" label="Website" value={data.selection.websiteId ?? undefined} allLabel="Choose a website" options={data.websites.filter((site) => !data.selection.clientId || site.client_id === data.selection.clientId).map((site) => ({ value: site.id, label: site.name }))} />
        <FilterSelect name="author" label="Author" value={params.author} allLabel="All authors" options={data.staff.map((person) => ({ value: person.id, label: person.display_name }))} />
        <FilterSelect name="sort" label="Sort" value={sort} allLabel="Last updated" options={[{ value: "updated", label: "Last updated" }, { value: "published", label: "Published on" }]} />
        <FilterInput name="q" label="Search title" value={params.q} placeholder="Article title" />
      </FilterBar>
      {!website && <EmptyState title="Select a client and website">Articles are listed for one website. Choose both above before creating an article.</EmptyState>}
      {website && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">{website.client_name} · {website.name}</p>
            {publicBlog && <a href={publicBlog} className="text-sm text-action underline" target="_blank" rel="noreferrer">Public blog</a>}
          </div>
          {data.list && data.list.total === 0 && !filtered && <EmptyState title="No articles yet" action={canCreate ? <LinkButton href={newHref}>Create first article</LinkButton> : undefined}>Articles you create for this website will appear here.</EmptyState>}
          {data.list && data.list.total === 0 && filtered && <EmptyState title="No articles found" action={<LinkButton href={queryHref({ client: base.client, website: base.website })} variant="secondary">Clear filters</LinkButton>}>Try another title, author or status.</EmptyState>}
          {data.list && data.list.articles.length > 0 && (
            <Card>
              <Table caption="Articles">
                <thead>
                  <tr>
                    <Th>Article</Th>
                    <Th>Client</Th>
                    <Th>Status</Th>
                    <Th>Author</Th>
                    <Th>Last updated</Th>
                    <Th>Published on</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.list.articles.map((article) => (
                    <tr key={article.id}>
                      <Td>
                        <Link href={`/blog/${article.id}`} className="font-medium text-action hover:underline">{article.title.trim() || "Untitled article"}</Link>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {article.current_version_id && <Link href={`/blog/${article.id}/preview?version=${article.current_version_id}`} className="text-xs text-action underline">Preview</Link>}
                          {article.status === "published" && publicBlog && article.live_slug && <a href={`${publicBlog}/${article.live_slug}`} className="text-xs text-action underline" target="_blank" rel="noreferrer">View live</a>}
                        </div>
                      </Td>
                      <Td>{article.client_name}</Td>
                      <Td>
                        <Badge tone={STATUS_TONE[article.status]}>{STATUS_LABEL[article.status]}</Badge>
                        {article.revision_indicator && <Badge tone="info" className="ml-2">{REVISION_LABEL[article.revision_indicator]}</Badge>}
                      </Td>
                      <Td>{article.author_name ?? "—"}</Td>
                      <Td>{stamp(article.updated_at)}</Td>
                      <Td>{stamp(article.first_published_at, false)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <p>Showing {(data.list.page - 1) * data.list.pageSize + 1}–{Math.min(data.list.page * data.list.pageSize, data.list.total)} of {data.list.total}</p>
                <div className="flex gap-2">
                  {data.list.page > 1 && <Link href={queryHref({ ...base, status, page: String(data.list.page - 1) })} className="text-action underline">Previous</Link>}
                  {data.list.page * data.list.pageSize < data.list.total && <Link href={queryHref({ ...base, status, page: String(data.list.page + 1) })} className="text-action underline">Next</Link>}
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </InnerNavFrame>
  );
}
