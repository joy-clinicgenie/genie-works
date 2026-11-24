import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyContext } from "../src/client";
import { runMigrations } from "../src/migrate";
import { seedDemo } from "../src/seed";
import {
  createArticle,
  decideArticleReview,
  getPreviewBlogArticle,
  getPublishedBlog,
  issueArticlePreview,
  publishArticle,
  revokeArticlePreviews,
  submitArticleForReview,
  type ArticleBody,
} from "../src/services/blog";
import { getWebsiteConnection, intendedArticleUrl, readPublishSecret, saveWebsiteConnection } from "../src/services/blog-publishing";
import { createWebsite } from "../src/services/registry";
import { createIsolatedDatabase, staffContext, type IsolatedDatabase } from "./isolated";
import { provisionClinic } from "./provision";

/** D89: the website connection for Ship to site, the content API payload and the website preview read. */

type Staff = { id: string; platform_role: "admin" | "manager" | "specialist" | "reviewer" };
const body: ArticleBody = { layout: "clinic-article-v1", blocks: [{ type: "paragraph", text: "Fictional." }] };
const SECRET = randomBytes(32).toString("base64");
let db: IsolatedDatabase;
let admin: Staff, manager: Staff, specA: Staff, reviewer: Staff;
const previousKey = process.env.ANALYTICS_TOKEN_KEY;

beforeAll(async () => {
  process.env.ANALYTICS_TOKEN_KEY = "test-analytics-token-key-for-blog-connection";
  db = await createIsolatedDatabase("connection");
  await runMigrations(db.admin);
  await seedDemo(db.admin);
  [admin, manager, specA, reviewer] = (await Promise.all(["admin", "manager", "specialist-a", "reviewer"].map((n) => db.staff(`${n}@example.invalid`)))) as [Staff, Staff, Staff, Staff];
}, 180_000);
afterAll(async () => {
  if (previousKey === undefined) delete process.env.ANALYTICS_TOKEN_KEY; else process.env.ANALYTICS_TOKEN_KEY = previousKey;
  await db?.drop();
});

