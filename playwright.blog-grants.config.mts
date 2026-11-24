import { defineConfig, devices } from "@playwright/test";
import { ORIGIN, PORT, adminUrl, appUrl } from "./e2e-blog-grants/target.mts";

/**
 * D87 publishing-grants lifecycle. Self-contained and repeatable: global setup creates a dedicated
 * isolated database with a fictional client, two websites and staff; the web server below runs the
 * app against it on its own port and build folder; teardown drops the database.
 *
 *   npx playwright test -c playwright.blog-grants.config.mts
 */
export default defineConfig({
  testDir: "./e2e-blog-grants",
  testMatch: /.*\.spec\.mts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  outputDir: "e2e-blog-grants/.run/test-results",
  globalSetup: "./e2e-blog-grants/setup.mts",
  globalTeardown: "./e2e-blog-grants/teardown.mts",
  webServer: {
    command: `npx next dev -p ${PORT} -H 127.0.0.1`,
    cwd: "apps/platform",
    url: `${ORIGIN}/sign-in`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: appUrl(),
      DATABASE_ADMIN_URL: adminUrl(),
      AUTH_URL: ORIGIN,
      NEXT_DIST_DIR: ".next-blog-grants",
      APP_ENVIRONMENT_LABEL: "blog grants isolated",
      ENQUIRY_DATABASE_URL: "",
      AUTH_GOOGLE_ID: "",
      AUTH_GOOGLE_SECRET: "",
      ANALYTICS_GOOGLE_CLIENT_ID: "",
      ANALYTICS_GOOGLE_CLIENT_SECRET: "",
      ANALYTICS_TOKEN_KEY: "",
    },
  },
  use: {
    baseURL: ORIGIN,
    trace: "off",
    screenshot: "off",
    video: "off",
    navigationTimeout: 120_000,
    actionTimeout: 20_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
