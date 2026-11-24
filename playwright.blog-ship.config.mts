import { defineConfig, devices } from "@playwright/test";
import { GW_ORIGIN, GW_PORT, PUBLISH_SECRET, SITE_DIR, SITE_ORIGIN, SITE_PORT, SITE_TOKEN, TOKEN_KEY, UPLOADS, WEBSITE_ID, adminUrl, appUrl } from "./e2e-blog-ship/target.mts";

/**
 * D89 Ship to site, end to end on local test data. Needs a local clinicgenie-site4 checkout with the
 * Genie Works integration (SITE4_DIR, default ../clinicgenie-site4). Global setup creates a dedicated
 * isolated database; teardown drops it. Nothing is deployed.
 *
 *   npx playwright test -c playwright.blog-ship.config.mts
 */
const blank = { AUTH_GOOGLE_ID: "", AUTH_GOOGLE_SECRET: "", ANALYTICS_GOOGLE_CLIENT_ID: "", ANALYTICS_GOOGLE_CLIENT_SECRET: "", ENQUIRY_DATABASE_URL: "" };

export default defineConfig({
  testDir: "./e2e-blog-ship",
  testMatch: /.*\.spec\.mts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  outputDir: "e2e-blog-ship/.run/test-results",
  globalSetup: "./e2e-blog-ship/setup.mts",
  globalTeardown: "./e2e-blog-ship/teardown.mts",
  webServer: [
    {
      command: `npx next dev -p ${GW_PORT} -H 127.0.0.1`,
      cwd: "apps/platform",
      url: `${GW_ORIGIN}/sign-in`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...blank,
        DATABASE_URL: appUrl(),
        DATABASE_ADMIN_URL: adminUrl(),
        AUTH_URL: GW_ORIGIN,
        NEXT_DIST_DIR: ".next-blog-ship",
        APP_ENVIRONMENT_LABEL: "ship to site isolated",
        ANALYTICS_TOKEN_KEY: TOKEN_KEY,
        UPLOADS_DIR: UPLOADS,
      },
    },
    {
      // A production build, so the website's page caching and on-demand refresh are exercised for real.
      command: `npx next build && npx next start -p ${SITE_PORT} -H 127.0.0.1`,
      cwd: SITE_DIR,
      url: `${SITE_ORIGIN}/genie-tips`,
      reuseExistingServer: false,
      timeout: 420_000,
      env: {
        NEXT_DIST_DIR: ".next-genie-works-test",
        NEXT_PUBLIC_SITE_URL: SITE_ORIGIN,
        GENIE_WORKS_URL: GW_ORIGIN,
        GENIE_WORKS_WEBSITE_ID: WEBSITE_ID,
        GENIE_WORKS_SITE_TOKEN: SITE_TOKEN,
        GENIE_WORKS_PUBLISH_SECRET: PUBLISH_SECRET,
        NOTION_TOKEN: "",
        NOTION_DATABASE_ID: "",
        SUPABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        RESEND_API_KEY: "",
      },
    },
  ],
  use: { trace: "off", screenshot: "off", video: "off", navigationTimeout: 120_000, actionTimeout: 30_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