describe("website connection (D89)", () => {
  it("lets only an administrator save it, stores the secret encrypted, and never marks it tested", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const clinic = await provisionClinic(tx, admin.id, [specA.id]);
      const input = { websiteId: clinic.websiteId, basePath: "/genie-tips", secret: SECRET };
      for (const person of [manager, specA]) {
        await applyContext(tx, staffContext(person));
        await tx.query("savepoint attempt");
        await expect(saveWebsiteConnection(tx, input, person.id)).rejects.toThrow(/Only an administrator/);
        await tx.query("rollback to savepoint attempt");
      }
      await applyContext(tx, staffContext(admin));
      expect((await getWebsiteConnection(tx, clinic.websiteId))?.configured).toBe(false);
      await expect(saveWebsiteConnection(tx, { ...input, secret: null }, admin.id)).rejects.toThrow(/Paste the publish secret/);
      await expect(saveWebsiteConnection(tx, { ...input, secret: "too-short" }, admin.id)).rejects.toThrow(/at least 32/);
      await expect(saveWebsiteConnection(tx, { ...input, basePath: "Genie Tips" }, admin.id)).rejects.toThrow(/blog route/);
      const wix = await createWebsite(tx, { clientId: clinic.clientId, name: "Wix site", url: "https://wix.example.invalid", platform: "Wix", environment: "production", notes: null }, admin.id);
      await expect(saveWebsiteConnection(tx, { ...input, websiteId: wix.id }, admin.id)).rejects.toThrow(/Next.js/);

      const saved = await saveWebsiteConnection(tx, { ...input, basePath: "/genie-tips/" }, admin.id);
      expect(saved).toMatchObject({ configured: true, basePath: "/genie-tips" });
      const stored = (await tx.query<{ secret_ciphertext: string }>("select secret_ciphertext from website_blog_publishing where website_id = $1", [clinic.websiteId])).rows[0]!;
      expect(stored.secret_ciphertext).not.toContain(SECRET);
      expect(await readPublishSecret(tx, clinic.websiteId)).toBe(SECRET);
      // An empty secret keeps the saved one; a new one replaces it.
      await saveWebsiteConnection(tx, { ...input, basePath: "/insights", secret: "" }, admin.id);
      expect(await readPublishSecret(tx, clinic.websiteId)).toBe(SECRET);
      const replacement = randomBytes(32).toString("base64url");
      await saveWebsiteConnection(tx, { ...input, secret: replacement }, admin.id);
      expect(await readPublishSecret(tx, clinic.websiteId)).toBe(replacement);
      // The audit records the change, never the secret.
      const audit = (await tx.query<{ metadata: unknown }>("select metadata from audit_events where action = 'blog.website_connection_saved' and target_id = $1", [clinic.websiteId])).rows;
      expect(JSON.stringify(audit)).not.toContain(SECRET);
      expect(JSON.stringify(audit)).not.toContain(replacement);
      // Saving a connection is not a delivery: nothing is verified.
      expect((await tx.query<{ n: number }>("select count(*)::int as n from blog_deliveries where website_id = $1", [clinic.websiteId])).rows[0]!.n).toBe(0);
    });
  });

  it("builds addresses from the blog route, and the content API carries the revision id and route", async () => {
    expect(intendedArticleUrl("https://www.example.invalid/x", "/genie-tips", "care")).toBe("https://www.example.invalid/genie-tips/care");
    expect(intendedArticleUrl(null, "/blog", "care")).toBeNull();
    await db.asContext(staffContext(admin), async (tx) => {
      const clinic = await provisionClinic(tx, admin.id, [specA.id, reviewer.id]);
      await saveWebsiteConnection(tx, { websiteId: clinic.websiteId, basePath: "/genie-tips", secret: SECRET }, admin.id);
      await applyContext(tx, staffContext(specA));
      const id = await createArticle(tx, {
        clientId: clinic.clientId, websiteId: clinic.websiteId, title: "Route note", slug: "route-note", category: "Care", authorUserId: specA.id,
        reviewerUserId: reviewer.id, seoTitle: "Route note", seoDescription: "Fictional.", canonicalPath: null, indexable: true, body,
      }, specA.id);
      const preview = await issueArticlePreview(tx, id, specA.id);
      await submitArticleForReview(tx, id, specA.id);
      await applyContext(tx, staffContext(reviewer));
      await decideArticleReview(tx, id, "approved", null, reviewer.id);
      await applyContext(tx, staffContext(admin));
      await publishArticle(tx, id, admin.id);
      const live = (await tx.query<{ live_version_id: string }>("select live_version_id from blog_articles where id = $1", [id])).rows[0]!.live_version_id;

      await applyContext(tx, { kind: "service" });
      const token = randomBytes(32).toString("base64url");
      await tx.query("insert into seo_site_tokens (client_id, website_id, token_hash, created_by) values ($1, $2, $3, $4)",
        [clinic.clientId, clinic.websiteId, createHash("sha256").update(token).digest("hex"), admin.id]);
      const api = await getPublishedBlog(tx, clinic.websiteId, token);
      expect(api?.articles[0]).toMatchObject({ path: "/genie-tips/route-note", versionId: live });
      expect(api?.sitemap).toEqual([expect.objectContaining({ path: "/genie-tips/route-note" })]);

      // The website preview needs this website's site token and an unrevoked preview token.
      expect(await getPreviewBlogArticle(tx, clinic.websiteId, token, preview.token)).toMatchObject({ title: "Route note", indexable: false, path: "/genie-tips/route-note" });
      expect(await getPreviewBlogArticle(tx, clinic.stagingId, token, preview.token)).toBeNull();
      expect(await getPreviewBlogArticle(tx, clinic.websiteId, "x".repeat(43), preview.token)).toBeNull();
      await applyContext(tx, staffContext(specA));
      await revokeArticlePreviews(tx, id, specA.id);
      await applyContext(tx, { kind: "service" });
      expect(await getPreviewBlogArticle(tx, clinic.websiteId, token, preview.token)).toBeNull();
    });
  });
});
