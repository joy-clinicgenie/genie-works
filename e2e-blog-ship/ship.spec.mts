import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { applyContext } from "../packages/db/src/client.ts";
import { decideArticleReview, getArticle, returnArticleToDraft, startRevision, submitArticleForReview, updateArticle } from "../packages/db/src/services/blog.ts";
import { FIXTURE_FILE, GW_ORIGIN, PUBLISH_SECRET, SITE_ORIGIN, adminUrl } from "./target.mts";

/**
 * D89 acceptance on local test data: Genie Works ships an approved article to a production build
 * of the Clinic Genie website and verifies it there.
 */

type Fixture = { clientId: string; websiteId: string; articleId: string; admin: string; specialist: string; reviewer: string };
const SLUG = "shipped-clinic-note";
const PUBLIC_URL = `${SITE_ORIGIN}/genie-tips/${SLUG}`;

test.describe.configure({ mode: "serial" });

let fx: Fixture;
let pool: pg.Pool;
let admin: Page;
let site: Page;

async function signIn(browser: Browser, email: string): Promise<Page> {
  const token = randomBytes(24).toString("hex");
  const existing = await pool.query<{ id: number }>("select id from users where email = $1", [email]);
  const userId = existing.rows[0]?.id ?? (await pool.query<{ id: number }>("insert into users (name, email) values ($1, $1) returning id", [email])).rows[0]!.id;
  await pool.query(`insert into sessions ("userId", expires, "sessionToken") values ($1, now() + interval '2 hours', $2)`, [userId, token]);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "authjs.session-token", value: token, url: GW_ORIGIN, httpOnly: true, sameSite: "Lax" }]);
  return context.newPage();
}

/** Writes a new approved revision with the given title, as the author and the reviewer would. */
async function approveRevision(title: string) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await applyContext(db, { kind: "staff", userId: fx.specialist, role: "specialist" });
    let article = (await getArticle(db, fx.articleId))!;
    if (article.status === "published" && !article.working_status) await startRevision(db, fx.articleId, fx.specialist);
    if (article.working_status === "approved" || article.status === "approved") await returnArticleToDraft(db, fx.articleId, fx.specialist);
    article = (await getArticle(db, fx.articleId))!;
    await updateArticle(db, fx.articleId, {
      clientId: article.client_id, websiteId: article.website_id, title, slug: SLUG, category: "Care", authorUserId: fx.specialist,
      reviewerUserId: fx.reviewer, seoTitle: title, seoDescription: "A fictional shipped article.", canonicalPath: null, indexable: true,
      body: article.body, featuredMediaId: article.featured_media_id,
    }, fx.specialist, article.current_version_id!);
    await submitArticleForReview(db, fx.articleId, fx.specialist);
    await applyContext(db, { kind: "staff", userId: fx.reviewer, role: "reviewer" });
    await decideArticleReview(db, fx.articleId, "approved", null, fx.reviewer);
    await db.query("commit");
    return (await pool.query<{ current_version_id: string }>("select current_version_id from blog_articles where id = $1", [fx.articleId])).rows[0]!.current_version_id;
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    db.release();
  }
}

async function liveRevision(): Promise<string | null> {
  return (await pool.query<{ live_version_id: string | null }>("select live_version_id from blog_articles where id = $1", [fx.articleId])).rows[0]!.live_version_id;
}

/** The Genie Tips listing: how many distinct links point at the article, and which known titles it shows exactly. */
async function listing(titles: string[]): Promise<{ links: number; shown: string[] }> {
  await site.goto(`${SITE_ORIGIN}/genie-tips`);
  const hrefs = await site.locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  const links = new Set(hrefs.filter((href) => href === `/genie-tips/${"shipped-clinic-note"}`)).size;
  const shown: string[] = [];
  for (const title of titles) if (await site.getByText(title, { exact: true }).count()) shown.push(title);
  return { links, shown };
}

const TITLES = ["Shipped clinic note", "Shipped clinic note, updated", "Shipped clinic note, third revision"];

