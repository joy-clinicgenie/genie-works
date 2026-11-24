import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { loadRootEnv, requireEnv } from "../packages/db/src/env.ts";

/**
 * D89 Ship to site, end to end on local test data: Genie Works (dev server, port 3420) against a
 * dedicated isolated database, and the Clinic Genie website (production build, port 3421) from a
 * local clinicgenie-site4 checkout. Nothing is deployed; no shared database is used.
 */
loadRootEnv();

export const DATABASE = "clinic_genie_test_blog_ship";
export const GW_PORT = 3420;
export const SITE_PORT = 3421;
export const GW_ORIGIN = `http://127.0.0.1:${GW_PORT}`;
export const SITE_ORIGIN = `http://127.0.0.1:${SITE_PORT}`;
export const SITE_DIR = resolve(process.env.SITE4_DIR ?? "../clinicgenie-site4");
export const UPLOADS = resolve("e2e-blog-ship/.run/uploads");
export const FIXTURE_FILE = "e2e-blog-ship/.run/fixture.json";
export const TOKEN_KEY = "e2e-blog-ship-analytics-token-key-not-a-secret";
export const WEBSITE_ID = "5f1e0c2a-7b3d-4e6f-9a10-0b1c2d3e4f50";
const LOCAL = new Set(["127.0.0.1", "localhost", "::1"]);

// Fresh per run, shared by setup (database) and both servers (environment).
process.env.SHIP_SITE_TOKEN ??= randomBytes(32).toString("base64url");
process.env.SHIP_PUBLISH_SECRET ??= randomBytes(32).toString("base64");
export const SITE_TOKEN = process.env.SHIP_SITE_TOKEN;
export const PUBLISH_SECRET = process.env.SHIP_PUBLISH_SECRET;

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  if (!LOCAL.has(parsed.hostname) || parsed.port === "54329") throw new Error("Refusing: the Ship to site test runs on the local test server only.");
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
