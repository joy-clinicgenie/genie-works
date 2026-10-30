import { NextResponse } from "next/server";
import { bearerMatches, runWorkerOnce, SERVICE, withContext, assertFixtureFetch } from "@clinic-genie/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!bearerMatches(request.headers.get("authorization"), process.env.ANALYTICS_WORKER_SECRET)) {
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
