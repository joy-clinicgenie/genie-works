import { expect, test } from "@playwright/test";
import { openAs, reportStatus } from "./support.ts";

test("specialist can save a draft and a review copy without a final state", async ({ browser }) => {
  const { page, close } = await openAs(browser, "specialist-a@example.invalid");
  try {
    await page.goto("/reports/new");
    const clientValue = await page.locator("#clientId option", { hasText: "Meridian Skin" }).getAttribute("value");
    await page.locator("#clientId").selectOption(clientValue ?? "");
    await expect(page.locator("#websiteId option", { hasText: "Meridian Skin website" })).toHaveCount(1);
    const websiteValue = await page.locator("#websiteId option", { hasText: "Meridian Skin website" }).getAttribute("value");
    await page.locator("#websiteId").selectOption(websiteValue ?? "");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop() ?? "";
    expect(await reportStatus(id)).toBe("draft");
    await expect(page.getByText("Approved", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Final", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Save for review" }).click();
    await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
    expect(await reportStatus(id)).toBe("saved");
    await expect(page.getByText("Saved versions")).toBeVisible();
    await expect(page.getByText("Approved", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Final", { exact: true })).toHaveCount(0);
  } finally {
    await close();
  }
});
