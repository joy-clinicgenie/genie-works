import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import pg from "pg";
import { applyContext } from "../packages/db/src/client.ts";
import { runMigrations } from "../packages/db/src/migrate.ts";
import { seedDemo } from "../packages/db/src/seed.ts";
import { addArticleMedia, createArticle, decideArticleReview, getArticle, submitArticleForReview, updateArticle, type ArticleBody } from "../packages/db/src/services/blog.ts";
import { saveWebsiteConnection } from "../packages/db/src/services/blog-publishing.ts";
import { createClient, grantMembership } from "../packages/db/src/services/registry.ts";
import { DATABASE, FIXTURE_FILE, PUBLISH_SECRET, SITE_ORIGIN, SITE_TOKEN, TOKEN_KEY, UPLOADS, WEBSITE_ID, adminUrl } from "./target.mts";

/** A small valid PNG (solid teal), so the website's image optimiser can decode it. */
function png(size = 8): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([19, 108, 114]))]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array(size).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}

export default async function globalSetup(): Promise<void> {
  process.env.ANALYTICS_TOKEN_KEY = TOKEN_KEY;
  const maintenance = new pg.Client({ connectionString: adminUrl("postgres") });
  await maintenance.connect();
  await maintenance.query(`drop database if exists ${DATABASE} with (force)`);
  await maintenance.query(`create database ${DATABASE}`);
  await maintenance.end();
  mkdirSync(join(UPLOADS, "blog"), { recursive: true });

  const pool = new pg.Pool({ connectionString: adminUrl() });
  await runMigrations(pool);
  await seedDemo(pool);
  const staff = async (email: string) => (await pool.query("select id from staff_users where email = $1", [email])).rows[0].id as string;
  const [admin, specialist, reviewer] = await Promise.all(["admin", "specialist-a", "reviewer"].map((n) => staff(`${n}@example.invalid`)));
  const db = await pool.connect();
  try {
    await db.query("begin");
    await applyContext(db, { kind: "staff", userId: admin, role: "admin" });
    const client = await createClient(db, { slug: "ship-check-clinic", name: "Ship Check Clinic (fictional)", ownerUserId: admin, channels: ["website"], isSynthetic: true, notes: null }, admin);
    for (const userId of [specialist, reviewer]) await grantMembership(db, { userId, clientId: client.id }, admin);
    // A fixed website id, so the website's environment can name it before setup runs.
    await db.query(
      "insert into websites (id, client_id, name, url, platform, environment) values ($1, $2, 'Ship check website', $3, 'Next.js on Vercel', 'production')",
      [WEBSITE_ID, client.id, SITE_ORIGIN],
    );
    await saveWebsiteConnection(db, { websiteId: WEBSITE_ID, basePath: "/genie-tips", secret: PUBLISH_SECRET }, admin);
    await db.query("insert into seo_site_tokens (client_id, website_id, token_hash, created_by) values ($1, $2, $3, $4)",
      [client.id, WEBSITE_ID, createHash("sha256").update(SITE_TOKEN).digest("hex"), admin]);

    const body: ArticleBody = { layout: "clinic-article-v1", blocks: [
      { type: "heading", level: 2, text: "Why it matters" },
      { type: "paragraph", text: "A fictional Genie Works article delivered to the test website." },
      { type: "list", ordered: false, items: ["First point", "Second point"] },
    ] };
    await applyContext(db, { kind: "staff", userId: specialist, role: "specialist" });
    const input = { clientId: client.id, websiteId: WEBSITE_ID, title: "Shipped clinic note", slug: "shipped-clinic-note", category: "Care", authorUserId: specialist, reviewerUserId: reviewer, seoTitle: "Shipped clinic note", seoDescription: "A fictional shipped article.", canonicalPath: null, indexable: true, body };
    const id = await createArticle(db, input, specialist);
    const bytes = png();
    const storageKey = `blog/${client.id}/featured.png`;
    mkdirSync(join(UPLOADS, "blog", client.id), { recursive: true });
    writeFileSync(join(UPLOADS, storageKey), bytes);
    const mediaId = await addArticleMedia(db, id, { storageKey, altText: "A teal square standing in for a clinic photo", contentType: "image/png", byteSize: bytes.length }, specialist);
    const draft = (await getArticle(db, id))!;
    await updateArticle(db, id, { ...input, featuredMediaId: mediaId }, specialist, draft.current_version_id!);
    await submitArticleForReview(db, id, specialist);
    await applyContext(db, { kind: "staff", userId: reviewer, role: "reviewer" });
    await decideArticleReview(db, id, "approved", null, reviewer);
    await db.query("commit");
    writeFileSync(FIXTURE_FILE, JSON.stringify({ clientId: client.id, websiteId: WEBSITE_ID, articleId: id, admin, specialist, reviewer }));
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    db.release();
    await pool.end();
  }
}
