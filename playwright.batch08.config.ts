import { defineConfig, devices } from "@playwright/test";

/**
 * Batch 08 only. This config does not start or reuse the app on port 3400.
 * Start the isolated production server on 127.0.0.1:3408 and the fixture
 * server on 127.0.0.1:3409 before running it.
 */
export default defineConfig({
  testDir: "./e2e-batch08",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  outputDir: "e2e-batch08/.run/test-results",
  use: {
    baseURL: "http://127.0.0.1:3408",
    trace: "off",
    screenshot: "off",
    video: "off",
    navigationTimeout: 120_000,
    actionTimeout: 20_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
