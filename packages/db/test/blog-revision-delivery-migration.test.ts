import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrate";
import { seedDemo } from "../src/seed";
import { createArticle, decideArticleReview, getArticle, listArticleActivity, submitArticleForReview, updateArticle, type ArticleBody } from "../src/services/blog";
import { getRevisionState } from "../src/services/blog-publishing";
import { createClient, createWebsite, grantMembership } from "../src/services/registry";
import { createIsolatedDatabase, staffContext, type IsolatedDatabase } from "./isolated";

/**
 * D87 / 0058 compatibility, on isolated databases:
 *  - a clean installation applies every migration including 0057 and 0058;
 *  - a database stopped at 0057 (the locally applied state), holding drafts, an internally
 *    published article and 0057-shaped delivery rows, upgrades with 0058 and keeps its data;
 *  - both end with the same schema for the objects 0057 and 0058 touch.
 */

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const body: ArticleBody = { layout: "clinic-article-v1", blocks: [{ type: "paragraph", text: "Fictional content kept across the upgrade." }] };
const opened: IsolatedDatabase[] = [];

afterAll(async () => {
  for (const db of opened) await db.drop();
});

/** Applies migration files up to and including `last`, exactly as the runner records them. */
async function migrateThrough(db: IsolatedDatabase, last: string): Promise<string[]> {
  await db.admin.query("create table if not exists schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())");
  const applied: string[] = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (file > last) break;
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const client = await db.admin.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [file, createHash("sha256").update(sql).digest("hex")]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw new Error(`${file}: ${(err as Error).message}`);
    } finally {
      client.release();
    }
    applied.push(file);
  }
  return applied;
}

