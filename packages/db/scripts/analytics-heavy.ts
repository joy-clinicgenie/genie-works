/** One Search Console queries job with N rows, to count the database statements storing it takes. Local, rolled back. */
import { performance } from "node:perf_hooks";
import { withContext, SERVICE, closePools } from "../src/client";
import { loadRootEnv } from "../src/env";
import { assertLocalWorkerDatabase } from "../src/testing/targets";
import { enqueueJob, runWorkerOnce, sealedToken, type FetchLike } from "../src/analytics/sync";
import { saveConnection } from "../src/analytics/connections";
import { response } from "../src/testing/fictional-analytics-provider";
import { provisionClinic } from "../test/provision";

loadRootEnv();
process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-capacity-key-0123456789";
assertLocalWorkerDatabase(process.env.DATABASE_URL ?? "");
const rows = Number(process.argv[2] ?? 5000);
class Rollback extends Error {}
let out = "";
try {
  await withContext(SERVICE, async (db) => {
    const admin = (await db.query<{ id: string }>("select id from staff_users where platform_role = 'admin' order by created_at limit 1")).rows[0]!;
    await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
    const { clientId, websiteId } = await provisionClinic(db, admin.id);
    const token = sealedToken({ accessToken: "heavy", expiresAt: "2100-01-01T00:00:00.000Z" });
    const connection = await saveConnection(db, { clientId, websiteId, provider: "gsc", externalPropertyId: "sc-domain:heavy.example.invalid", streamOrSiteRef: null, providerTimezone: "America/Los_Angeles", tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId: admin.id });
    const now = new Date("2026-11-12T04:00:00.000Z");
    await enqueueJob(db, { clientId, websiteId, connectionId: connection.id, templateKey: "gsc.queries", start: "2026-10-13", end: "2026-11-08" });
    await db.query("update analytics_jobs set next_attempt_at = $1", [now.toISOString()]);
    const fetch: FetchLike = async () => response(200, { rows: Array.from({ length: rows }, (_, i) => ({ keys: [`query number ${i}`], clicks: 3, impressions: 40, ctr: 0.075, position: 6.2 })) });
    let statements = 0;
    const original = db.query.bind(db) as (...args: unknown[]) => Promise<unknown>;
    (db as unknown as { query: unknown }).query = (...args: unknown[]) => { statements += 1; return original(...args); };
    const started = performance.now();
    const step = await runWorkerOnce(async (fn) => fn(db), "heavy", { fetch, now });
    out = JSON.stringify({ rows, result: step.result, statements, ms: Math.round(performance.now() - started) });
    throw new Rollback();
  });
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
} finally {
  await closePools();
}
console.log(out);
