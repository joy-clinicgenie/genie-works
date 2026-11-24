import { NextResponse } from "next/server";
import { getPreviewBlogArticle } from "@clinic-genie/db";
import { serviceTx } from "@/lib/db";
import { BLOG_PRIVATE_HEADERS } from "@/lib/public-blog";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREVIEW = /^[A-Za-z0-9_-]{40,100}$/;

/** D86. One saved revision for the website's private preview. Needs the site token and a live preview token. */
export async function GET(request: Request, { params }: { params: Promise<{ websiteId: string; token: string }> }) {
  const { websiteId, token } = await params;
  const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(request.headers.get("authorization") ?? "");
  if (!UUID.test(websiteId) || !PREVIEW.test(token) || !match) return NextResponse.json({ error: "Not found" }, { status: 404, headers: BLOG_PRIVATE_HEADERS });
  try {
    const article = await serviceTx((db) => getPreviewBlogArticle(db, websiteId, match[1]!, token));
    if (!article) return NextResponse.json({ error: "Not found" }, { status: 404, headers: BLOG_PRIVATE_HEADERS });
    return NextResponse.json({ layout: "clinic-article-v1", article }, { headers: BLOG_PRIVATE_HEADERS });
  } catch (error) {
    console.error("Blog preview API unavailable", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Preview is temporarily unavailable" }, { status: 503, headers: { ...BLOG_PRIVATE_HEADERS, "Retry-After": "10" } });
  }
}
