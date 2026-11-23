/**
 * Provider validation (Phase 2.3). Runs a small, fixed, read-only set of jobs through the real synchronisation
 * path into the LOCAL database (rolled back at the end) and compares derived with direct results.
 *
 *   npm run analytics:validate -w @clinic-genie/db -- --provider ga4 --fictional
 *       Against the fictional provider. Needs nothing. This is what the tests do.
 *
 *   npm run analytics:validate -w @clinic-genie/db -- --provider gsc            (a plan only: lists the jobs and the request cap)
 *
 *   VALIDATION_ACCESS_TOKEN=... VALIDATION_PROPERTY_ID=... VALIDATION_CONFIRM=read-only-nonproduction:gsc:2026-11-14 \
 *     npm run analytics:validate -w @clinic-genie/db -- --provider gsc --live --out evidence.json
 *       Live. Authorised, non-production, read-only property only. Never a client's property without written approval.
 *
 * Guards: the database must be on this machine; a live run needs the access token, the property id and a confirmation
 * naming the provider and today's UTC date; the number of provider requests is capped; nothing but numbers and labels is
 * written; the token and the property id are never printed or stored in the evidence. The token is held in memory and in
 * a rolled-back local row only.
 */
import { writeFileSync } from "node:fs";
import { closePools, SERVICE, withContext } from "../src/client";
import { loadRootEnv } from "../src/env";
import { assertLocalWorkerDatabase } from "../src/testing/targets";
import { saveConnection } from "../src/analytics/connections";
import { civilDate, sealedToken, type FetchLike } from "../src/analytics/sync";
import { fictionalProviders } from "../src/testing/fictional-analytics-provider";
import {
  assembleEvidence, recordingFetch, summariseLatency, validateGa4, validateGsc, validateWix, validationEnd, type Provider,
} from "../src/analytics/validation";
import { provisionClinic } from "../test/provision";

loadRootEnv();
assertLocalWorkerDatabase(process.env.DATABASE_URL ?? "");
process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-validation-local-key-0123456789";

class Rollback extends Error {}

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const provider = arg("--provider") as Provider | undefined;
const fictional = process.argv.includes("--fictional");
const live = process.argv.includes("--live");
const out = arg("--out");
if (!provider || !["ga4", "gsc", "wix"].includes(provider)) {
  console.error("Usage: --provider ga4|gsc|wix [--fictional | --live] [--out file] [--budget n]");
  process.exit(2);
}
const CAPS: Record<Provider, number> = { ga4: 14, gsc: 8, wix: 4 };
const budget = Math.min(Number(arg("--budget") ?? CAPS[provider]), 20);
const today = civilDate("UTC", new Date());

if (!fictional && !live) {
  console.log(JSON.stringify({ plan: provider, maxProviderRequests: budget, windowEnd: validationEnd(provider, today), note: "Add --fictional to run against the fictional provider, or --live with the guards in this file's header." }, null, 2));
  process.exit(0);
}

let accessToken = "fictional-token";
let propertyId = provider === "ga4" ? "800001" : provider === "gsc" ? "sc-domain:validation.example.invalid" : "wix-validation-site";
let fetchImpl: FetchLike;
if (live) {
  const token = process.env.VALIDATION_ACCESS_TOKEN;
  const property = process.env.VALIDATION_PROPERTY_ID;
  if (!token || !property || process.env.VALIDATION_CONFIRM !== `read-only-nonproduction:${provider}:${today}`) {
    console.error(`Refusing a live run. It needs VALIDATION_ACCESS_TOKEN, VALIDATION_PROPERTY_ID and VALIDATION_CONFIRM=read-only-nonproduction:${provider}:${today}.`);
    process.exit(2);
  }
  if (process.env.ANALYTICS_FIXTURE_MODE === "1") {
    console.error("Refusing a live run while ANALYTICS_FIXTURE_MODE=1, which forbids every non-local provider host.");
    process.exit(2);
  }
  accessToken = token;
  propertyId = property;
  // The token is only ever sent to the three provider API hosts.
  const ALLOWED_HOSTS = new Set(["analyticsdata.googleapis.com", "www.googleapis.com", "www.wixapis.com"]);
  fetchImpl = async (url, init) => {
    if (!ALLOWED_HOSTS.has(new URL(url).hostname)) throw new Error("Refusing a request to a host that is not a provider API.");
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    return { status: response.status, headers: response.headers, json: () => response.json(), text: () => response.text() };
  };
} else {
  fetchImpl = fictionalProviders().fetch;
}

let evidence;
try {
  await withContext(SERVICE, async (db) => {
    const admin = (await db.query<{ id: string }>("select id from staff_users where platform_role = 'admin' order by created_at limit 1")).rows[0];
    if (!admin) throw new Error("Seed admin missing. Run npm run db:seed.");
    await db.query("update analytics_jobs set state = 'cancelled', lease_owner = null, lease_until = null where state in ('queued', 'leased')");
    await db.query("update analytics_connections set status = 'disconnected', disconnected_at = now() where status = 'connected'");
    const { clientId, websiteId } = await provisionClinic(db, admin.id);
    const sealed = sealedToken({ accessToken, expiresAt: new Date(Date.now() + 50 * 60_000).toISOString() });
    const timezone = provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore";
    const connection = await saveConnection(db, {
      clientId, websiteId, provider, externalPropertyId: propertyId, streamOrSiteRef: null, providerTimezone: timezone,
      tokenCiphertext: sealed.ciphertext, tokenNonce: sealed.nonce, actorUserId: admin.id,
    });
    const recorder = recordingFetch(fetchImpl, budget);
    const ctx = { db, clientId, websiteId, connectionId: connection.id, provider, fetch: fetchImpl, recorder, now: new Date() };
    const end = validationEnd(provider, civilDate(timezone, ctx.now));
    const plan = provider === "ga4" ? await validateGa4(ctx, end) : provider === "gsc" ? await validateGsc(ctx, end) : await validateWix(ctx, civilDate(timezone, ctx.now), { accessToken, timezone });
    evidence = { ...assembleEvidence({ mode: live ? "live" : "fictional", provider, propertyId, plan }), latency: summariseLatency(plan.requests), providerRequestsMade: recorder.total(), requestCap: budget };
    throw new Rollback();
  });
} catch (error) {
  if (!(error instanceof Rollback)) {
    console.error(error instanceof Error ? error.message : "Validation failed.");
    process.exitCode = 1;
  }
} finally {
  await closePools();
}
if (evidence) {
  const json = JSON.stringify(evidence, null, 2);
  if (out) writeFileSync(out, `${json}\n`);
  else console.log(json);
}
