import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticle, getArticleVersion, listArticleMedia } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { ArticleLayout } from "@/components/modules/blog/ArticleLayout";
import { PreviewFrame } from "@/components/modules/blog/PreviewFrame";

export const dynamic = "force-dynamic";
export const metadata = { title: "Article preview", robots: { index: false, follow: false } };

function stamp(value: Date | string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium" }).format(new Date(value));
}

export default async function ArticleVersionPreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const access = await requireAccess();
  const data = await staffTx(access, async (db) => {
    const article = await getArticle(db, id);
    if (!article) return null;
    const versionId = query.version || article.current_version_id;
    if (!versionId) return { article, version: null, media: [] as { id: string; alt_text: string }[] };
    const version = await getArticleVersion(db, id, versionId);
    const media = await listArticleMedia(db, id);
    return { article, version, media };
  });
  if (!data) notFound();
  if (!data.version) {
    return (
      <>
        <PageHeader title="Preview unavailable" />
        <Notice tone="warn" title="Save the article first">This preview shows a saved version. Unsaved typing is not included.</Notice>
      </>
    );
  }
  const featured = data.media.find((item) => item.id === data.version?.featured_media_id);
  return (
    <>
      <PageHeader
        eyebrow="Preview"
        title={data.version.title.trim() || "Untitled article"}
        description={`${data.article.client_name} · ${data.article.website_name} · version ${data.version.version_number} · not a public page`}
        action={<Link href={`/blog/${data.article.id}`} className="text-sm text-action underline">Back to editor</Link>}
      />
      <div className="mb-4"><Notice tone="info">This is a saved version. Unsaved changes in the editor are not shown here.</Notice></div>
      <PreviewFrame>
        <ArticleLayout
          title={data.version.title}
          excerpt={data.version.excerpt}
          category={data.version.category}
          author={data.version.author_name}
          publishedOn={stamp(data.article.first_published_at)}
          featuredSrc={featured ? `/api/blog-media/${featured.id}` : null}
          featuredAlt={featured?.alt_text}
          body={data.version.body}
          imageSrc={(mediaId) => data.media.some((item) => item.id === mediaId) ? `/api/blog-media/${mediaId}` : ""}
        />
      </PreviewFrame>
    </>
  );
}
