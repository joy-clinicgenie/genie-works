import { expect, test } from "@playwright/test";
import { DEV_ORIGIN, loadContext, openAs } from "./support.ts";

const ctx = loadContext();

test("signed-out production routes stop at sign-in and hide development links", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Genie Works" })).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send sign-in link" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Google Workspace" })).toHaveCount(0);
  await expect(page.getByText("No sign-in method configured")).toBeVisible();

  const links = await request.get("/dev/magic-links", { maxRedirects: 0 });
  expect(links.status()).toBe(404);

  const start = await request.get(`/api/analytics/google/start?client=${ctx.meridianId}`, { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(start.status());
  const location = start.headers().location ?? "";
  expect(location).toContain("/sign-in");
  expect(location).not.toContain("accounts.google.com");
});

test("admin can open every fictional client and admin", async ({ browser }) => {
  const { page, close } = await openAs(browser, "admin@example.invalid");
  try {
    await page.goto("/clients");
    await expect(page.getByRole("link", { name: /Meridian Skin/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Harbourview Dental/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Northgate Physio/ })).toHaveCount(0);
    await page.goto("/admin");
    await expect(page.getByText("Active staff")).toBeVisible();
    await page.goto("/clients/new");
    await expect(page.getByRole("heading", { name: "Add client" })).toBeVisible();
  } finally {
    await close();
  }
});

test("manager sees every fictional client and is refused admin and secret writes", async ({ browser }) => {
  const { page, close } = await openAs(browser, "manager@example.invalid");
  try {
    await page.goto("/clients");
    await expect(page.getByRole("link", { name: /Meridian Skin/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Harbourview Dental/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Northgate Physio/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Agency Overview" })).toBeVisible();
    await expect(page.getByText("Backup status")).toHaveCount(0);

    const start = await page.request.get(`/api/analytics/google/start?client=${ctx.meridianId}`, { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(start.status());
    const location = start.headers().location ?? "";
    expect(location).toContain("analyticsError=secret_denied");
    expect(location).not.toContain("accounts.google.com");
    await page.goto("/settings");
    await expect(page.getByRole("link", { name: "Connect GA4" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Connect Search Console" })).toHaveCount(0);
  } finally {
    await close();
  }
});

test("specialist sees assigned clients only", async ({ browser }) => {
  const assigned = await openAs(browser, "specialist-a@example.invalid");
  try {
    await assigned.page.goto("/clients");
    await expect(assigned.page.getByRole("link", { name: /Meridian Skin/ })).toBeVisible();
    await expect(assigned.page.getByRole("link", { name: /Harbourview Dental/ })).toHaveCount(0);
    await expect(assigned.page.getByRole("link", { name: /Northgate Physio/ })).toHaveCount(0);
    await assigned.page.goto(`/clients/${ctx.clinicGenieId}`);
    await expect(assigned.page).toHaveURL(/denied=1/);
    await expect(assigned.page.getByText("You do not have access to that client.")).toBeVisible();
    await assigned.page.goto("/clients/new");
    await expect(assigned.page).toHaveURL(/\/clients$/);
    await expect(assigned.page.getByRole("button", { name: "Create client" })).toHaveCount(0);
    await assigned.page.goto("/admin");
    await expect(assigned.page).toHaveURL(/\/$/);
  } finally {
    await assigned.close();
  }

  const other = await openAs(browser, "specialist-b@example.invalid");
  try {
    await other.page.goto("/clients");
    await expect(other.page.getByRole("link", { name: /Meridian Skin/ })).toHaveCount(0);
    await expect(other.page.getByRole("link", { name: /Harbourview Dental/ })).toHaveCount(0);
    await expect(other.page.getByRole("link", { name: /Northgate Physio/ })).toHaveCount(0);
    await other.page.goto(`/clients/${ctx.meridianId}`);
    await expect(other.page).toHaveURL(/denied=1/);
    await expect(other.page.getByText("You do not have access to that client.")).toBeVisible();
  } finally {
    await other.close();
  }
});

test("reviewer can open assigned clients and cannot create or administer", async ({ browser }) => {
  const { page, close } = await openAs(browser, "reviewer@example.invalid");
  try {
    await page.goto("/clients");
    await expect(page.getByRole("link", { name: /Meridian Skin/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Harbourview Dental/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Northgate Physio/ })).toHaveCount(0);
    await page.goto(`/clients/${ctx.meridianId}/profile`);
    await expect(page.getByText("Only admins and managers can edit the profile.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save details" })).toHaveCount(0);
    await page.goto(`/clients/${ctx.clinicGenieId}`);
    await expect(page).toHaveURL(/denied=1/);
    await page.goto("/reports/new");
    await expect(page.getByText("You cannot create a report.")).toBeVisible();
    await page.goto("/clients/new");
    await expect(page).toHaveURL(/\/clients$/);
  } finally {
    await close();
  }
});

test("read-only can view one assigned client and is refused mutations and export", async ({ browser }) => {
  const { page, close } = await openAs(browser, "readonly@example.invalid");
  try {
    await page.goto("/clients");
    await expect(page.getByRole("link", { name: /Meridian Skin/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Harbourview Dental/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Northgate Physio/ })).toHaveCount(0);
    await page.goto(`/clients/${ctx.meridianId}`);
    await expect(page).toHaveURL(/denied=1/);
    await page.goto("/reports/new");
    await expect(page.getByText("You cannot create a report.")).toBeVisible();
    const exported = await page.request.get("/enquiries/export", { maxRedirects: 0 });
    expect(exported.status()).toBe(403);
    const start = await page.request.get(`/api/analytics/google/start?client=${ctx.meridianId}`, { maxRedirects: 0 });
    const location = start.headers().location ?? "";
    expect(location).toContain("analyticsError=secret_denied");
    expect(location).not.toContain("accounts.google.com");
  } finally {
    await close();
  }
});

test("specialist export and secret routes are denied before a provider", async ({ browser }) => {
  const { page, close } = await openAs(browser, "specialist-a@example.invalid");
  try {
    const exported = await page.request.get(`${DEV_ORIGIN}/enquiries/export`, { maxRedirects: 0 });
    expect(exported.status()).toBe(403);
    const start = await page.request.get(`/api/analytics/google/start?client=${ctx.meridianId}&provider=ga4`, { maxRedirects: 0 });
    const location = start.headers().location ?? "";
    expect(location).toContain("analyticsError=secret_denied");
    expect(location).not.toContain("accounts.google.com");
  } finally {
    await close();
  }
});
