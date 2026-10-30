import { closePools, SERVICE, withContext } from "../src/client";
import { loadRootEnv } from "../src/env";
import { runWorkerOnce } from "../src/analytics/sync";
import { assertFixtureFetch, assertLocalWorkerDatabase } from "../src/testing/targets";

loadRootEnv();
assertLocalWorkerDatabase(process.env.DATABASE_URL ?? "");

const outcome = await withContext(SERVICE, (db) => runWorkerOnce(db, "cli", {
  fetch: async (url, init) => {
    assertFixtureFetch(url);
    const response = await fetch(url, init);
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
}));

console.log(outcome.worked ? `Analytics job ${outcome.result}` : "No analytics job was due.");
await closePools();
