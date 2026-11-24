import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { EmptyState } from "@/components/ui/Notice";
import { BlogSection } from "@/components/modules/blog/BlogSection";
import { resolveBlogScope } from "@/lib/blog-scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blog tags" };

export default async function BlogTagsPage({ searchParams }: { searchParams: Promise<{ client?: string; website?: string }> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const scope = await staffTx(access, (db) => resolveBlogScope(db, params));
  return (
    <BlogSection active="tags" title="Tags" description="Tags group related articles." scope={scope}>
      <EmptyState title="Tags are not available yet">Articles do not have tags in this version. Adding and managing tags comes in a later step.</EmptyState>
    </BlogSection>
  );
}
