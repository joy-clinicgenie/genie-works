import { renderPublishedSitemap } from "@clinic-genie/db";
import { BLOG_PRIVATE_HEADERS, readPublishedBlog } from "@/lib/public-blog";

/** Sitemap of indexable live articles only. Preview links and unpublished revisions are omitted. */
export async function GET(request: Request, { params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  try {
    const published = await readPublishedBlog(request, websiteId);
    if (!published) return new Response("Not found", { status: 404, headers: BLOG_PRIVATE_HEADERS });
    const xml = renderPublishedSitemap(published.articles, published.origin);
    return new Response(xml, { headers: { ...BLOG_PRIVATE_HEADERS, "Content-Type": "application/xml; charset=utf-8" } });
  } catch (error) {
    console.error("Blog sitemap unavailable", { name: error instanceof Error ? error.name : "UnknownError" });
    return new Response("Published articles are temporarily unavailable", { status: 503, headers: { ...BLOG_PRIVATE_HEADERS, "Retry-After": "10" } });
  }
}
