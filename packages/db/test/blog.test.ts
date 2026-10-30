import { createHash, randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { applyContext } from "../src/client";
import { adminPool, appPool, asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";
import {
  addArticleMedia,
  archiveArticle,
  createArticle,
  decideArticleReview,
  getArticle,
  getArticlePreview,
  getArticleVersion,
  getPublishedBlog,
  getPublishedBlogMedia,
  isNativeWebsitePlatform,
  issueArticlePreview,
  listArticleActivity,
  listArticles,
  listArticleVersions,
  parseArticleBody,
  publishArticle,
  renderPublishedArticle,
  renderPublishedSitemap,
  restoreArticle,
  restoreArticleVersion,
  returnArticleToDraft,
  revokeArticlePreviews,
  submitArticleForReview,
  unpublishArticle,
  updateArticle,
  type ArticleBody,
  type ArticleInput,
} from "../src/services/blog";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const body: ArticleBody = {
  layout: "clinic-article-v1",
  blocks: [
    { type: "heading", level: 2, text: "After a cleaning" },
    { type: "paragraph", text: "A short fictional note about routine care." },
    { type: "link", href: "https://example.invalid/care", text: "Read the care page" },
  ],
};

describe("native blog", () => {
  it("requires review before publish, updates the native sitemap, and refuses Wix", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    const reviewer = await staffByEmail("reviewer@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const meridian = await clientBySlug("meridian-skin");
    const harbour = await clientBySlug("harbourview-dental");
    const native = (await adminPool.query<{ id: string }>("select id from websites where client_id = $1 and platform = 'Next.js on Vercel' and environment = 'production'", [meridian])).rows[0]!;
    const wix = (await adminPool.query<{ id: string }>("select id from websites where client_id = $1 and platform = 'Wix'", [harbour])).rows[0]!;

    await asContext(staffCtx(admin), async (db) => {
      await applyContext(db, staffCtx(specA));
      const id = await createArticle(db, {
        clientId: meridian,
        websiteId: native.id,
        title: "Routine care note",
        slug: "routine-care-note",
        category: "Care",
        authorUserId: specA.id,
        reviewerUserId: reviewer.id,
        seoTitle: "Routine care note",
        seoDescription: "A fictional article for the native clinic website.",
        canonicalPath: null,
        indexable: true,
        body,
      }, specA.id);
      await expect(publishArticle(db, id, specA.id)).rejects.toThrow(/admin or manager/);
      await submitArticleForReview(db, id, specA.id);
      await expect(decideArticleReview(db, id, "approved", null, specA.id)).rejects.toThrow();
      await applyContext(db, staffCtx(reviewer));
      await decideArticleReview(db, id, "approved", "Ready", reviewer.id);
      await expect(publishArticle(db, id, reviewer.id)).rejects.toThrow();
      await applyContext(db, staffCtx(admin));
      await publishArticle(db, id, admin.id);
      const published = await getArticle(db, id);
      expect(published?.status).toBe("published");
      expect(published?.version_number).toBe(1);

      await applyContext(db, { kind: "service" });
      const token = randomBytes(32).toString("base64url");
      await db.query(
        "insert into seo_site_tokens (client_id, website_id, token_hash, created_by) values ($1, $2, $3, $4)",
        [meridian, native.id, createHash("sha256").update(token).digest("hex"), admin.id],
      );
      const live = await getPublishedBlog(db, native.id, token);
      expect(live?.layout).toBe("clinic-article-v1");
      expect(live?.sitemap).toEqual([expect.objectContaining({ path: "/blog/routine-care-note" })]);
      expect(live?.articles[0]?.body.blocks).toHaveLength(3);

      await applyContext(db, staffCtx(admin));
      await unpublishArticle(db, id, admin.id);
      await applyContext(db, { kind: "service" });
      const after = await getPublishedBlog(db, native.id, token);
      expect(after?.sitemap).toEqual([]);
      expect(after?.articles).toEqual([]);

      await applyContext(db, staffCtx(specA));
      const wixId = await createArticle(db, {
        clientId: harbour,
        websiteId: wix.id,
        title: "Wix draft",
        slug: null,
        category: "News",
        authorUserId: specA.id,
        reviewerUserId: reviewer.id,
        seoTitle: "Wix draft",
        seoDescription: "This draft stays in Genie Works.",
        canonicalPath: null,
        indexable: true,
        body,
      }, specA.id);
      await submitArticleForReview(db, wixId, specA.id);
      await applyContext(db, staffCtx(reviewer));
      await decideArticleReview(db, wixId, "approved", null, reviewer.id);
      await applyContext(db, staffCtx(admin));
      await expect(publishArticle(db, wixId, admin.id)).rejects.toThrow(/not available/);
      expect((await getArticle(db, wixId))?.status).toBe("approved");
      await archiveArticle(db, wixId, admin.id);

      await applyContext(db, staffCtx(specB));
      expect(await getArticle(db, id)).toBeNull();
    });
  });

  it("keeps the live revision public while a draft changes, then removes it on unpublish", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    const reviewer = await staffByEmail("reviewer@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const meridian = await clientBySlug("meridian-skin");
    const native = (await adminPool.query<{ id: string }>("select id from websites where client_id = $1 and platform = 'Next.js on Vercel' and environment = 'production'", [meridian])).rows[0]!;
    const staging = (await adminPool.query<{ id: string }>("select id from websites where client_id = $1 and platform = 'Next.js on Vercel' and environment = 'staging'", [meridian])).rows[0]!;
    const input: ArticleInput = {
      clientId: meridian,
      websiteId: native.id,
      title: "Public care note",
      slug: "public-care-note",
      category: "Care",
      authorUserId: specA.id,
      reviewerUserId: reviewer.id,
      seoTitle: "Public care note",
      seoDescription: "A fictional published note.",
      canonicalPath: "/blog/public-care-note",
      indexable: true,
      body,
    };

    await asContext(staffCtx(admin), async (db) => {
      await applyContext(db, staffCtx(specA));
      const id = await createArticle(db, input, specA.id);
      const sameSlug = await createArticle(db, { ...input, websiteId: staging.id, title: "Staging care note" }, specA.id);
      expect(sameSlug).not.toBe(id);
      await db.query("savepoint duplicate_slug");
      await expect(createArticle(db, { ...input, title: "Duplicate slug" }, specA.id)).rejects.toThrow(/slug/);
      await db.query("rollback to savepoint duplicate_slug");
      await expect(publishArticle(db, id, admin.id)).rejects.toThrow(/not published|Approve|admin or manager/);

      const token = randomBytes(32).toString("base64url");
      await applyContext(db, { kind: "service" });
      await db.query("insert into seo_site_tokens (client_id, website_id, token_hash, created_by) values ($1, $2, $3, $4)", [meridian, native.id, createHash("sha256").update(token).digest("hex"), admin.id]);
      expect((await getPublishedBlog(db, native.id, token))?.articles).toEqual([]);
      expect((await db.query("select id from blog_articles where id = $1", [id])).rows).toEqual([]);
      expect((await db.query("select id from blog_article_versions where article_id = $1", [id])).rows).toEqual([]);
      expect(await getArticlePreview(db, "not-a-preview")).toBeNull();

      await applyContext(db, staffCtx(specA));
      const preview = await issueArticlePreview(db, id, specA.id);
      await applyContext(db, { kind: "service" });
      expect(await getArticlePreview(db, preview.token)).toBeNull();
      await applyContext(db, staffCtx(specA));
      await submitArticleForReview(db, id, specA.id);
      await applyContext(db, staffCtx(reviewer));
      await decideArticleReview(db, id, "approved", "Ready for the fictional site", reviewer.id);
      await applyContext(db, staffCtx(admin));
      await publishArticle(db, id, admin.id);
      const mediaId = await addArticleMedia(db, id, { storageKey: "blog/synthetic.png", altText: "Fictional diagram", contentType: "image/png", byteSize: 12 }, admin.id);

      await applyContext(db, { kind: "service" });
      const live = await getPublishedBlog(db, native.id, token);
      expect(live?.articles.map((article) => article.slug)).toEqual(["public-care-note"]);
      expect(live?.sitemap).toEqual([expect.objectContaining({ path: "/blog/public-care-note" })]);
      expect(live?.origin).toBe("https://meridian-skin.example.invalid");
      expect(JSON.stringify(live)).not.toContain("javascript:");
      expect(await getPublishedBlogMedia(db, native.id, mediaId, token)).toBeNull();
      const html = renderPublishedArticle(live!.articles[0]!, live!.origin, "/media");
      expect(html).toContain("<h1>Public care note</h1>");
      expect(html).toContain('rel="canonical" href="https://meridian-skin.example.invalid/blog/public-care-note"');
      expect(html).not.toContain("<script");
      const xml = renderPublishedSitemap(live!.articles, live!.origin);
      expect(xml).toContain("https://meridian-skin.example.invalid/blog/public-care-note");
      expect(xml).not.toContain("preview");

      await applyContext(db, staffCtx(specA));
      const published = await getArticle(db, id);
      await updateArticle(db, id, { ...input, title: "Draft only sentence", slug: "draft-only-sentence", body: { ...body, blocks: [...body.blocks, { type: "paragraph", text: "DRAFT-SENTENCE" }] } }, specA.id, published!.current_version_id!);
      const draft = await getArticle(db, id);
      expect(draft?.status).toBe("published");
      expect(draft?.working_status).toBe("draft");
      expect(draft?.live_version_id).toBe(published?.current_version_id);
      expect(draft?.title).toBe("Draft only sentence");
      const approvals = await db.query<{ version_id: string }>("select version_id from blog_approvals where article_id = $1 and decision = 'approved'", [id]);
      expect(approvals.rows.map((row) => row.version_id)).toContain(published?.current_version_id);
      expect(approvals.rows.map((row) => row.version_id)).not.toContain(draft?.current_version_id);
      await applyContext(db, staffCtx(admin));
      await expect(publishArticle(db, id, admin.id)).rejects.toThrow(/Approve|not published|approved/);
      await applyContext(db, staffCtx(specA));
      const opened = await getArticlePreview(db, preview.token);
      expect(opened?.title).toBe("Public care note");
      expect(opened?.version_number).toBe(1);
      await revokeArticlePreviews(db, id, specA.id);
      expect(await getArticlePreview(db, preview.token)).toBeNull();
      await expect(updateArticle(db, id, input, specA.id, published!.current_version_id!)).rejects.toThrow(/newer version/);
      expect((await getArticle(db, id))?.title).toBe("Draft only sentence");

      await applyContext(db, { kind: "service" });
      const stillLive = await getPublishedBlog(db, native.id, token);
      expect(stillLive?.articles[0]?.title).toBe("Public care note");
      expect(stillLive?.sitemap[0]?.path).toBe("/blog/public-care-note");
      expect(JSON.stringify(stillLive)).not.toContain("DRAFT-SENTENCE");
      expect(JSON.stringify(stillLive)).not.toContain("draft-only-sentence");
      expect((await db.query("select title from blog_articles where id = $1", [id])).rows).toEqual([]);
      expect((await db.query("select id from blog_article_versions where article_id = $1", [id])).rows).toEqual([]);

      await applyContext(db, staffCtx(admin));
      await unpublishArticle(db, id, admin.id);
      const after = await getArticle(db, id);
      expect(after?.status).toBe("draft");
      expect(after?.live_version_id).toBeNull();
      expect((await listArticleVersions(db, id)).length).toBeGreaterThan(1);
      await applyContext(db, { kind: "service" });
      const removed = await getPublishedBlog(db, native.id, token);
      expect(removed?.articles).toEqual([]);
      expect(removed?.sitemap).toEqual([]);
      expect(renderPublishedSitemap(removed!.articles, removed!.origin)).not.toContain("public-care-note");

      await applyContext(db, staffCtx(specA));
      const events = await db.query<{ event_type: string }>("select event_type from timeline_events where related_id = $1 order by occurred_at", [id]);
      expect(events.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining(["article_submitted", "article_approved", "article_published", "article_unpublished"]));
      const audit = await db.query<{ metadata: { versionId?: string; body?: string } }>("select metadata from audit_events where target_id = $1 and action = 'blog.publish'", [id]);
      expect(audit.rows[0]?.metadata.versionId).toBeTruthy();
      expect(JSON.stringify(audit.rows[0]?.metadata)).not.toContain("DRAFT-SENTENCE");
      expect(JSON.stringify(audit.rows[0]?.metadata)).not.toContain("routine care");

      await applyContext(db, staffCtx(specB));
      expect(await getArticle(db, id)).toBeNull();
      expect((await listArticles(db, { query: "Public care note" })).articles).toEqual([]);
      expect((await listArticles(db, { query: "Draft only" })).articles).toEqual([]);
    });
  });

  it("rejects unsafe links and does not put hidden articles in a sitemap", () => {
    expect(() => parseArticleBody({ layout: "clinic-article-v1", blocks: [{ type: "link", href: "javascript:alert(1)", text: "Open" }] })).toThrow(/http or https/);
    const xml = renderPublishedSitemap([
      { path: "/blog/visible-note", indexable: true, updatedAt: "2026-10-28T00:00:00.000Z" },
      { path: "/blog/hidden-note", indexable: false, updatedAt: "2026-10-28T00:00:00.000Z" },
    ], "https://meridian-skin.example.invalid");
    expect(xml).toContain("/blog/visible-note");
    expect(xml).not.toContain("hidden-note");
    expect(xml).not.toContain("/blog/preview");
    const html = renderPublishedArticle({
      path: "/blog/hidden-note",
      slug: "hidden-note",
      title: "Hidden <script>alert(1)</script>",
      category: "Care",
      seoTitle: "Hidden note",
      seoDescription: "Not indexed",
      canonicalPath: null,
      indexable: false,
      updatedAt: "2026-10-28T00:00:00.000Z",
      body,
    }, "https://meridian-skin.example.invalid", "/media");
    expect(html).toContain("noindex,nofollow");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("keeps drafts incomplete, isolates clients, and publishes only the approved live snapshot", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const manager = await staffByEmail("manager@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const reviewer = await staffByEmail("reviewer@example.invalid");
    const readOnly = await staffByEmail("readonly@example.invalid");
    const meridian = await clientBySlug("meridian-skin");
    const harbour = await clientBySlug("harbourview-dental");
    const native = (await adminPool.query<{ id: string }>("select id from websites where client_id = $1 and platform = 'Next.js on Vercel' and environment = 'production'", [meridian])).rows[0]!;
    const staging = (await adminPool.query<{ id: string }>("select id from websites where client_id = $1 and platform = 'Next.js on Vercel' and environment = 'staging'", [meridian])).rows[0]!;
    const otherNative = (await adminPool.query<{ id: string }>("select id from websites where client_id = $1 and platform ilike '%next%' limit 1", [harbour])).rows[0];

    await asContext(staffCtx(admin), async (db) => {
      await applyContext(db, staffCtx(specA));
      const draftId = await createArticle(db, {
        clientId: meridian,
        websiteId: native.id,
        title: "",
        slug: null,
        category: "",
        authorUserId: null,
        reviewerUserId: null,
        seoTitle: "",
        seoDescription: "",
        canonicalPath: null,
        indexable: true,
        body: { layout: "clinic-article-v1", blocks: [{ type: "paragraph", text: "" }] },
      }, specA.id);
      const reopened = await getArticle(db, draftId);
      expect(reopened?.created_by).toBe(specA.id);
      expect(reopened?.website_id).toBe(native.id);
      expect(reopened?.title).toBe("");
      expect(reopened?.slug).toBeNull();
      await expect(submitArticleForReview(db, draftId, specA.id)).rejects.toMatchObject({ field: "title" });

      const input: ArticleInput = {
        clientId: meridian,
        websiteId: native.id,
        title: "Versioned care note",
        slug: "versioned-care-note",
        category: "Care",
        authorUserId: specA.id,
        reviewerUserId: reviewer.id,
        seoTitle: "Versioned care note",
        seoDescription: "A fictional note.",
        canonicalPath: null,
        indexable: true,
        body,
      };
      const id = await createArticle(db, input, specA.id);
      const sameSlug = await createArticle(db, { ...input, websiteId: staging.id, title: "Staging versioned note" }, specA.id);
      expect(sameSlug).not.toBe(id);
      await expect(updateArticle(db, id, input, specA.id, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/newer version/);
      expect((await getArticle(db, id))?.title).toBe("Versioned care note");

      await submitArticleForReview(db, id, specA.id);
      await expect(updateArticle(db, id, input, specA.id, (await getArticle(db, id))!.current_version_id!)).rejects.toThrow(/draft/);
      await applyContext(db, staffCtx(reviewer));
      await expect(decideArticleReview(db, id, "returned", "  ", reviewer.id)).rejects.toThrow(/feedback/);
      await decideArticleReview(db, id, "returned", "Please name the fictional clinic.", reviewer.id);
      const returned = await getArticle(db, id);
      expect(returned?.status).toBe("draft");
      const feedback = await listArticleActivity(db, id);
      expect(feedback.some((event) => event.action === "changes_requested" && event.note?.includes("fictional clinic"))).toBe(true);

      await applyContext(db, staffCtx(specA));
      const current = await getArticle(db, id);
      await updateArticle(db, id, { ...input, title: "Versioned care note revised" }, specA.id, current!.current_version_id!);
      await submitArticleForReview(db, id, specA.id);
      await applyContext(db, staffCtx(specB));
      await expect(decideArticleReview(db, id, "approved", null, specB.id)).rejects.toThrow();
      await applyContext(db, staffCtx(reviewer));
      const submitted = await getArticle(db, id);
      await decideArticleReview(db, id, "approved", null, reviewer.id);
      await applyContext(db, staffCtx(specA));
      await returnArticleToDraft(db, id, specA.id);
      await expect(publishArticle(db, id, admin.id)).rejects.toThrow(/Approve/);
      const stale = await getArticle(db, id);
      expect(stale?.status).toBe("draft");
      expect(stale?.current_version_id).toBe(submitted?.current_version_id);
      await submitArticleForReview(db, id, specA.id);
      await applyContext(db, staffCtx(manager));
      await decideArticleReview(db, id, "approved", null, manager.id);
      await publishArticle(db, id, manager.id);
      await publishArticle(db, id, manager.id);
      const publications = await db.query<{ count: number }>("select count(*)::int as count from blog_publications where article_id = $1 and action = 'publish'", [id]);
      expect(publications.rows[0]?.count).toBe(1);

      const token = randomBytes(32).toString("base64url");
      await applyContext(db, { kind: "service" });
      await db.query("insert into seo_site_tokens (client_id, website_id, token_hash, created_by) values ($1, $2, $3, $4)", [meridian, native.id, createHash("sha256").update(token).digest("hex"), admin.id]);
      const live = await getPublishedBlog(db, native.id, token);
      expect(live?.articles.map((article) => article.title)).toEqual(["Versioned care note revised"]);
      expect(JSON.stringify(live)).not.toContain("Please name");

      await applyContext(db, staffCtx(specA));
      const published = await getArticle(db, id);
      await updateArticle(db, id, { ...input, title: "Working revision sentence", slug: "working-revision-sentence", body: { ...body, blocks: [...body.blocks, { type: "paragraph", text: "WORKING-REVISION" }] } }, specA.id, published!.current_version_id!);
      await applyContext(db, { kind: "service" });
      const still = await getPublishedBlog(db, native.id, token);
      expect(still?.articles[0]?.title).toBe("Versioned care note revised");
      expect(still?.articles[0]?.slug).toBe("versioned-care-note");
      expect(JSON.stringify(still)).not.toContain("WORKING-REVISION");

      await applyContext(db, staffCtx(specA));
      const revision = await getArticle(db, id);
      expect(revision?.status).toBe("published");
      expect(revision?.revision_indicator).toBe("draft_revision");
      await submitArticleForReview(db, id, specA.id);
      await applyContext(db, staffCtx(reviewer));
      await decideArticleReview(db, id, "approved", null, reviewer.id);
      await applyContext(db, staffCtx(admin));
      await db.query("savepoint publish_failure");
      await db.query("select set_config('app.blog_transition', 'publish', true)");
      await expect(db.query("update blog_articles set live_version_id = null where id = $1", [id])).rejects.toThrow();
      await db.query("rollback to savepoint publish_failure");
      const preserved = await getArticle(db, id);
      expect(preserved?.live_version_id).toBe(published?.live_version_id);
      expect(preserved?.working_status).toBe("approved");
      await publishArticle(db, id, admin.id);
      await applyContext(db, { kind: "service" });
      const replaced = await getPublishedBlog(db, native.id, token);
      expect(replaced?.articles[0]?.slug).toBe("working-revision-sentence");
      expect(replaced?.articles.map((article) => article.slug)).toEqual(["working-revision-sentence"]);

      await applyContext(db, staffCtx(admin));
      await expect(archiveArticle(db, id, admin.id)).rejects.toThrow(/Unpublish/);
      await unpublishArticle(db, id, admin.id);
      const unpublished = await getArticle(db, id);
      expect(unpublished?.status).toBe("draft");
      expect(unpublished?.live_version_id).toBeNull();
      expect(unpublished?.title).toBe("Working revision sentence");
      await applyContext(db, { kind: "service" });
      expect((await getPublishedBlog(db, native.id, token))?.articles).toEqual([]);

      await applyContext(db, staffCtx(specA));
      await submitArticleForReview(db, id, specA.id);
      await expect(archiveArticle(db, id, specA.id)).rejects.toThrow(/draft/);
      await returnArticleToDraft(db, id, specA.id);
      const source = (await listArticleVersions(db, id)).at(-1)!;
      await restoreArticleVersion(db, id, source.id, specA.id);
      const restored = await getArticle(db, id);
      expect(restored?.status).toBe("draft");
      expect(restored?.current_version_id).not.toBe(source.id);
      expect((await listArticleVersions(db, id)).some((version) => version.id === source.id)).toBe(true);
      await archiveArticle(db, id, specA.id);
      expect((await getArticle(db, id))?.status).toBe("archived");
      await restoreArticle(db, id, specA.id);
      expect((await getArticle(db, id))?.status).toBe("draft");
      await expect(publishArticle(db, id, admin.id)).rejects.toThrow(/Approve/);

      await applyContext(db, staffCtx(specB));
      expect(await getArticle(db, id)).toBeNull();
      expect(await getArticleVersion(db, id, source.id)).toBeNull();
      expect(await listArticleActivity(db, id)).toEqual([]);
      expect((await listArticles(db, { websiteId: native.id })).articles).toEqual([]);
      if (readOnly) expect(readOnly.id).not.toBe(specA.id);
      expect(otherNative || harbour).toBeTruthy();
    });
  });

  it("identifies native websites without treating Wix as publishable", () => {
    expect(isNativeWebsitePlatform("Next.js on Vercel")).toBe(true);
    expect(isNativeWebsitePlatform("Wix")).toBe(false);
    expect(isNativeWebsitePlatform("unknown")).toBe(false);
  });
});
