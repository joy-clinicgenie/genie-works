import { renderPublishedIndex } from "@clinic-genie/db";
import { BLOG_PRIVATE_HEADERS, readPublishedBlog } from "@/lib/public-blog";

/** Local native listing. The clinic site origin is the canonical URL. This host is not indexed. */
export async function GET(request: Request, { params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  try {
    const published = await readPublishedBlog(request, websiteId);
    if (!published) return new Response("Not found", { status: 404, headers: BLOG_PRIVATE_HEADERS });
    const html = renderPublishedIndex(published.articles, published.origin, `/api/public/blog/${websiteId}/page`, `/api/public/blog/${websiteId}/media`);
    return new Response(html, { headers: { ...BLOG_PRIVATE_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
  } catch (error) {
    console.error("Blog page unavailable", { name: error instanceof Error ? error.name : "UnknownError" });
    return new Response("Published articles are temporarily unavailable", { status: 503, headers: { ...BLOG_PRIVATE_HEADERS, "Retry-After": "10" } });
  }
}
