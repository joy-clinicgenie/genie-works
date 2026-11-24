import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import { applyContext } from "../packages/db/src/client.ts";
import { runMigrations } from "../packages/db/src/migrate.ts";
import { seedDemo } from "../packages/db/src/seed.ts";
import { createArticle, decideArticleReview, submitArticleForReview, type ArticleBody } from "../packages/db/src/services/blog.ts";
import { createClient, createStaff, createWebsite, grantMembership } from "../packages/db/src/services/registry.ts";
import { DATABASE, FIXTURE_FILE, adminUrl } from "./target.mts";

/** Creates the dedicated database and its fictional client, two websites, staff and approved articles. */
export default async function globalSetup(): Promise<void> {
  const maintenance = new pg.Client({ connectionString: adminUrl("postgres") });
  await maintenance.connect();
  await maintenance.query(`drop database if exists ${DATABASE} with (force)`);
  await maintenance.query(`create database ${DATABASE}`);
  await maintenance.end();

  const pool = new pg.Pool({ connectionString: adminUrl() });
  await runMigrations(pool);
  await seedDemo(pool);
  const staff = async (email: string) => (await pool.query("select id, platform_role, display_name from staff_users where email = $1", [email])).rows[0];
  const admin = await staff("admin@example.invalid");
  const specialist = await staff("specialist-a@example.invalid");
  const reviewer = await staff("reviewer@example.invalid");
  const body: ArticleBody = { layout: "clinic-article-v1", blocks: [{ type: "paragraph", text: "Fictional grant-check content." }] };
  const db = await pool.connect();
  try {
    await db.query("begin");
    await applyContext(db, { kind: "staff", userId: admin.id, role: "admin" });
    // A second administrator, demoted during the test to prove the server re-checks the role.
    const secondAdmin = await createStaff(db, { email: "admin-two@example.invalid", displayName: "Second Admin (fictional)", role: "admin" }, admin.id);
    const client = await createClient(db, { slug: "grant-check-clinic", name: "Grant Check Clinic (fictional)", ownerUserId: admin.id, channels: ["website"], isSynthetic: true, notes: null }, admin.id);
    for (const userId of [specialist.id, reviewer.id]) await grantMembership(db, { userId, clientId: client.id }, admin.id);
    const siteA = await createWebsite(db, { clientId: client.id, name: "Website A", url: "https://a.grant-check.example.invalid", platform: "Next.js on Vercel", environment: "production", notes: null }, admin.id);
    const siteB = await createWebsite(db, { clientId: client.id, name: "Website B", url: "https://b.grant-check.example.invalid", platform: "Next.js on Vercel", environment: "production", notes: null }, admin.id);
    const articles: Record<string, string> = {};
    for (const [key, websiteId, title] of [["a1", siteA.id, "Grant check A one"], ["a2", siteA.id, "Grant check A two"], ["b1", siteB.id, "Grant check B one"]] as const) {
      await applyContext(db, { kind: "staff", userId: specialist.id, role: "specialist" });
      const id = await createArticle(db, { clientId: client.id, websiteId, title, slug: `grant-check-${key}`, category: "Care", authorUserId: specialist.id, reviewerUserId: reviewer.id, seoTitle: title, seoDescription: "Fictional.", canonicalPath: null, indexable: true, body }, specialist.id);
      await submitArticleForReview(db, id, specialist.id);
      await applyContext(db, { kind: "staff", userId: reviewer.id, role: "reviewer" });
      await decideArticleReview(db, id, "approved", null, reviewer.id);
      articles[key] = id;
    }
    await db.query("commit");
    mkdirSync("e2e-blog-grants/.run", { recursive: true });
    writeFileSync(FIXTURE_FILE, JSON.stringify({ clientId: client.id, siteA: siteA.id, siteB: siteB.id, secondAdmin, articles }));
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    db.release();
    await pool.end();
  }
}
