import { expect, test } from "@playwright/test";
import { openAs, sessionCount } from "./support.ts";

const email = "temp-b08@example.invalid";

test("deactivating a staff member revokes the existing session", async ({ browser }) => {
  const admin = await openAs(browser, "admin@example.invalid");
  try {
    await admin.page.goto("/admin/users");
    const add = admin.page.locator("form").filter({ has: admin.page.locator("#new-email") });
    await add.getByLabel("Work email").fill(email);
    await add.getByLabel("Display name").fill("Batch Eight Temp");
    await add.getByLabel("Role").selectOption("specialist");
    await add.getByRole("button", { name: "Add staff member" }).click();
    await expect(admin.page.getByText(email)).toBeVisible();
  } finally {
    await admin.close();
  }

  expect(await sessionCount(email)).toBe(0);
  const temp = await openAs(browser, email);
  try {
    expect(await sessionCount(email)).toBe(1);
    await temp.page.goto("/");
    await expect(temp.page.getByRole("heading", { name: "Agency Overview" })).toBeVisible();

    const adminAgain = await openAs(browser, "admin@example.invalid");
    try {
      await adminAgain.page.goto("/admin/users");
      const row = adminAgain.page.locator("li").filter({ hasText: email });
      await row.getByRole("checkbox", { name: "Deactivated" }).check();
      await row.getByRole("button", { name: "Save" }).click();
      await expect(adminAgain.page.getByText("Staff record saved.")).toBeVisible();
      await expect(row.getByText("Active", { exact: true })).toHaveCount(0);
    } finally {
      await adminAgain.close();
    }

    expect(await sessionCount(email)).toBe(0);
    await temp.page.reload();
    await expect(temp.page).toHaveURL(/\/sign-in/);
    await expect(temp.page.getByRole("heading", { name: "Genie Works" })).toBeVisible();
  } finally {
    await temp.close();
  }
});
