import { NextResponse } from "next/server";
import {
  PilotError, SERVICE, assertWorkerDatabase, budgetFromEnv, maxConcurrentFromEnv, parseAllowList, parsePilotRequest, recordingFromEnv,
  runPilotProbe, runPilotSync, withContext, withReadOnlyContext,
} from "@clinic-genie/db";
import { providerFetch } from "@/lib/provider-fetch";
import { workerAuthorized } from "@/lib/analytics-worker";

export const dynamic = "force-dynamic";
// A pilot is at most 12 jobs inside a 90 second budget; this leaves room for the platform to finish storing.
export const maxDuration = 120;

const MAX_BODY_BYTES = 2048;

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Controlled one-connection pilot (connection recovery, C2). POST only.
 *
 * Same bearer as the worker (`ANALYTICS_WORKER_SECRET` or `CRON_SECRET`). The connection must be named by its
 * eight-character reference AND appear in `ANALYTICS_PILOT_ALLOWED_CONNECTIONS`; with that variable unset the route does
 * nothing. `probe` only proves the credentials, in a read-only transaction. `run` synchronises that one connection over a
 * small fixed window and cannot lease, reap or read anything that belongs to another connection.
 *
 * Nothing in a response names a token, key, property, site or client.
 */
export async function POST(request: Request) {
  if (!workerAuthorized(request.headers.get("authorization"))) return json({ error: "Unauthorized" }, 401);
  try {
    assertWorkerDatabase(process.env.DATABASE_URL ?? "");
  } catch {
    return json({ error: "The pilot is not allowed to use this database from this environment." }, 409);
  }
  const allowList = parseAllowList(process.env.ANALYTICS_PILOT_ALLOWED_CONNECTIONS);
  if (allowList.size === 0) return json({ error: "The pilot is not enabled." }, 403);

  let parsed;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "The request is too large." }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "The request body must be JSON." }, 400);
    }
    parsed = parsePilotRequest(body);
  } catch (error) {
    if (error instanceof PilotError) return json({ error: error.message, code: error.code }, error.status);
    return json({ error: "The request could not be read." }, 400);
  }

  const run = <T>(fn: Parameters<typeof withContext>[1]) => withContext(SERVICE, fn) as Promise<T>;
  const runReadOnly = <T>(fn: Parameters<typeof withContext>[1]) => withReadOnlyContext(SERVICE, fn) as Promise<T>;
  const deps = {
    fetch: providerFetch(),
    now: new Date(),
    googleClientId: process.env.ANALYTICS_GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.ANALYTICS_GOOGLE_CLIENT_SECRET,
    wixAppId: process.env.ANALYTICS_WIX_APP_ID,
    wixAppSecret: process.env.ANALYTICS_WIX_APP_SECRET,
  };
  try {
    const result = parsed.mode === "probe"
      ? await runPilotProbe(run, parsed, deps, { allowList, runReadOnly })
      : await runPilotSync(run, parsed, deps, { allowList, budgetMs: Math.min(budgetFromEnv(), 90_000), maxConcurrent: maxConcurrentFromEnv(), record: recordingFromEnv() });
    return json(result, 200);
  } catch (error) {
    if (error instanceof PilotError) return json({ error: error.message, code: error.code }, error.status);
    // Never echo an unexpected error: it could carry a connection string or a provider message.
    return json({ error: "The pilot could not complete. See the audit log and the invocation record." }, 500);
  }
}

export function GET() {
  return json({ error: "Method not allowed" }, 405);
}
