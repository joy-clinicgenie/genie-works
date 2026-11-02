import pg from "pg";
import { expect, test } from "@playwright/test";
import { DEV_ORIGIN, openAs } from "./support.ts";
import { ENQUIRY_DB, adminUrl } from "./targets.ts";

const meridianNew = "11111111-1111-4111-8111-111111111104";
const fixtureWindow = "from=2026-10-01&to=2026-10-31";

function fixturePath(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${fixtureWindow}`;
}

test("production mode refuses the enquiry fixture before a read", async ({ browser }) => {
  const { page, close } = await openAs(browser, "admin@example.invalid");
  try {
    await page.goto("/enquiries");
    await expect(page.getByText("The enquiry database target was refused before any read or write.")).toBeVisible();
    await expect(page.getByText("TEST-MS-NEW-001")).toHaveCount(0);
    const exported = await page.request.get("/enquiries/export");
    expect(exported.status()).toBe(503);
    expect(await exported.text()).toContain("refused");
  } finally {
    await close();
  }
});

async function resetFixtureRows(): Promise<void> {
  const fixture = new pg.Client({ connectionString: adminUrl(ENQUIRY_DB) });
  await fixture.connect();
  try {
    await fixture.query("update enquiries set status = 'new' where public_reference = 'TEST-MS-NEW-004'");
    await fixture.query("update notification_outbox set status = 'failed', leased_until = null, updated_at = now() where id = $1", ["22222222-2222-4222-8222-222222222202"]);
  } finally {
    await fixture.end();
  }
}

test("fixture enquiry status, retry and export stay inside the local fixture", async ({ browser }) => {
  const ready = await fetch(`${DEV_ORIGIN}/sign-in`);
  expect(ready.status).toBe(200);
  await resetFixtureRows();

  const specialist = await openAs(browser, "specialist-a@example.invalid");
  try {
    const hidden = await specialist.page.request.get(`${DEV_ORIGIN}/enquiries/${meridianNew}`);
    expect(hidden.status()).toBe(404);
  } finally {
    await specialist.close();
  }

  const reviewer = await openAs(browser, "reviewer@example.invalid");
  try {
    const hidden = await reviewer.page.request.get(`${DEV_ORIGIN}/enquiries/11111111-1111-4111-8111-111111111102`);
    expect(hidden.status()).toBe(404);
  } finally {
    await reviewer.close();
  }

  const other = await openAs(browser, "specialist-b@example.invalid");
  try {
    const hidden = await other.page.request.get(`${DEV_ORIGIN}/enquiries/${meridianNew}`);
    expect(hidden.status()).toBe(404);
    await other.page.goto(`${DEV_ORIGIN}${fixturePath("/enquiries/notifications?notification=failed")}`);
    await expect(other.page.getByText("TEST-MS-ACK-002")).toHaveCount(0);
  } finally {
    await other.close();
  }

  const admin = await openAs(browser, "admin@example.invalid");
  try {
    await admin.page.goto(`${DEV_ORIGIN}${fixturePath("/enquiries/notifications?notification=failed")}`);
    await expect(admin.page.getByText("TEST-MS-ACK-002")).toHaveCount(0);
    await admin.page.goto(`${DEV_ORIGIN}${fixturePath("/enquiries")}`);
    await expect(admin.page.getByText("TEST-MS-NEW-001")).toHaveCount(0);
    const exported = await admin.page.request.get(`${DEV_ORIGIN}${fixturePath("/enquiries/export")}`);
    expect(exported.status()).toBe(200);
    expect(exported.headers()["content-type"] ?? "").toContain("text/csv");
    const csv = await exported.text();
    expect(csv).toContain("Reference");
    expect(csv).not.toContain("TEST-MS-NEW-001");
    expect(csv).not.toContain("meridian.one@example.invalid");
    expect(csv.toLowerCase()).not.toContain("retry requested is provider acceptance");
  } finally {
    await admin.close();
  }

  const reader = await openAs(browser, "readonly@example.invalid");
  try {
    await reader.page.goto(`${DEV_ORIGIN}${fixturePath("/enquiries/notifications?notification=failed")}`);
    await expect(reader.page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    const exported = await reader.page.request.get(`${DEV_ORIGIN}/enquiries/export`, { maxRedirects: 0 });
    expect(exported.status()).toBe(403);
  } finally {
    await reader.close();
  }
});
