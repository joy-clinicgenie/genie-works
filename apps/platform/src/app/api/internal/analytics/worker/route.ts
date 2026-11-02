import { NextResponse } from "next/server";
import { SERVICE, drainMaintenance, withContext } from "@clinic-genie/db";
import { providerFetch } from "@/lib/provider-fetch";
import { workerAuthorized } from "@/lib/analytics-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(request: Request) {
  if (!workerAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const outcome = await drainMaintenance((fn) => withContext(SERVICE, fn), {
    fetch: providerFetch(),
    now: new Date(),
    googleClientId: process.env.ANALYTICS_GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.ANALYTICS_GOOGLE_CLIENT_SECRET,
    wixAppId: process.env.ANALYTICS_WIX_APP_ID,
    wixAppSecret: process.env.ANALYTICS_WIX_APP_SECRET,
    pageSpeedKey: process.env.PAGESPEED_API_KEY,
  }, { owner: "http" });
  const worked = outcome.jobs > 0 || outcome.inspected > 0 || outcome.measured > 0;
  return NextResponse.json({ worked, jobs: outcome.jobs, inspected: outcome.inspected, measured: outcome.measured, result: outcome.result ?? null });
}

/** Vercel Cron calls this path with GET. POST remains available for a manual bearer call. */
export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}
