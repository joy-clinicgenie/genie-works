/**
 * Runs the platform against an isolated suite database.
 *
 * Usage:
 *   npx tsx e2e-batch08/server.mts [b08|perf] [start|dev]
 *
 * `start` serves a production build from the suite's own distDir; `dev` runs next dev. The target
 * database is probed and checked before the server is spawned, so the app can never be pointed at a
 * shared database by mistake. Provider credentials are blanked, and for the perf suite Wix reads are
 * sent to the local mock through FORMS_WIX_BASE_URL, which is refused for any non-local host.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { adminUrl, appUrl, suiteName, suiteTargets } from "./targets.ts";

const args = process.argv.slice(2);
const suite = suiteName(args.find((arg) => arg === "b08" || arg === "perf"));
const mode = args.includes("dev") ? "dev" : "start";
const targets = suiteTargets(suite);
const port = String(mode === "dev" ? targets.devPort : targets.prodPort);
const origin = `http://127.0.0.1:${port}`;

if (port === "3400") throw new Error("Refusing port 3400.");

const probe = new pg.Client({ connectionString: adminUrl(targets.platformDb) });
await probe.connect();
try {
  const current = await probe.query<{ name: string }>("select current_database() as name");
  if (current.rows[0]?.name !== targets.platformDb) throw new Error("Server target is not the isolated platform database.");
  const enquiry = await probe.query<{ exists: boolean }>("select exists (select 1 from pg_database where datname = $1) as exists", [targets.enquiryDb]);
  if (!enquiry.rows[0]?.exists) throw new Error("Isolated enquiry database is missing. Run the prepare script first.");
} finally {
  await probe.end();
}

const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: appUrl(targets.platformDb),
  DATABASE_ADMIN_URL: adminUrl(targets.platformDb),
  APP_DB_PASSWORD: "cg_app_dev",
  ENQUIRY_DATABASE_URL: adminUrl(targets.enquiryDb),
  AUTH_URL: origin,
  APP_ENVIRONMENT_LABEL: `${suite} isolated`,
  NEXT_DIST_DIR: mode === "dev" ? `.next-${suite}-dev` : `.next-${suite}`,
  AUTH_GOOGLE_ID: "",
  AUTH_GOOGLE_SECRET: "",
  ANALYTICS_GOOGLE_CLIENT_ID: "",
  ANALYTICS_GOOGLE_CLIENT_SECRET: "",
  ANALYTICS_TOKEN_KEY: "",
  UPLOADS_DIR: `.data/uploads-${suite}`,
};
delete env.VERCEL_ENV;
if (mode === "dev") env.NODE_ENV = "development";

if (suite === "perf") {
  // Fictional credentials. The mock does not check them; it only has to be reachable.
  env.FORMS_WIX_APP_ID = env.FORMS_WIX_APP_ID_PERF ?? "00000000-0000-4000-8000-000000000aaa";
  env.FORMS_WIX_APP_SECRET = env.FORMS_WIX_APP_SECRET_PERF ?? "mock-secret-not-a-real-credential";
  const mock = process.env.WIX_MOCK_URL?.trim();
  if (mock) {
    env.FORMS_WIX_BASE_URL = mock;
    console.log(`Wix reads go to the local mock at ${mock}`);
  } else {
    // No mock running: leave the app unable to obtain a token rather than reaching the real provider.
    env.FORMS_WIX_APP_ID = "";
    env.FORMS_WIX_APP_SECRET = "";
    console.log("WIX_MOCK_URL is not set, so Wix reads are switched off for this run.");
  }
}

const child = spawn("npx", ["next", mode === "dev" ? "dev" : "start", "-p", port, "-H", "127.0.0.1"], {
  cwd: resolve("apps/platform"),
  env,
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
console.log(`suite ${suite} ${mode} server intended for ${origin}`);
