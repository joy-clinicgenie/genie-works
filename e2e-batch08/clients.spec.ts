import { expect, test } from "@playwright/test";
import { openAs } from "./support.ts";

test("admin can create, edit and archive a fictional client", async ({ browser }) => {
  const { page, close } = await openAs(browser, "admin@example.invalid");
  try {
    const mark = Date.now().toString(36);
    await page.goto("/clients/new");
    await page.getByLabel("Client ID").fill(`B8-${mark}`.toUpperCase());
    await page.getByLabel("Short code").fill(`B${mark}`.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12));
    await page.getByRole("textbox", { name: "Clinic name", exact: true }).fill("Batch Eight Clinic (fictional)");
    await page.getByLabel("Specialty").fill("Fictional general practice");
    await page.getByLabel("Identifier").fill(`b8-${mark}`);
    await page.getByRole("checkbox", { name: /demonstration data/ }).check();
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
    const clientUrl = page.url();

    await page.goto(`${clientUrl}/profile`);
    const profile = page.locator("form").filter({ has: page.locator("#specialty") });
    await profile.getByLabel("Specialty").fill("Fictional general practice updated");
    await profile.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Specialty")).toHaveValue("Fictional general practice updated");

    await page.getByRole("button", { name: "Deactivate client" }).click();
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Inactive", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Client archived")).toBeVisible();
    await page.getByRole("link", { name: "Edit profile" }).first().click();
    await expect(page.getByRole("button", { name: "Restore client" })).toBeVisible();
    await page.goto("/clients?status=archived");
    await expect(page.getByRole("link", { name: "Batch Eight Clinic (fictional)" }).first()).toBeVisible();
  } finally {
    await close();
  }
});

test("manager can open client creation and specialist cannot", async ({ browser }) => {
  const manager = await openAs(browser, "manager@example.invalid");
  try {
    await manager.page.goto("/clients/new");
    await expect(manager.page.getByRole("heading", { name: "Add client" })).toBeVisible();
    await expect(manager.page.getByRole("button", { name: "Create client" })).toBeVisible();
  } finally {
    await manager.close();
  }
  const specialist = await openAs(browser, "specialist-a@example.invalid");
  try {
    await specialist.page.goto("/clients/new");
    await expect(specialist.page).toHaveURL(/\/clients$/);
    await expect(specialist.page.getByRole("heading", { name: "Add client" })).toHaveCount(0);
  } finally {
    await specialist.close();
  }
});
