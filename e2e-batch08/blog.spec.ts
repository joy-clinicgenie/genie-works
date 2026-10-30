import { expect, test } from "@playwright/test";
import { issueBlogReadToken, loadContext, openAs } from "./support.ts";

const ctx = loadContext();
const stamp = Date.now().toString(36);
const title = `Fictional batch eight note ${stamp}`;

test("in-app blog review, protected preview and published API revision", async ({ browser }) => {
  const specialist = await openAs(browser, "specialist-a@example.invalid");
  let articlePath = "";
  try {
    await specialist.page.goto(`/blog/new?client=${ctx.meridianId}&website=${ctx.meridianWebsiteId}`);
    await specialist.page.locator("#title").fill(title);
    await specialist.page.getByRole("textbox", { name: "Paragraph 1" }).fill("A fictional rehearsal paragraph. It is not medical advice.");
    await specialist.page.getByRole("button", { name: "Settings" }).click();
    await specialist.page.locator("#reviewerUserId").selectOption({ label: "Demo Reviewer" });
    await specialist.page.locator("#slug").fill(`fictional-batch-eight-${stamp}`);
    await expect(specialist.page.locator("#reviewerUserId")).not.toHaveValue("");
    await specialist.page.getByRole("button", { name: "Save draft" }).click();
    await expect(specialist.page).toHaveURL(/\/blog\/[0-9a-f-]{36}$/);
    articlePath = new URL(specialist.page.url()).pathname;
    await specialist.page.getByRole("button", { name: "Submit for review" }).click();
    await expect(specialist.page.getByRole("status").filter({ hasText: "Submitted for review." }).first()).toBeVisible();
  } finally {
    await specialist.close();
  }

  const reviewer = await openAs(browser, "reviewer@example.invalid");
  try {
    await reviewer.page.goto(articlePath);
    await reviewer.page.getByRole("button", { name: "Approve" }).click();
    await expect(reviewer.page.getByRole("status").filter({ hasText: "Approved." }).first()).toBeVisible();
  } finally {
    await reviewer.close();
  }

  const author = await openAs(browser, "specialist-a@example.invalid");
  try {
    await author.page.goto(articlePath);
    await expect(author.page.getByText("Publishing and unpublishing are limited to an admin or manager.")).toBeVisible();
    await expect(author.page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
    const preview = await author.page.request.get(`${articlePath}/preview`);
    expect(preview.status()).toBe(200);
    expect(preview.headers()["x-robots-tag"] ?? "").toContain("noindex");
    expect(preview.headers()["cache-control"] ?? "").toContain("private");
    expect(await preview.text()).toContain(title);
  } finally {
    await author.close();
  }

  const unassigned = await openAs(browser, "specialist-b@example.invalid");
  try {
    await unassigned.page.goto(articlePath);
    await expect(unassigned.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(unassigned.page.getByText(title)).toHaveCount(0);
    await unassigned.page.goto(`${articlePath}/preview`);
    await expect(unassigned.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(unassigned.page.getByText(title)).toHaveCount(0);
    await expect(unassigned.page.getByText("Preview unavailable")).toHaveCount(0);
  } finally {
    await unassigned.close();
  }

  const outsider = await browser.newContext();
  try {
    const signedOut = await outsider.request.get(`http://127.0.0.1:3408${articlePath}/preview`, { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(signedOut.status());
    expect(signedOut.headers().location ?? "").toContain("/sign-in");
  } finally {
    await outsider.close();
  }

  const admin = await openAs(browser, "admin@example.invalid");
  let slug = "";
  try {
    await admin.page.goto(articlePath);
    slug = await admin.page.locator("#slug").inputValue();
    await admin.page.getByRole("button", { name: "Publish", exact: true }).click();
    await admin.page.getByRole("button", { name: "Publish now" }).click();
    await expect(admin.page.getByRole("status").filter({ hasText: "Published." }).first()).toBeVisible();
    const protectedPreview = await admin.page.request.get(`${articlePath}/preview`);
    expect(protectedPreview.headers()["x-robots-tag"] ?? "").toContain("noindex");
    expect(protectedPreview.headers()["cache-control"] ?? "").toContain("private");
  } finally {
    await admin.close();
  }

  expect(slug).toMatch(/^[a-z0-9-]+$/);
  const token = await issueBlogReadToken(ctx.meridianWebsiteId, ctx.meridianId, ctx.adminId);
  const reader = await browser.newContext();
  try {
    const missing = await reader.request.get(`/api/public/blog/${ctx.meridianWebsiteId}/page/${slug}`);
    expect(missing.status()).toBe(404);
    const published = await reader.request.get(`/api/public/blog/${ctx.meridianWebsiteId}/page/${slug}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(published.status()).toBe(200);
    expect(await published.text()).toContain(title);
    expect(published.headers()["x-robots-tag"] ?? "").toContain("noindex");
  } finally {
    await reader.close();
  }
});
