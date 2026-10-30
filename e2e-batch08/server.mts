import { spawn } from "node:child_process";
import pg from "pg";
import { ENQUIRY_DB, PLATFORM_DB, adminUrl, appUrl } from "./targets.ts";

const mode = process.argv[2] === "dev" ? "dev" : "start";
const port = mode === "dev" ? "3409" : "3408";
const origin = `http://127.0.0.1:${port}`;

if (port === "3400") throw new Error("Refusing port 3400.");

const probe = new pg.Client({ connectionString: adminUrl(PLATFORM_DB) });
await probe.connect();
try {
  const current = await probe.query<{ name: string }>("select current_database() as name");
  if (current.rows[0]?.name !== PLATFORM_DB) throw new Error("Server target is not the isolated platform database.");
  const enquiry = await probe.query<{ exists: boolean }>("select exists (select 1 from pg_database where datname = $1) as exists", [ENQUIRY_DB]);
  if (!enquiry.rows[0]?.exists) throw new Error("Isolated enquiry database is missing.");
} finally {
  await probe.end();
}

const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: appUrl(PLATFORM_DB),
  DATABASE_ADMIN_URL: adminUrl(PLATFORM_DB),
  APP_DB_PASSWORD: "cg_app_dev",
  ENQUIRY_DATABASE_URL: adminUrl(ENQUIRY_DB),
  AUTH_URL: origin,
  APP_ENVIRONMENT_LABEL: "batch-08 rehearsal",
  NEXT_DIST_DIR: mode === "dev" ? ".next-batch08-dev" : ".next-batch08",
  AUTH_GOOGLE_ID: "",
  AUTH_GOOGLE_SECRET: "",
  ANALYTICS_GOOGLE_CLIENT_ID: "",
  ANALYTICS_GOOGLE_CLIENT_SECRET: "",
  ANALYTICS_TOKEN_KEY: "",
};
delete env.VERCEL_ENV;
if (mode === "dev") env.NODE_ENV = "development";

const child = spawn("npx", ["next", mode === "dev" ? "dev" : "start", "-p", port, "-H", "127.0.0.1"], {
  cwd: "apps/platform",
  env,
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
console.log(`batch 08 ${mode} server intended for ${origin}`);
