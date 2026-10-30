import { expect, test } from "@playwright/test";

test("signed-out visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Genie Works" })).toBeVisible();
});

test("seeded admin can sign in with a development link", async ({ page }) => {
  const email = "admin@example.invalid";
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();

  await expect(page).toHaveURL(/\/dev\/magic-links/);
  // Links are listed newest first.
  await page.getByRole("link", { name: `Sign in as ${email}` }).first().click();

  await expect(page).not.toHaveURL(/\/sign-in|\/dev\/magic-links/);
});
