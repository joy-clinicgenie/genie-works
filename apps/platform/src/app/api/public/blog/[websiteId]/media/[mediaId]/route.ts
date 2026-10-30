import { getPublishedBlogMedia } from "@clinic-genie/db";
import { serviceTx } from "@/lib/db";
import { readEvidenceFile } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ websiteId: string; mediaId: string }> }) {
  const { websiteId, mediaId } = await params;
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(authorization);
  if (!UUID.test(websiteId) || !UUID.test(mediaId) || !match) return new Response("Not found", { status: 404 });
  const media = await serviceTx((db) => getPublishedBlogMedia(db, websiteId, mediaId, match[1]!));
  if (!media) return new Response("Not found", { status: 404 });
  const bytes = await readEvidenceFile(media.storage_key);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": media.content_type,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
