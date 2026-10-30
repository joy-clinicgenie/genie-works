import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against the platform app. Needs the dev DB running, migrated and
// seeded (sign-in uses seeded staff and the /dev/magic-links page).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3400",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3400/sign-in",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
