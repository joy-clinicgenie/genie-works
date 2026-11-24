import Link from "next/link";
import { canEditClient, listActiveStaff, listBlogWebsites } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Card, CardHeader, PageHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Notice";
import { createArticleAction } from "@/app/actions/blog";
import { ArticleForm } from "@/components/modules/blog/ArticleForm";
import { blogHref, resolveBlogScope, safeBlogReturn } from "@/lib/blog-scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "New article" };

export default async function NewArticlePage({ searchParams }: { searchParams: Promise<{ client?: string; website?: string; return?: string }> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const data = await staffTx(access, async (db) => ({
    scope: await resolveBlogScope(db, params),
    websites: await listBlogWebsites(db),
    staff: await listActiveStaff(db),
  }));
  const { scope } = data;
  const backHref = safeBlogReturn(params.return) ?? blogHref("/blog/posts", scope);
  const reviewers = data.staff.filter((person) => person.platform_role === "admin" || person.platform_role === "manager" || person.platform_role === "reviewer");
  const editable = data.websites.filter((site) => canEditClient(access, site.client_id));
  const clientEditable = Boolean(scope.clientId && canEditClient(access, scope.clientId));

  if (scope.denied || (scope.clientId && (!clientEditable || scope.websites.length === 0)) || (!scope.clientId && editable.length === 0)) {
    return <EmptyState title="Select a website">An article needs a client and website you can edit. <Link href={backHref} className="text-action underline">Return to Blog</Link>.</EmptyState>;
  }

  // D87: from All websites, the destination website is chosen before writing.
  if (scope.clientId && scope.multiple && !scope.websiteId) {
    return (
      <>
        <PageHeader title="Create post" description={`${scope.client?.name ?? "Client"} has more than one website. Choose where this article will be published.`} />
        <Card>
          <CardHeader title="Destination website" />
          <ul className="divide-y divide-line">
            {scope.websites.map((site) => (
              <li key={site.id} className="px-5 py-3">
                <Link href={blogHref("/blog/new", { clientId: scope.clientId, websiteId: site.id }, { return: params.return ? backHref : undefined })} className="font-medium text-action hover:underline">{site.name}</Link>
                <span className="text-sm text-muted"> · {site.platform}{site.url ? ` · ${site.url.replace(/^https?:\/\//, "")}` : ""}</span>
              </li>
            ))}
          </ul>
          <div className="px-5 py-3"><Link href={backHref} className="text-sm text-action underline">Cancel</Link></div>
        </Card>
      </>
    );
  }

  const website = scope.website;
  return (
    <div className="-mx-4 -mt-6 bg-surface lg:-mx-8 lg:-mt-8">
      <ArticleForm
        action={createArticleAction}
        websites={website ? data.websites : editable}
        people={data.staff}
        reviewers={reviewers}
        lockedClientId={website?.client_id}
        lockedWebsiteId={website?.id}
        backHref={backHref}
        context={website ? `${website.client_name} · ${website.name}` : undefined}
        titleHeading
      />
    </div>
  );
}
