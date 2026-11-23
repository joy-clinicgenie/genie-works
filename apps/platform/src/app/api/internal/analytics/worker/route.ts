import { NextResponse } from "next/server";
import { SERVICE, assertWorkerDatabase, budgetFromEnv, drainMaintenance, jobLimitFromEnv, maxConcurrentFromEnv, recordingFromEnv, withContext } from "@clinic-genie/db";
import { providerFetch } from "@/lib/provider-fetch";
import { workerAuthorized } from "@/lib/analytics-worker";

export const dynamic = "force-dynamic";
// Hobby allows up to 300 s with fluid compute (Vercel documentation, checked 13 Nov 2026). The working
// budget (ANALYTICS_WORKER_BUDGET_MS, default 90 s, at most 240 s) always ends well inside this ceiling,
// and the worker stops starting jobs 25 s before the budget ends, so the platform never cuts a run off
// mid-store.
export const maxDuration = 300;

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
  }, {
    owner: "http",
    // Vercel Schedules sends `vercel-cron/1.0`. Anything else is a manual bearer call.
    trigger: (request.headers.get("user-agent") ?? "").startsWith("vercel-cron") ? "schedule" : "manual",
    jobLimit: jobLimitFromEnv(),
    budgetMs: budgetFromEnv(),
    maxConcurrent: maxConcurrentFromEnv(),
    record: recordingFromEnv(),
  });
  const worked = outcome.jobs > 0 || outcome.inspected > 0 || outcome.measured > 0;
  return NextResponse.json({
    worked,
    stopped: outcome.stopped ?? null,
    enqueued: outcome.enqueued,
    jobs: outcome.jobs,
    succeeded: outcome.succeeded,
    failed: outcome.failed,
    retryScheduled: outcome.retryScheduled,
    reconnectRequired: outcome.reconnectRequired,
    notConfigured: outcome.notConfigured,
    stale: outcome.stale,
    inspected: outcome.inspected,
    measured: outcome.measured,
    result: outcome.result ?? null,
    remainingDue: outcome.remaining?.due ?? null,
    remainingWaiting: outcome.remaining?.waiting ?? null,
    durationMs: outcome.durationMs ?? null,
  });
}

/** Vercel Cron calls this path with GET. POST remains available for a manual bearer call. */
export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}
