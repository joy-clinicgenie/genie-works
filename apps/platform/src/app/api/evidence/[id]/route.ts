import { NextResponse } from "next/server";
import { canAccessClient, getEvidence, recordAudit } from "@clinic-genie/db";
import { getAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { readStoredFile } from "@/lib/storage";

/** Authorised retrieval only. A successful upload never makes a file public. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const item = await staffTx(access, async (db) => {
    const e = await getEvidence(db, id);
    if (!e) return null;
    if (!canAccessClient(access, e.client_id)) {
      await recordAudit(db, { actorType: "staff", actorUserId: access.user.id, action: "evidence.read", targetType: "evidence", targetId: id, clientId: e.client_id, outcome: "denied" });
      return null;
    }
    await recordAudit(db, { actorType: "staff", actorUserId: access.user.id, action: "evidence.read", targetType: "evidence", targetId: id, clientId: e.client_id, outcome: "success" });
    return e;
  });
  if (!item || item.kind !== "upload" || !item.storage_key) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await readStoredFile(item.storage_key);
  if (!bytes) return new Response("Not found", { status: 404 });
  const safeName = (item.original_name ?? "evidence").replace(/[^A-Za-z0-9._-]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": item.mime_type ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
