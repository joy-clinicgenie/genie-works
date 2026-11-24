import { loadRootEnv, requireEnv } from "../packages/db/src/env.ts";

/**
 * D87 publishing-grants browser test: its own isolated database, server port and build folder.
 * Never the shared development database, the sibling clinic database (54329) or the app on 3400.
 */
loadRootEnv();

export const DATABASE = "clinic_genie_test_blog_grants";
export const PORT = 3411;
export const ORIGIN = `http://127.0.0.1:${PORT}`;
const LOCAL = new Set(["127.0.0.1", "localhost", "::1"]);

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  if (!LOCAL.has(parsed.hostname) || parsed.port === "54329") throw new Error("Refusing: the publishing-grants test runs on the local test server only.");
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export const adminUrl = (database = DATABASE) => withDatabase(requireEnv("DATABASE_ADMIN_URL"), database);
export const appUrl = () => {
  const url = new URL(adminUrl());
  url.username = "cg_app";
  url.password = process.env.APP_DB_PASSWORD || "cg_app_dev";
  return url.toString();
};
export const FIXTURE_FILE = "e2e-blog-grants/.run/fixture.json";
