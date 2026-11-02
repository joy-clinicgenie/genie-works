import { drainMaintenance } from "../src/analytics/maintenance";
import { closePools, SERVICE, withContext } from "../src/client";
import { loadRootEnv } from "../src/env";
import { assertFixtureFetch, assertLocalWorkerDatabase } from "../src/testing/targets";

loadRootEnv();
assertLocalWorkerDatabase(process.env.DATABASE_URL ?? "");

const outcome = await drainMaintenance((fn) => withContext(SERVICE, fn), {
  fetch: async (url, init) => {
    assertFixtureFetch(url);
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    return {
      status: response.status,
      headers: response.headers,
      json: () => response.json(),
      text: () => response.text(),
    };
  },
  now: new Date(),
  googleClientId: process.env.ANALYTICS_GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.ANALYTICS_GOOGLE_CLIENT_SECRET,
  wixAppId: process.env.ANALYTICS_WIX_APP_ID,
  wixAppSecret: process.env.ANALYTICS_WIX_APP_SECRET,
  pageSpeedKey: process.env.PAGESPEED_API_KEY,
}, { owner: "cli" });

const worked = outcome.jobs > 0 || outcome.inspected > 0 || outcome.measured > 0;
console.log(worked
  ? `Analytics jobs ${outcome.jobs}, index checks ${outcome.inspected}, speed checks ${outcome.measured}.`
  : "No analytics job was due.");
await closePools();
