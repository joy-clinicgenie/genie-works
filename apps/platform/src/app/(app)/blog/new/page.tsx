import Link from "next/link";
import { canEditClient, listActiveStaff, listBlogWebsites, listClientsForRequest, scopeWorkspace } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { EmptyState } from "@/components/ui/Notice";
import { createArticleAction } from "@/app/actions/blog";
import { ArticleForm } from "@/components/modules/blog/ArticleForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "New article" };

export default async function NewArticlePage({ searchParams }: { searchParams: Promise<{ client?: string; website?: string }> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const data = await staffTx(access, async (db) => {
    const websites = await listBlogWebsites(db);
    const clients = await listClientsForRequest(db, params.client);
    const selection = scopeWorkspace({
      requestedClientId: params.client,
      requestedWebsiteId: params.website,
      clients,
      websites: websites.map((site) => ({ id: site.id, clientId: site.client_id })),
    });
    return { websites, staff: await listActiveStaff(db), selection };
  });
  const website = data.websites.find((site) => site.id === data.selection.websiteId);
  const allowed = Boolean(website && canEditClient(access, website.client_id));
  const editable = data.websites.filter((site) => canEditClient(access, site.client_id));
  const blocked = data.selection.denied || data.selection.websiteReplaced;
  const reviewers = data.staff.filter((person) => person.platform_role === "admin" || person.platform_role === "manager" || person.platform_role === "reviewer");
  const backHref = website ? `/blog?client=${website.client_id}&website=${website.id}` : "/blog";
  return (
    <>
      {blocked || (!allowed && editable.length === 0) ? (
        <EmptyState title="Select a website">An article needs a client and website before it can be created. <Link href="/blog" className="text-action underline">Return to Blog</Link>.</EmptyState>
      ) : (
        <div className="-mx-4 -mt-6 bg-surface lg:-mx-8 lg:-mt-8">
          <ArticleForm
            action={createArticleAction}
            websites={allowed && website ? data.websites : editable}
            people={data.staff}
            reviewers={reviewers}
            lockedClientId={allowed && website ? website.client_id : undefined}
            lockedWebsiteId={allowed && website ? website.id : undefined}
            backHref={backHref}
            context={website ? `${website.client_name} · ${website.name}` : undefined}
            titleHeading
          />
        </div>
      )}
    </>
  );
}
