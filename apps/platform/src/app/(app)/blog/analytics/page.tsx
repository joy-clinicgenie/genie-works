import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { EmptyState } from "@/components/ui/Notice";
import { BlogSection } from "@/components/modules/blog/BlogSection";
import { resolveBlogScope } from "@/lib/blog-scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blog analytics" };

export default async function BlogAnalyticsPage({ searchParams }: { searchParams: Promise<{ client?: string; website?: string }> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const scope = await staffTx(access, (db) => resolveBlogScope(db, params));
  return (
    <BlogSection active="analytics" title="Analytics" description="How this client's articles perform." scope={scope}>
      <EmptyState title="Analytics not connected">Blog reporting is activated when measurement is connected for this client&apos;s blog. No figures are shown until then.</EmptyState>
    </BlogSection>
  );
}
