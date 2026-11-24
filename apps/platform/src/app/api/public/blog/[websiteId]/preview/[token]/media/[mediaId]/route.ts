import { getPreviewBlogMedia } from "@clinic-genie/db";
import { serviceTx } from "@/lib/db";
import { readEvidenceFile } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREVIEW = /^[A-Za-z0-9_-]{40,100}$/;

/** D86. An image used by the previewed revision only. */
export async function GET(request: Request, { params }: { params: Promise<{ websiteId: string; token: string; mediaId: string }> }) {
  const { websiteId, token, mediaId } = await params;
  const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(request.headers.get("authorization") ?? "");
  if (!UUID.test(websiteId) || !UUID.test(mediaId) || !PREVIEW.test(token) || !match) return new Response("Not found", { status: 404 });
  const media = await serviceTx((db) => getPreviewBlogMedia(db, websiteId, mediaId, match[1]!, token));
  if (!media) return new Response("Not found", { status: 404 });
  const bytes = await readEvidenceFile(media.storage_key);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": media.content_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