test.beforeAll(async ({ browser }) => {
  fx = JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as Fixture;
  pool = new pg.Pool({ connectionString: adminUrl(), max: 3 });
  admin = await signIn(browser, "admin@example.invalid");
  site = await (await browser.newContext()).newPage();
});

test.afterAll(async () => {
  await pool?.end();
});

test("1. Approved but not shipped: the article is private, the connection is saved but not verified", async () => {
  expect((await site.request.get(PUBLIC_URL)).status()).toBe(404);
  expect(await listing(TITLES)).toEqual({ links: 0, shown: [] });
  await admin.goto(`${GW_ORIGIN}/blog/publishing?client=${fx.clientId}`);
  await expect(admin.getByText("Connection saved, not yet verified")).toBeVisible();
  await expect(admin.getByTestId("website-id")).toHaveText(fx.websiteId);
  await expect(admin.getByText(PUBLISH_SECRET)).toHaveCount(0);
});

test("2. Preview on website shows the exact revision with the site's template, privately", async () => {
  await admin.goto(`${GW_ORIGIN}/blog/${fx.articleId}`);
  await admin.getByRole("button", { name: "Preview on website" }).click();
  const href = await admin.getByRole("link", { name: "Open website preview" }).getAttribute("href");
  expect(href).toMatch(new RegExp(`^${SITE_ORIGIN}/api/genie-works/preview\\?token=`));
  await site.goto(href!);
  await expect(site).toHaveURL(/\/genie-tips\/preview\//);
  await expect(site.getByText("Private preview of an unpublished revision")).toBeVisible();
  await expect(site.getByRole("heading", { level: 1, name: "Shipped clinic note" })).toBeVisible();
  await expect(site.getByRole("heading", { level: 2, name: "Why it matters" })).toBeVisible();
  const cover = site.getByRole("img", { name: "A teal square standing in for a clinic photo" });
  await expect(cover).toBeVisible();
  expect(await cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await site.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
  expect((await site.request.get(PUBLIC_URL)).status()).toBe(404);
});

test("3. Ship to site publishes, verifies, and lists the article", async () => {
  await admin.goto(`${GW_ORIGIN}/blog/${fx.articleId}`);
  await expect(admin.getByText(`${SITE_ORIGIN}/genie-tips/${SLUG}`).first()).toBeVisible();
  await admin.getByRole("button", { name: "Ship to site: Ship check website" }).click();
  await expect(admin.getByText("Shipped and verified on the website.").first()).toBeVisible();
  const live = await liveRevision();
  await site.goto(PUBLIC_URL);
  await expect(site.getByRole("heading", { level: 1, name: "Shipped clinic note" })).toBeVisible();
  expect(await site.locator('meta[name="genie-works-revision"]').getAttribute("content")).toBe(live);
  const cover = site.getByRole("img", { name: "A teal square standing in for a clinic photo" });
  expect(await cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await listing(TITLES)).toEqual({ links: 1, shown: ["Shipped clinic note"] });
  await admin.reload();
  await expect(admin.getByText("Verified on website").first()).toBeVisible();
  await expect(admin.getByRole("link", { name: "View live article" })).toHaveAttribute("href", PUBLIC_URL);
  await admin.getByRole("tab", { name: "History" }).click();
  await expect(admin.getByText(/Delivery · version \d+ · attempt 1 · Succeeded/)).toBeVisible();
  await expect(admin.getByText(/Verification · version \d+ · attempt 2 · Succeeded/)).toBeVisible();
});

test("4. Editing a live article keeps the public revision until the approved update is shipped to the same URL", async () => {
  const before = await liveRevision();
  const update = await approveRevision("Shipped clinic note, updated");
  await site.goto(PUBLIC_URL);
  await expect(site.getByRole("heading", { level: 1, name: "Shipped clinic note" })).toBeVisible();
  expect(await site.locator('meta[name="genie-works-revision"]').getAttribute("content")).toBe(before);
  await admin.goto(`${GW_ORIGIN}/blog/${fx.articleId}`);
  await admin.getByRole("button", { name: "Ship to site: Ship check website" }).click();
  await expect(admin.getByText("Shipped and verified on the website.").first()).toBeVisible();
  await site.goto(PUBLIC_URL);
  await expect(site.getByRole("heading", { level: 1, name: "Shipped clinic note, updated" })).toBeVisible();
  expect(await site.locator('meta[name="genie-works-revision"]').getAttribute("content")).toBe(update);
  expect(await listing(TITLES)).toEqual({ links: 1, shown: ["Shipped clinic note, updated"] });
});

test("5. A failed delivery is retried into one article with an accurate history", async () => {
  // The website will refuse: Genie Works holds a secret the website does not have.
  await admin.goto(`${GW_ORIGIN}/blog/publishing?client=${fx.clientId}`);
  await admin.getByLabel("Replace publish secret").fill(randomBytes(32).toString("base64"));
  await admin.getByRole("button", { name: "Save website connection" }).click();
  await expect(admin.getByText(/Saved for Ship check website/).first()).toBeVisible();

  const failing = await approveRevision("Shipped clinic note, third revision");
  await admin.goto(`${GW_ORIGIN}/blog/${fx.articleId}`);
  await admin.getByRole("button", { name: "Ship to site: Ship check website" }).click();
  await expect(admin.getByText(/The website refused the request/).first()).toBeVisible();
  await admin.reload();
  await expect(admin.getByText("Delivery failed").first()).toBeVisible();
  await site.goto(PUBLIC_URL);
  await expect(site.getByRole("heading", { level: 1, name: "Shipped clinic note, updated" })).toBeVisible();

  // Restore the matching secret and retry.
  await admin.goto(`${GW_ORIGIN}/blog/publishing?client=${fx.clientId}`);
  await admin.getByLabel("Replace publish secret").fill(PUBLISH_SECRET);
  await admin.getByRole("button", { name: "Save website connection" }).click();
  await expect(admin.getByText(/Saved for Ship check website/).first()).toBeVisible();
  await admin.goto(`${GW_ORIGIN}/blog/${fx.articleId}`);
  await admin.getByRole("button", { name: "Ship to site: Ship check website" }).click();
  await expect(admin.getByText("Shipped and verified on the website.").first()).toBeVisible();
  await site.goto(PUBLIC_URL);
  await expect(site.getByRole("heading", { level: 1, name: "Shipped clinic note, third revision" })).toBeVisible();
  expect(await listing(TITLES)).toEqual({ links: 1, shown: ["Shipped clinic note, third revision"] });

  const deliveries = (await pool.query<{ n: number }>("select count(*)::int as n from blog_deliveries where version_id = $1", [failing])).rows[0]!.n;
  const attempts = (await pool.query<{ kind: string; status: string; outcome_code: string | null }>(
    "select a.kind, a.status, a.outcome_code from blog_delivery_attempts a join blog_deliveries d on d.id = a.delivery_id where d.version_id = $1 order by a.attempt_number", [failing],
  )).rows;
  expect(deliveries).toBe(1);
  expect(attempts).toEqual([
    { kind: "deliver", status: "failed", outcome_code: "site_refused" },
    { kind: "deliver", status: "succeeded", outcome_code: null },
    { kind: "verify", status: "succeeded", outcome_code: null },
  ]);
  const articles = (await pool.query<{ n: number }>("select count(*)::int as n from blog_articles where website_id = $1", [fx.websiteId])).rows[0]!.n;
  expect(articles).toBe(1);
  await admin.reload();
  await admin.getByRole("tab", { name: "History" }).click();
  await expect(admin.getByText(/Delivery · version \d+ · attempt 1 · Failed \(site refused\)/)).toBeVisible();
});

test("6. A manager without a grant for this website cannot ship", async ({ browser }) => {
  const manager = await signIn(browser, "manager@example.invalid");
  await approveRevision("Shipped clinic note, fourth revision");
  await manager.goto(`${GW_ORIGIN}/blog/${fx.articleId}`);
  await expect(manager.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(manager.getByRole("button", { name: /Ship to site/ })).toHaveCount(0);
});
