import { NextResponse } from "next/server";
import { SERVICE, drainMaintenance, withContext } from "@clinic-genie/db";
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
  const bearerLength = header?.startsWith("Bearer ") ? header.length - "Bearer ".length : 0;
  const workerSecretLength = process.env.ANALYTICS_WORKER_SECRET?.length ?? 0;
  const cronSecretLength = process.env.CRON_SECRET?.length ?? 0;
  // #region agent log
  fetch('http://127.0.0.1:7835/ingest/72ef6d47-30f8-4096-872c-0a56133bbce5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c3d738'},body:JSON.stringify({sessionId:'c3d738',runId:'auth-check',hypothesisId:'A',location:'worker/route.ts:16',message:'worker bearer lengths',data:{headerPresent:Boolean(header),bearerPrefix:header?.startsWith("Bearer ")??false,bearerLength,workerSecretSet:workerSecretLength>0,workerSecretLength,cronSecretSet:cronSecretLength>0,cronSecretLength,lengthMatchesWorker:bearerLength>0&&bearerLength===workerSecretLength,lengthMatchesCron:bearerLength>0&&bearerLength===cronSecretLength},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (!workerAuthorized(header)) {
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
