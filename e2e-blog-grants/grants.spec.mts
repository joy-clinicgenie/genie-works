import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { FIXTURE_FILE, ORIGIN, adminUrl } from "./target.mts";

/**
 * D87: one complete publishing-grant lifecycle on a dedicated isolated database.
 * An admin grants a manager Website A; the manager can release on A and not on B; the admin
 * revokes A; the manager loses access, including in an editor tab opened before revocation.
 * The server refuses unauthorised grant changes and a release attempted after revocation.
 */

type Fixture = { clientId: string; siteA: string; siteB: string; secondAdmin: string; articles: { a1: string; a2: string; b1: string } };

test.describe.configure({ mode: "serial" });

let fx: Fixture;
let db: pg.Client;
let admin: Page;
let manager: Page;
let staleEditor: Page;

async function signIn(browser: Browser, email: string): Promise<Page> {
  const token = randomBytes(24).toString("hex");
  const existing = await db.query<{ id: number }>("select id from users where email = $1", [email]);
  const userId = existing.rows[0]?.id ?? (await db.query<{ id: number }>("insert into users (name, email) values ($1, $1) returning id", [email])).rows[0]!.id;
  await db.query(`insert into sessions ("userId", expires, "sessionToken") values ($1, now() + interval '2 hours', $2)`, [userId, token]);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "authjs.session-token", value: token, url: ORIGIN, httpOnly: true, sameSite: "Lax" }]);
  return context.newPage();
}

