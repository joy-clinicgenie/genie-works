import { getArticlePreview, listArticleMedia } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { ArticleLayout } from "@/components/modules/blog/ArticleLayout";

export const dynamic = "force-dynamic";
export const metadata = { title: "Article preview", robots: { index: false, follow: false } };

export default async function ArticlePreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const access = await requireAccess();
  const article = await staffTx(access, async (db) => {
    const preview = await getArticlePreview(db, token);
    if (!preview) return null;
    const media = await listArticleMedia(db, preview.id);
    return { preview, mediaIds: new Set(media.map((item) => item.id)) };
  });
  if (!article) {
    return (
      <>
        <PageHeader title="Preview unavailable" />
        <Notice tone="warn" title="This preview cannot be opened">The link has expired or been revoked, or you do not have access to this client.</Notice>
      </>
    );
  }
  return (
    <>
      <PageHeader eyebrow="Protected preview" title={article.preview.title} description={`${article.preview.client_name} · ${article.preview.website_name} · version ${article.preview.version_number ?? "current"} · not a public page · layout clinic-article-v1`} />
      <ArticleLayout title={article.preview.title} category={article.preview.category} body={article.preview.body} imageSrc={(mediaId) => article.mediaIds.has(mediaId) ? `/api/blog-media/${mediaId}` : ""} />
    </>
  );
}
