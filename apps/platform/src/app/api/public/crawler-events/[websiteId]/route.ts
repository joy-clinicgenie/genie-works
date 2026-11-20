import { NextResponse } from "next/server";
import { crawlerTokenHash, ingestCrawlerBatch, type IncomingCrawlerEvent } from "@clinic-genie/db";
import { serviceTx } from "@/lib/db";

/*
 * SEO-05.3 (D63): a connected request-log feed posts AI crawler events for one website with its source token.
 * Body: { windowStart, windowEnd, events: [{ id, timestamp, userAgent, provider?, purpose?, path?, status? }] }.
 * Only ChatGPT, Gemini and Claude events are kept; everything else is counted as ignored and discarded.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_BYTES = 2 * 1024 * 1024;

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function POST(request: Request, { params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(request.headers.get("authorization") ?? "");
  if (!UUID.test(websiteId) || !match) return reply(404, { error: "Not found" });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BYTES) return reply(413, { error: "Batch too large" });
  const text = await request.text();
  if (text.length > MAX_BYTES) return reply(413, { error: "Batch too large" });
  let body: { windowStart?: unknown; windowEnd?: unknown; events?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: "Body must be JSON" });
  }
  if (typeof body.windowStart !== "string" || typeof body.windowEnd !== "string" || !Array.isArray(body.events)) {
    return reply(400, { error: "windowStart, windowEnd and events are required" });
  }
  try {
    const result = await serviceTx((db) => ingestCrawlerBatch(db, {
      tokenHash: crawlerTokenHash(match[1]!),
      websiteId,
      windowStart: body.windowStart as string,
      windowEnd: body.windowEnd as string,
      events: (body.events as unknown[]).filter((event): event is IncomingCrawlerEvent => Boolean(event) && typeof event === "object"),
    }));
    if (result === "unknown_source") return reply(404, { error: "Not found" });
    if (result === "invalid_window") return reply(400, { error: "The window must be valid, start before it ends and cover at most 31 days" });
    if (result === "too_many_events") return reply(413, { error: "At most 5000 events per batch" });
    return reply(200, result as unknown as Record<string, unknown>);
  } catch (error) {
    console.error("Crawler event ingestion unavailable", { name: error instanceof Error ? error.name : "UnknownError" });
    return reply(503, { error: "Temporarily unavailable" });
  }
}