/** Changes a staff role the way the app does: inside an administrator session (the staff guard requires it). */
async function setRole(userId: string, role: "admin" | "manager") {
  const adminId = (await db.query<{ id: string }>("select id from staff_users where email = 'admin@example.invalid'")).rows[0]!.id;
  await db.query("begin");
  try {
    await db.query("select set_config('app.context', 'staff', true), set_config('app.user_id', $1, true), set_config('app.platform_role', 'admin', true)", [adminId]);
    await db.query("update staff_users set platform_role = $2 where id = $1", [userId, role]);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

const activeGrants = async (websiteId: string) =>
  (await db.query<{ email: string }>("select u.email from website_publishers p join staff_users u on u.id = p.user_id where p.website_id = $1 and p.revoked_at is null", [websiteId])).rows.map((row) => row.email);

test.beforeAll(async ({ browser }) => {
  fx = JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as Fixture;
  db = new pg.Client({ connectionString: adminUrl() });
  await db.connect();
  admin = await signIn(browser, "admin@example.invalid");
  manager = await signIn(browser, "manager@example.invalid");
});

test.afterAll(async () => {
  await db?.end();
});

test("1. Overview → More actions → Publishing settings requires a specific website", async () => {
  await admin.goto(`/blog?client=${fx.clientId}`);
  await admin.getByText("More actions").click();
  await admin.getByRole("link", { name: "Publishing settings" }).click();
  await expect(admin).toHaveURL(`${ORIGIN}/blog/publishing?client=${fx.clientId}`);
  await expect(admin.getByRole("heading", { name: "Choose a website" })).toBeVisible();
  await expect(admin.getByRole("combobox", { name: "Grant publishing access" })).toHaveCount(0);
  await admin.getByRole("link", { name: "Website A", exact: true }).click();
  await expect(admin).toHaveURL(`${ORIGIN}/blog/publishing?client=${fx.clientId}&website=${fx.siteA}`);
  await expect(admin.getByTestId("publishing-destination")).toHaveText("Grant Check Clinic (fictional) · Website A · a.grant-check.example.invalid");
  // The admin override is shown separately; admins are not grant holders.
  await expect(admin.getByText("Demo Admin, Second Admin (fictional)")).toBeVisible();
  await expect(admin.getByText("No staff member has publishing access to Website A.")).toBeVisible();
  await expect(admin.getByText("Website delivery not connected")).toBeVisible();
});

test("2. Admin grants the manager Website A only", async () => {
  await admin.getByRole("combobox", { name: "Grant publishing access" }).fill("manager");
  await admin.getByRole("option", { name: /Demo Manager/ }).click();
  await admin.getByRole("button", { name: "Grant Demo Manager publishing access to Website A" }).click();
  await expect(admin.getByText("Demo Manager can now release to Website A.").first()).toBeVisible();
  const table = admin.getByRole("table", { name: "Publishing access for Website A" });
  await expect(table.getByText("Demo Manager")).toBeVisible();
  // Grant holders only: the admin appears as the granter, never as a holder.
  expect((await table.locator("tbody tr td:first-child .font-medium").allTextContents()).map((name) => name.trim())).toEqual(["Demo Manager"]);
  expect(await activeGrants(fx.siteA)).toEqual(["manager@example.invalid"]);
  expect(await activeGrants(fx.siteB)).toEqual([]);
  // Granting staff access does not set up, test or connect the website.
  expect((await db.query<{ n: number }>("select count(*)::int as n from website_blog_publishing")).rows[0]!.n).toBe(0);
  await expect(admin.getByText("Website delivery not connected")).toBeVisible();
  await admin.goto(`/blog/publishing?client=${fx.clientId}&website=${fx.siteB}`);
  await expect(admin.getByText("No staff member has publishing access to Website B.")).toBeVisible();
});

test("3. The manager can release on Website A and not on Website B", async ({ browser }) => {
  await manager.goto(`/blog/${fx.articles.b1}`);
  await expect(manager.getByText("Releasing to this website needs publishing access for it from an administrator.")).toBeVisible();
  await expect(manager.getByRole("button", { name: "Release to content API" })).toHaveCount(0);

  await manager.goto(`/blog/${fx.articles.a1}`);
  await manager.getByRole("button", { name: "Release to content API" }).click();
  await expect(manager.getByText(/website publication stays unverified/)).toBeVisible();
  await manager.getByRole("button", { name: "Release now" }).click();
  await expect(manager.getByRole("status").filter({ hasText: "Released to the content API" }).first()).toBeVisible();
  await expect(manager.getByText(/Website publication is unverified/).first()).toBeVisible();
  await expect(manager.getByText(/ship to site/i).first()).toBeVisible(); // only as the not-yet-available workflow
  await expect(manager.getByRole("button", { name: /ship to site/i })).toHaveCount(0);
  await manager.reload();
  await expect(manager.getByText("Website publication unverified").first()).toBeVisible();
  await expect(manager.getByRole("link", { name: "View live article" })).toHaveCount(0);

  // An editor tab for another Website A article, opened while access is still granted.
  staleEditor = await manager.context().newPage();
  await staleEditor.goto(`/blog/${fx.articles.a2}`);
  await expect(staleEditor.getByRole("button", { name: "Release to content API" })).toBeVisible();
  void browser;
});

test("4. Admin revokes Website A; the record is kept", async () => {
  await admin.goto(`/blog/publishing?client=${fx.clientId}&website=${fx.siteA}`);
  await admin.getByRole("button", { name: "Revoke access: Demo Manager on Website A" }).click();
  await expect(admin.getByText("Revoke Demo Manager's publishing access to Website A?")).toBeVisible();
  await admin.getByRole("button", { name: "Revoke Demo Manager's access to Website A" }).click();
  await expect(admin.getByText("No staff member has publishing access to Website A.")).toBeVisible();
  await expect(admin.getByText("Revoked access (1)")).toBeVisible();
  expect(await activeGrants(fx.siteA)).toEqual([]);
  expect((await db.query<{ n: number }>("select count(*)::int as n from website_publishers where website_id = $1 and revoked_at is not null", [fx.siteA])).rows[0]!.n).toBe(1);
});

test("5. A release from an editor opened before revocation is refused by the server", async () => {
  await staleEditor.getByRole("button", { name: "Release to content API" }).click();
  await staleEditor.getByRole("button", { name: "Release now" }).click();
  await expect(staleEditor.getByText(/You are not authorised to release to this website/).first()).toBeVisible();
  const status = (await db.query<{ status: string; live: string | null }>("select status, live_version_id as live from blog_articles where id = $1", [fx.articles.a2])).rows[0]!;
  expect(status).toEqual({ status: "approved", live: null });
  await staleEditor.reload();
  await expect(staleEditor.getByRole("button", { name: "Release to content API" })).toHaveCount(0);
  await expect(staleEditor.getByText("Releasing to this website needs publishing access for it from an administrator.")).toBeVisible();
});

test("6. The manager sees the panel read-only and cannot change grants", async () => {
  await manager.goto(`/blog/publishing?client=${fx.clientId}&website=${fx.siteA}`);
  await expect(manager.getByText("Only an administrator can change publishing access.")).toBeVisible();
  await expect(manager.getByRole("combobox", { name: "Grant publishing access" })).toHaveCount(0);
  await expect(manager.getByRole("button", { name: /Revoke/ })).toHaveCount(0);
});

test("7. The server refuses a grant from an admin demoted after the page loaded", async ({ browser }) => {
  const second = await signIn(browser, "admin-two@example.invalid");
  await second.goto(`/blog/publishing?client=${fx.clientId}&website=${fx.siteA}`);
  await second.getByRole("combobox", { name: "Grant publishing access" }).fill("manager");
  await second.getByRole("option", { name: /Demo Manager/ }).click();
  await setRole(fx.secondAdmin, "manager");
  try {
    await second.getByRole("button", { name: "Grant Demo Manager publishing access to Website A" }).click();
    await expect(second.getByText("Only an administrator can grant website publishing access.").first()).toBeVisible();
    expect(await activeGrants(fx.siteA)).toEqual([]);
  } finally {
    await setRole(fx.secondAdmin, "admin");
  }
});

test("8. Granting again after revocation adds a new grant and keeps the revoked one", async () => {
  await admin.goto(`/blog/publishing?client=${fx.clientId}&website=${fx.siteA}`);
  await admin.getByRole("combobox", { name: "Grant publishing access" }).fill("Demo Manager");
  await admin.getByRole("option", { name: /Demo Manager/ }).click();
  await admin.getByRole("button", { name: "Grant Demo Manager publishing access to Website A" }).click();
  await expect(admin.getByText("Demo Manager can now release to Website A.").first()).toBeVisible();
  const rows = (await db.query<{ revoked: boolean }>("select revoked_at is not null as revoked from website_publishers where website_id = $1 order by granted_at", [fx.siteA])).rows;
  expect(rows.map((row) => row.revoked)).toEqual([true, false]);
  await manager.goto(`/blog/${fx.articles.a2}`);
  await expect(manager.getByRole("button", { name: "Release to content API" })).toBeVisible();
});
