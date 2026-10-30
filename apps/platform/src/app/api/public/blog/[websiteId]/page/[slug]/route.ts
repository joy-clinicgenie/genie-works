import { renderPublishedArticle } from "@clinic-genie/db";
import { BLOG_PRIVATE_HEADERS, readPublishedBlog } from "@/lib/public-blog";

/** Local native article. Unpublished and unknown slugs are not found. Drafts are not in the published set. */
export async function GET(request: Request, { params }: { params: Promise<{ websiteId: string; slug: string }> }) {
  const { websiteId, slug } = await params;
  try {
    const published = await readPublishedBlog(request, websiteId);
    const article = published?.articles.find((item) => item.slug === slug);
    if (!published || !article) return new Response("Not found", { status: 404, headers: BLOG_PRIVATE_HEADERS });
    const html = renderPublishedArticle(article, published.origin, `/api/public/blog/${websiteId}/media`);
    return new Response(html, { headers: { ...BLOG_PRIVATE_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
  } catch (error) {
    console.error("Blog article unavailable", { name: error instanceof Error ? error.name : "UnknownError" });
    return new Response("Published articles are temporarily unavailable", { status: 503, headers: { ...BLOG_PRIVATE_HEADERS, "Retry-After": "10" } });
  }
}
