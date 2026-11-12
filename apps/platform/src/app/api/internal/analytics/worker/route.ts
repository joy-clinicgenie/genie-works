import { NextResponse } from "next/server";
import { SERVICE, assertWorkerDatabase, drainMaintenance, withContext } from "@clinic-genie/db";
import { providerFetch } from "@/lib/provider-fetch";
import { workerAuthorized } from "@/lib/analytics-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const WORKER_BUDGET_MS = 90_000;

function jobLimit(): number {
  const parsed = Number(process.env.ANALYTICS_WORKER_JOB_LIMIT ?? "40");
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 40;
}

async function handle(request: Request) {
  const header = request.headers.get("authorization");
  if (!workerAuthorized(header)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Only the production deployment runs the worker against the production database (D54).
  try {
    assertWorkerDatabase(process.env.DATABASE_URL ?? "");
  } catch {
    return NextResponse.json({ error: "The worker is not allowed to use this database from this environment." }, { status: 409 });
  }
  const outcome = await drainMaintenance((fn) => withContext(SERVICE, fn), {
    fetch: providerFetch(),
    now: new Date(),
    googleClientId: process.env.ANALYTICS_GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.ANALYTICS_GOOGLE_CLIENT_SECRET,
    wixAppId: process.env.ANALYTICS_WIX_APP_ID,
    wixAppSecret: process.env.ANALYTICS_WIX_APP_SECRET,
    pageSpeedKey: process.env.PAGESPEED_API_KEY,
  }, { owner: "http", jobLimit: jobLimit(), budgetMs: WORKER_BUDGET_MS });
  const worked = outcome.jobs > 0 || outcome.inspected > 0 || outcome.measured > 0;
  return NextResponse.json({
    worked,
    enqueued: outcome.enqueued,
    jobs: outcome.jobs,
    succeeded: outcome.succeeded,
    failed: outcome.failed,
    retryScheduled: outcome.retryScheduled,
    reconnectRequired: outcome.reconnectRequired,
    stale: outcome.stale,
    inspected: outcome.inspected,
    measured: outcome.measured,
    result: outcome.result ?? null,
  });
}

/** Vercel Cron calls this path with GET. POST remains available for a manual bearer call. */
export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}