/** A comparable description of every object 0057 and 0058 create or change. */
async function schemaDigest(db: IsolatedDatabase): Promise<unknown> {
  const tables = ["blog_deliveries", "blog_delivery_attempts", "blog_verified_revisions", "website_publishers", "website_blog_publishing", "blog_publications", "blog_activity", "blog_articles"];
  const q = async (sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows;
  return {
    columns: await q("select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = any($1) order by 1, 2", [tables]),
    constraints: await q("select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid::regclass::text = any($1) order by 1, 2", [tables]),
    policies: await q("select tablename, policyname, cmd, qual, with_check from pg_policies where tablename = any($1) order by 1, 2", [tables]),
    triggers: await q("select tgrelid::regclass::text t, tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text = any($1) order by 1, 2", [tables]),
    indexes: await q("select tablename, indexname, indexdef from pg_indexes where tablename = any($1) order by 1, 2", [tables]),
    functions: await q("select proname, md5(pg_get_functiondef(oid)) from pg_proc where proname in ('app_can_ship_website', 'blog_articles_guard', 'blog_deliveries_identity', 'blog_delivery_scope_check', 'blog_delivery_attempts_guard', 'blog_verified_revisions_guard', 'website_publishers_guard', 'published_blog_articles', 'live_blog_index_paths') order by 1"),
    grants: await q("select table_name, privilege_type from information_schema.role_table_grants where grantee = 'cg_app' and table_name = any($1) order by 1, 2", [tables]),
  };
}

let cleanDigest: unknown;

describe("migration 0058 (D87)", () => {
  it("installs cleanly with every migration", async () => {
    const db = await createIsolatedDatabase("clean");
    opened.push(db);
    const result = await runMigrations(db.admin);
    expect(result.applied).toContain("0057_blog_website_publishing.sql");
    expect(result.applied.at(-1)).toBe("0058_blog_revision_delivery.sql");
    const again = await runMigrations(db.admin);
    expect(again.applied).toEqual([]);
    cleanDigest = await schemaDigest(db);
  }, 120_000);

  it("upgrades a database stopped at 0057 without losing drafts, publication history or delivery rows", async () => {
    const db = await createIsolatedDatabase("upgrade");
    opened.push(db);
    const before = await migrateThrough(db, "0057_blog_website_publishing.sql");
    expect(before.at(-1)).toBe("0057_blog_website_publishing.sql");
    await seedDemo(db.admin);
    const admin = await db.staff("admin@example.invalid");
    const specA = await db.staff("specialist-a@example.invalid");
    const reviewer = await db.staff("reviewer@example.invalid");

    // Representative pre-0058 data, written with the 0057 rules (admin/manager publish).
    const seeded = await db.asContext(staffContext(admin), async (tx) => {
      const client = await createClient(tx, { slug: "upgrade-check", name: "Upgrade check clinic", ownerUserId: admin.id, channels: ["website"], isSynthetic: true, notes: null }, admin.id);
      for (const userId of [specA.id, reviewer.id]) await grantMembership(tx, { userId, clientId: client.id }, admin.id);
      const site = await createWebsite(tx, { clientId: client.id, name: "Upgrade site", url: "https://upgrade.example.invalid", platform: "Next.js on Vercel", environment: "production", notes: null }, admin.id);
      const input = (title: string, slug: string) => ({
        clientId: client.id, websiteId: site.id, title, slug, category: "Care", authorUserId: specA.id, reviewerUserId: reviewer.id,
        seoTitle: title, seoDescription: "Fictional.", canonicalPath: null, indexable: true, body,
      });
      const draft = await createArticle(tx, input("Upgrade draft", "upgrade-draft"), admin.id);
      const firstDraftVersion = (await getArticle(tx, draft))!.current_version_id!;
      await updateArticle(tx, draft, { ...input("Upgrade draft, second save", "upgrade-draft"), body: { ...body, blocks: [...body.blocks, { type: "paragraph", text: "Second save." }] } }, admin.id, firstDraftVersion);
      const published = await createArticle(tx, input("Upgrade published", "upgrade-published"), admin.id);
      await submitArticleForReview(tx, published, admin.id);
      await decideArticleReview(tx, published, "approved", null, admin.id);
      // The pre-0058 publish step, as publishArticle performed it.
      await tx.query("select set_config('app.blog_transition', 'publish', true)");
      await tx.query(
        `update blog_articles set status = 'published', working_status = null, live_version_id = current_version_id,
           published_at = now(), first_published_at = now(), updated_by = $2, updated_at = now() where id = $1`,
        [published, admin.id],
      );
      const live = (await getArticle(tx, published))!;
      await tx.query("insert into blog_publications (article_id, client_id, website_id, version_id, action, actor_user_id) values ($1, $2, $3, $4, 'publish', $5)",
        [published, client.id, site.id, live.live_version_id, admin.id]);
      await tx.query("insert into blog_activity (article_id, client_id, version_id, actor_user_id, action) values ($1, $2, $3, $4, 'published')",
        [published, client.id, live.live_version_id, admin.id]);
      // 0057-shaped deliveries in every old state.
      const versions = (await tx.query<{ id: string; article_id: string }>("select id, article_id from blog_article_versions where article_id = any($1) order by article_id, version_number", [[draft, published]])).rows;
      const rows: Array<[string, string, string, number]> = [];
      const states = ["delivering", "failed", "verification_pending"];
      versions.forEach((version, i) => rows.push([version.article_id, version.id, states[i % states.length]!, i + 1]));
      for (const [articleId, versionId, state, attempts] of rows) {
        await tx.query("insert into blog_deliveries (article_id, client_id, website_id, version_id, state, attempts, started_by) values ($1, $2, $3, $4, $5, $6, $7)",
          [articleId, client.id, site.id, versionId, state, attempts, admin.id]);
      }
      return { clientId: client.id, websiteId: site.id, draft, published, liveVersion: live.live_version_id!, deliveries: rows };
    }, { commit: true });
    // A verified 0057 row needs its own revision: give the published article a second (unpublished) version.
    await db.asContext(staffContext(admin), async (tx) => {
      const extra = await createArticle(tx, {
        clientId: seeded.clientId, websiteId: seeded.websiteId, title: "Upgrade verified", slug: "upgrade-verified", category: "Care",
        authorUserId: specA.id, reviewerUserId: reviewer.id, seoTitle: "x", seoDescription: "x", canonicalPath: null, indexable: true, body,
      }, admin.id);
      const version = (await getArticle(tx, extra))!.current_version_id!;
      await tx.query("insert into blog_deliveries (article_id, client_id, website_id, version_id, state, attempts, started_by, verified_at) values ($1, $2, $3, $4, 'verified', 2, $5, now())",
        [extra, seeded.clientId, seeded.websiteId, version, admin.id]);
    }, { commit: true });
    const countsBefore = (await db.admin.query("select (select count(*) from blog_article_versions)::int v, (select count(*) from blog_publications)::int p, (select count(*) from blog_activity)::int a, (select count(*) from blog_deliveries)::int d")).rows[0];

    const upgrade = await runMigrations(db.admin);
    expect(upgrade.applied).toEqual(["0058_blog_revision_delivery.sql"]);

    const countsAfter = (await db.admin.query("select (select count(*) from blog_article_versions)::int v, (select count(*) from blog_publications)::int p, (select count(*) from blog_activity)::int a, (select count(*) from blog_deliveries)::int d")).rows[0];
    expect(countsAfter).toEqual(countsBefore);
    const deliveries = (await db.admin.query<{ state: string; legacy_attempt_count: number; failure_code: string | null }>("select state, legacy_attempt_count, failure_code from blog_deliveries order by legacy_attempt_count")).rows;
    expect(deliveries.map((row) => row.state)).toEqual(expect.arrayContaining(["delivery_pending", "delivery_failed", "awaiting_verification"]));
    expect(deliveries.every((row) => ["delivery_pending", "delivery_failed", "awaiting_verification"].includes(row.state))).toBe(true);
    expect(deliveries.find((row) => row.failure_code === "reverify_after_upgrade")?.state).toBe("awaiting_verification");
    expect(deliveries.map((row) => row.legacy_attempt_count)).toEqual([1, 2, 2, 3]);
    // Nothing is backfilled.
    expect((await db.admin.query("select count(*)::int n from blog_delivery_attempts")).rows[0].n).toBe(0);
    expect((await db.admin.query("select count(*)::int n from blog_verified_revisions")).rows[0].n).toBe(0);

    await db.asContext(staffContext(admin), async (tx) => {
      // The draft reopens with its content and history.
      const draft = (await getArticle(tx, seeded.draft))!;
      expect(draft.status).toBe("draft");
      expect(draft.version_number).toBe(2);
      expect(draft.body.blocks).toHaveLength(2);
      expect((await listArticleActivity(tx, seeded.draft)).map((event) => event.action)).toEqual(["saved", "saved"]);
    });
    await db.asContext(staffContext(admin), async (tx) => {
      const state = (await getRevisionState(tx, seeded.published))!;
      expect(state.released?.versionId).toBe(seeded.liveVersion);
      expect(state.verified).toBeNull();
      // The 0057 delivery of the live version maps to a new state; with none it would read "unverified".
      expect(["delivery_pending", "delivery_failed", "awaiting_verification"]).toContain(state.websiteStatus);
      const history = (await listArticleActivity(tx, seeded.published)).map((event) => event.action);
      expect(history).toContain("published");
    });
    // The content API still serves the released revision.
    expect((await db.admin.query("select count(*)::int n from blog_articles where id = $1 and live_version_id = $2", [seeded.published, seeded.liveVersion])).rows[0].n).toBe(1);

    expect(await schemaDigest(db)).toEqual(cleanDigest);
  }, 180_000);
});
