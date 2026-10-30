import { canAccessClient, getArticleMediaFile, recordAudit } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { readEvidenceFile } from "@/lib/storage";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireAccess();
  const media = await staffTx(access, (db) => getArticleMediaFile(db, id));
  if (!media || !canAccessClient(access, media.client_id)) {
    return new Response("Not found", { status: 404 });
  }
  await staffTx(access, (db) => recordAudit(db, { actorType: "staff", actorUserId: access.user.id, action: "blog.media.read", targetType: "blog_media", targetId: id, clientId: media.client_id, outcome: "success" }));
  const bytes = await readEvidenceFile(media.storage_key);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": media.content_type,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
