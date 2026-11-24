import { listArticleCategories } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { Table, Td, Th } from "@/components/ui/Table";
import { BlogSection } from "@/components/modules/blog/BlogSection";
import { resolveBlogScope } from "@/lib/blog-scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blog categories" };

export default async function BlogCategoriesPage({ searchParams }: { searchParams: Promise<{ client?: string; website?: string }> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const data = await staffTx(access, async (db) => {
    const scope = await resolveBlogScope(db, params);
    const categories = scope.clientId && scope.websites.length > 0 ? await listArticleCategories(db, { clientId: scope.clientId, websiteId: scope.websiteId }) : [];
    return { scope, categories };
  });
  return (
    <BlogSection active="categories" title="Categories" description="Categories used by this client's articles." scope={data.scope}>
      <div className="mb-4"><Notice tone="neutral" title="Category management is not available yet">This list shows the categories already typed on articles. Creating, renaming and archiving categories comes in a later step. Set an article&apos;s category in its Settings panel.</Notice></div>
      {data.categories.length === 0
        ? <EmptyState title="No categories yet">No article for this client has a category.</EmptyState>
        : (
          <Card>
            <Table caption="Categories in use">
              <thead><tr><Th>Category</Th><Th>Articles</Th></tr></thead>
              <tbody>{data.categories.map((row) => <tr key={row.category}><Td>{row.category}</Td><Td>{row.articles}</Td></tr>)}</tbody>
            </Table>
          </Card>
        )}
    </BlogSection>
  );
}
