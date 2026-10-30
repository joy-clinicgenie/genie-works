import { getPublishedBlog, type PublishedBlog } from "@clinic-genie/db";
import { serviceTx } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const BLOG_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  Vary: "Authorization",
};

/** Loads the live published revision. A missing or revoked token is indistinguishable from a missing site. */
export async function readPublishedBlog(request: Request, websiteId: string): Promise<PublishedBlog | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(authorization);
  if (!UUID.test(websiteId) || !match) return null;
  return serviceTx((db) => getPublishedBlog(db, websiteId, match[1]!));
}
