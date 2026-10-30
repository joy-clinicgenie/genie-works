import { NextResponse } from "next/server";
import { getPublishedSeoConfiguration } from "@clinic-genie/db";
import { serviceTx } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, { params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(authorization);
  if (!UUID.test(websiteId) || !match) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: PRIVATE_HEADERS });
  }

  try {
    const config = await serviceTx((db) => getPublishedSeoConfiguration(db, websiteId, match[1]!));
    if (!config) return NextResponse.json({ error: "Not found" }, { status: 404, headers: PRIVATE_HEADERS });
    return NextResponse.json(config, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error("SEO settings API unavailable", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "SEO settings are temporarily unavailable" }, { status: 503, headers: { ...PRIVATE_HEADERS, "Retry-After": "10" } });
  }
}
