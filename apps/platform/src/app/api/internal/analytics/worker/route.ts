import { NextResponse } from "next/server";
import { SERVICE, assertFixtureFetch, runWorkerOnce, withContext } from "@clinic-genie/db";
import { workerAuthorized } from "@/lib/analytics-worker";

export const dynamic = "force-dynamic";

async function handle(request: Request) {
  if (!workerAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const outcome = await withContext(SERVICE, (db) => runWorkerOnce(db, "http", {
    fetch: async (url, init) => {
      assertFixtureFetch(url);
      const response = await fetch(url, init);
      return { status: response.status, headers: response.headers, json: () => response.json(), text: () => response.text() };
    },
    now: new Date(),
    googleClientId: process.env.ANALYTICS_GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.ANALYTICS_GOOGLE_CLIENT_SECRET,
    wixAppId: process.env.ANALYTICS_WIX_APP_ID,
    wixAppSecret: process.env.ANALYTICS_WIX_APP_SECRET,
  }));
  return NextResponse.json({ worked: outcome.worked, result: outcome.result ?? null });
}

/** Vercel Cron calls this path with GET. POST remains available for a manual bearer call. */
export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}
