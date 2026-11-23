/**
 * Measures the local processing cost of one day's synchronisation for the production-sized
 * connection set (1 GA4, 10 Search Console, 10 Wix) against a fictional provider that answers
 * instantly. It reports time and request counts for our own work: queueing, parsing, deriving
 * and storing. It does not measure provider latency; the report adds that as a stated assumption.
 *
 * Local database only, fictional data, rolled back at the end. Nothing is committed.
 */
import { performance } from "node:perf_hooks";
import { withContext, SERVICE, closePools } from "../src/client";
import { loadRootEnv } from "../src/env";
import { assertLocalWorkerDatabase } from "../src/testing/targets";
import { enqueueDue, runWorkerOnce, sealedToken } from "../src/analytics/sync";
import { saveConnection } from "../src/analytics/connections";
import { fictionalProviders } from "../src/testing/fictional-analytics-provider";
import { provisionClinic } from "../test/provision";

loadRootEnv();
process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-capacity-key-0123456789";
assertLocalWorkerDatabase(process.env.DATABASE_URL ?? "");

class Rollback extends Error {}

const planner = process.argv.includes("--v1") ? "v1" : "v2";
const NOW = new Date("2026-11-12T04:00:00.000Z");
const timings: Array<{ provider: string; template: string; ms: number }> = [];
let queued = 0;
let requests = 0;

try {
  await withContext(SERVICE, async (db) => {
    const admin = (await db.query<{ id: string }>("select id from staff_users where platform_role = 'admin' order by created_at limit 1")).rows[0];
    if (!admin) throw new Error("Seed admin missing. Run npm run db:seed.");
    await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
    const { clientId, websiteId } = await provisionClinic(db, admin.id);
    const token = sealedToken({ accessToken: "capacity-token", expiresAt: "2100-01-01T00:00:00.000Z" });
    const connect = (provider: "ga4" | "gsc" | "wix", property: string) => saveConnection(db, {
      clientId, websiteId, provider, externalPropertyId: property, streamOrSiteRef: null,
      providerTimezone: provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore",
      tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId: admin.id,
    });
    await connect("ga4", "800001");
    for (let i = 0; i < 10; i += 1) await connect("gsc", `sc-domain:site${i}.example.invalid`);
    for (let i = 0; i < 10; i += 1) await connect("wix", `wix-site-${i}`);
    queued = await enqueueDue(db, NOW, websiteId, { planner });
    await db.query("update analytics_jobs set next_attempt_at = $1 where state = 'queued'", [NOW.toISOString()]);
    const provider = fictionalProviders();
    for (;;) {
      const before = performance.now();
      const callsBefore = provider.calls.length;
      const step = await runWorkerOnce(async (fn) => fn(db), "capacity", { fetch: provider.fetch, now: NOW });
      if (!step.worked) break;
      const last = provider.calls[provider.calls.length - 1];
      const template = last?.provider === "ga4" ? String((last.body.dimensions as Array<{ name: string }>).map((d) => d.name).join("+") || "range") : last?.provider ?? "none";
      if (provider.calls.length > callsBefore) timings.push({ provider: last!.provider, template, ms: performance.now() - before });
    }
    requests = provider.calls.length;
    throw new Rollback();
  });
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
} finally {
  await closePools();
}

const by = (key: (t: (typeof timings)[number]) => string) => {
  const groups = new Map<string, number[]>();
  for (const t of timings) groups.set(key(t), [...(groups.get(key(t)) ?? []), t.ms]);
  return Object.fromEntries([...groups].map(([k, v]) => [k, { jobs: v.length, meanMs: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), maxMs: +Math.max(...v).toFixed(1), totalMs: +v.reduce((a, b) => a + b, 0).toFixed(0) }]));
};
console.log(JSON.stringify({
  planner, jobsQueued: queued, requests,
  byProvider: by((t) => t.provider),
  ga4ByShape: by((t) => (t.provider === "ga4" ? t.template : "")) ,
  totalMs: +timings.reduce((a, t) => a + t.ms, 0).toFixed(0),
}, null, 2));
