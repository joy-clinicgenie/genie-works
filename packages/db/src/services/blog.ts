import { createHash, randomBytes } from "node:crypto";
import type { BlogStatus, PlatformRole } from "@clinic-genie/contracts";
import type { Queryable } from "../client";
import { recordAudit } from "./audit";
import { PermissionDeniedError } from "./auth";
import { recordTimeline } from "./timeline";
import {
  BlogRuleError,
  articlePath,
  assertPublishableBody,
  blockText,
  emptyArticleBody,
  isNativeWebsitePlatform,
  parseArticleBody,
  parseBlogRequirements,
  renderPublishedArticle,
  renderPublishedIndex,
  renderPublishedSitemap,
  slugifyTitle,
  type ArticleBody,
  type BlogFieldIssue,
  type BlogRequirements,
} from "./blog-content";

export {
  BlogRuleError,
  articlePath,
  emptyArticleBody,
  isNativeWebsitePlatform,
  parseArticleBody,
  parseBlogRequirements,
  renderPublishedArticle,
  renderPublishedIndex,
  renderPublishedSitemap,
  slugifyTitle,
};
export type { ArticleBlock, ArticleBody, BlogRequirements, RenderedArticle, TextSpan } from "./blog-content";

const PREVIEW_HOURS = 72;
const PAGE_SIZE = 25;

export type WorkingStatus = "draft" | "in_review" | "approved";
export type RevisionIndicator = "draft_revision" | "revision_in_review" | "approved_revision";
export type BlogSort = "updated" | "published";

export interface ArticleInput {
  clientId: string;
  websiteId: string;
  title: string;
  slug: string | null;
  slugEdited?: boolean;
  excerpt?: string;
  category: string;
  authorUserId: string | null;
  reviewerUserId: string | null;
  seoTitle: string;
  seoDescription: string;
  socialTitle?: string;
  socialDescription?: string;
  featuredMediaId?: string | null;
  socialMediaId?: string | null;
  canonicalPath: string | null;
  indexable: boolean;
  body: ArticleBody;
}

interface CleanArticle extends ArticleInput {
  title: string;
  slug: string | null;
  excerpt: string;
  category: string;
  seoTitle: string;
  seoDescription: string;
  socialTitle: string;
  socialDescription: string;
  featuredMediaId: string | null;
  socialMediaId: string | null;
  body: ArticleBody;
}

export interface ArticleRow {
  id: string;
  client_id: string;
  client_name: string;
  website_id: string;
  website_name: string;
  website_platform: string;
  website_url: string | null;
  title: string;
  slug: string | null;
  live_slug: string | null;
  excerpt: string;
  category: string;
  author_user_id: string | null;
  author_name: string | null;
  reviewer_user_id: string | null;
  reviewer_name: string | null;
  status: BlogStatus;
  working_status: WorkingStatus | null;
  revision_indicator: RevisionIndicator | null;
  seo_title: string;
  seo_description: string;
  social_title: string;
  social_description: string;
  featured_media_id: string | null;
  social_media_id: string | null;
  canonical_path: string | null;
  indexable: boolean;
  body: ArticleBody;
  current_version_id: string | null;
  live_version_id: string | null;
  version_number: number | null;
  published_at: Date | null;
  first_published_at: Date | null;
  unpublished_at: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  native: boolean;
  requirements: BlogRequirements;
}

export interface ArticleList {
  articles: ArticleRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<"all" | BlogStatus, number>;
}

export interface ArticleVersionRow {
  id: string;
  version_number: number;
  title: string;
  slug: string | null;
  created_at: Date;
  created_by_name: string;
}

export interface ArticleVersionDetail extends ArticleVersionRow {
  excerpt: string;
  category: string;
  author_name: string | null;
  body: ArticleBody;
  seo_title: string;
  seo_description: string;
  social_title: string;
  social_description: string;
  featured_media_id: string | null;
  social_media_id: string | null;
  canonical_path: string | null;
  indexable: boolean;
}

export interface ArticleApprovalRow {
  id: string;
  decision: "approved" | "returned" | "withdrawn";
  note: string | null;
  decided_at: Date;
  reviewer_name: string;
  version_id: string;
  version_number: number;
}

export interface ArticleActivityRow {
  id: string;
  action: string;
  note: string | null;
  created_at: Date;
  actor_name: string;
  version_number: number | null;
}

export interface ArticleMediaRow {
  id: string;
  alt_text: string;
  content_type: string;
  byte_size: number;
  storage_key: string;
}

const ARTICLE_SELECT = `
  select a.*, c.name as client_name, w.name as website_name, w.platform as website_platform, w.url as website_url,
         w.blog_requirements,
         author.display_name as author_name, reviewer.display_name as reviewer_name,
         v.version_number, live.slug as live_slug
  from blog_articles a
  join clients c on c.id = a.client_id
  join websites w on w.id = a.website_id
  left join staff_users author on author.id = a.author_user_id
  left join staff_users reviewer on reviewer.id = a.reviewer_user_id
  left join blog_article_versions v on v.id = a.current_version_id
  left join blog_article_versions live on live.id = a.live_version_id
`;

function revisionIndicator(status: BlogStatus, working: WorkingStatus | null): RevisionIndicator | null {
  if (status !== "published" || !working) return null;
  if (working === "draft") return "draft_revision";
  if (working === "in_review") return "revision_in_review";
  return "approved_revision";
}

function mapArticle(row: ArticleRow & { body: unknown; blog_requirements?: unknown }): ArticleRow {
  const { blog_requirements, ...article } = row;
  return {
    ...article,
    body: parseArticleBody(row.body),
    native: isNativeWebsitePlatform(row.website_platform),
    requirements: parseBlogRequirements(blog_requirements),
    revision_indicator: revisionIndicator(row.status, row.working_status),
  };
}

async function mark(db: Queryable, transition: string): Promise<void> {
  await db.query("select set_config('app.blog_transition', $1, true)", [transition]);
}

async function recordActivity(db: Queryable, article: { id: string; client_id: string; current_version_id?: string | null }, action: string, actorUserId: string, note?: string | null, versionId?: string | null): Promise<void> {
  await db.query(
    `insert into blog_activity (article_id, client_id, version_id, actor_user_id, action, note)
     values ($1, $2, $3, $4, $5, $6)`,
    [article.id, article.client_id, versionId ?? article.current_version_id ?? null, actorUserId, action, note?.trim() || null],
  );
}

export async function listBlogWebsites(db: Queryable): Promise<Array<{ id: string; name: string; platform: string; url: string | null; client_id: string; client_name: string }>> {
  const { rows } = await db.query(
    `select w.id, w.name, w.platform, w.url, w.client_id, c.name as client_name
     from websites w join clients c on c.id = w.client_id
     where w.status = 'active' order by c.name, w.name`,
  );
  return rows;
}

export async function listArticles(db: Queryable, opts: {
  clientId?: string;
  websiteId?: string;
  status?: BlogStatus;
  authorUserId?: string;
  query?: string;
  sort?: BlogSort;
  page?: number;
  pageSize?: number;
} = {}): Promise<ArticleList> {
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? PAGE_SIZE));
  const page = Math.max(1, opts.page ?? 1);
  const filters = [opts.clientId ?? null, opts.websiteId ?? null, opts.authorUserId ?? null, opts.query?.trim() || null];
  const where = `
    ($1::uuid is null or a.client_id = $1)
    and ($2::uuid is null or a.website_id = $2)
    and ($3::uuid is null or a.author_user_id = $3)
    and ($4::text is null or a.title ilike '%' || $4 || '%')
  `;
  const { rows: countRows } = await db.query<{ all: number; draft: number; in_review: number; approved: number; published: number; archived: number }>(
    `select
       count(*) filter (where a.status <> 'archived')::int as all,
       count(*) filter (where a.status = 'draft')::int as draft,
       count(*) filter (where a.status = 'in_review')::int as in_review,
       count(*) filter (where a.status = 'approved')::int as approved,
       count(*) filter (where a.status = 'published')::int as published,
       count(*) filter (where a.status = 'archived')::int as archived
     from blog_articles a
     where ${where}`,
    filters,
  );
  const counts = countRows[0] ?? { all: 0, draft: 0, in_review: 0, approved: 0, published: 0, archived: 0 };
  const statusSql = "and (($5::text is not null and a.status = $5) or ($5::text is null and a.status <> 'archived'))";
  const order = opts.sort === "published"
    ? "a.first_published_at desc nulls last, a.updated_at desc"
    : "a.updated_at desc";
  const { rows } = await db.query<ArticleRow>(
    `${ARTICLE_SELECT}
     where ${where} ${statusSql}
     order by ${order}
     limit $6 offset $7`,
    [...filters, opts.status ?? null, pageSize, (page - 1) * pageSize],
  );
  const total = opts.status ? counts[opts.status] : counts.all;
  return { articles: rows.map((row) => mapArticle(row)), total, page, pageSize, counts };
}

export async function getArticle(db: Queryable, id: string): Promise<ArticleRow | null> {
  const { rows } = await db.query<ArticleRow>(`${ARTICLE_SELECT} where a.id = $1`, [id]);
  return rows[0] ? mapArticle(rows[0]) : null;
}

export async function listArticleVersions(db: Queryable, articleId: string): Promise<ArticleVersionRow[]> {
  const { rows } = await db.query<ArticleVersionRow>(
    `select v.id, v.version_number, v.title, v.slug, v.created_at, u.display_name as created_by_name
     from blog_article_versions v join staff_users u on u.id = v.created_by
     where v.article_id = $1 order by v.version_number desc`,
    [articleId],
  );
  return rows;
}

export async function getArticleVersion(db: Queryable, articleId: string, versionId: string): Promise<ArticleVersionDetail | null> {
  const { rows } = await db.query<ArticleVersionDetail & { body: unknown }>(
    `select v.id, v.version_number, v.title, v.slug, v.excerpt, v.category, v.body, v.seo_title, v.seo_description,
            v.social_title, v.social_description, v.featured_media_id, v.social_media_id, v.canonical_path, v.indexable,
            v.created_at, u.display_name as created_by_name, author.display_name as author_name
     from blog_article_versions v
     join staff_users u on u.id = v.created_by
     left join staff_users author on author.id = v.author_user_id
     where v.article_id = $1 and v.id = $2`,
    [articleId, versionId],
  );
  const version = rows[0];
  if (!version) return null;
  return { ...version, body: parseArticleBody(version.body) };
}

export async function listArticleApprovals(db: Queryable, articleId: string): Promise<ArticleApprovalRow[]> {
  const { rows } = await db.query<ArticleApprovalRow>(
    `select a.id, a.decision, a.note, a.decided_at, a.version_id, u.display_name as reviewer_name, v.version_number
     from blog_approvals a
     join staff_users u on u.id = a.reviewer_user_id
     join blog_article_versions v on v.id = a.version_id
     where a.article_id = $1 order by a.decided_at desc`,
    [articleId],
  );
  return rows;
}

export async function listArticleActivity(db: Queryable, articleId: string): Promise<ArticleActivityRow[]> {
  const { rows } = await db.query<ArticleActivityRow>(
    `select e.id, e.action, e.note, e.created_at, u.display_name as actor_name, v.version_number
     from blog_activity e
     join staff_users u on u.id = e.actor_user_id
     left join blog_article_versions v on v.id = e.version_id
     where e.article_id = $1
     order by e.created_at desc`,
    [articleId],
  );
  return rows;
}

export async function listArticleMedia(db: Queryable, articleId: string): Promise<ArticleMediaRow[]> {
  const { rows } = await db.query<ArticleMediaRow>(
    "select id, alt_text, content_type, byte_size, storage_key from blog_media where article_id = $1 order by created_at",
    [articleId],
  );
  return rows;
}

async function websiteFor(db: Queryable, clientId: string, websiteId: string): Promise<{ platform: string }> {
  const { rows } = await db.query<{ platform: string }>("select platform from websites where id = $1 and client_id = $2 and status = 'active'", [websiteId, clientId]);
  const site = rows[0];
  if (!site) throw new BlogRuleError("Choose an active website for this client.", "websiteId");
  return site;
}

function bounded(value: string, max: number, label: string, field: string): string {
  const text = value.trim();
  if (text.length > max) throw new BlogRuleError(`${label} must be ${max} characters or fewer.`, field);
  return text;
}

function cleanSlug(value: string | null): string | null {
  const slug = value?.trim() || null;
  if (!slug) return null;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    throw new BlogRuleError("Use a slug made of lowercase letters, numbers and hyphens.", "slug");
  }
  return slug;
}

function cleanInput(input: ArticleInput, existing?: ArticleRow | null): CleanArticle {
  const title = bounded(input.title ?? "", 200, "The title", "title");
  const category = bounded(input.category ?? "", 80, "The category", "category");
  const excerpt = bounded(input.excerpt ?? "", 500, "The excerpt", "excerpt");
  const seoTitle = bounded(input.seoTitle ?? "", 200, "The SEO title", "seoTitle");
  const seoDescription = bounded(input.seoDescription ?? "", 320, "The SEO description", "seoDescription");
  const socialTitle = bounded(input.socialTitle ?? "", 200, "The sharing title", "socialTitle");
  const socialDescription = bounded(input.socialDescription ?? "", 320, "The sharing description", "socialDescription");
  let slug: string | null;
  if (input.slugEdited) slug = cleanSlug(input.slug);
  else if (input.slug?.trim()) slug = cleanSlug(input.slug);
  else if (!title) slug = existing?.slug ?? null;
  else slug = cleanSlug(slugifyTitle(title));
  const canonical = input.canonicalPath?.trim() || null;
  if (canonical && (!canonical.startsWith("/") || canonical.startsWith("//") || canonical.length > 300)) {
    throw new BlogRuleError("Canonical path must start with a single /.", "canonicalPath");
  }
  const authorUserId = input.authorUserId?.trim() || null;
  const featuredMediaId = input.featuredMediaId?.trim() || null;
  const socialMediaId = input.socialMediaId?.trim() || null;
  return {
    ...input,
    title,
    slug,
    excerpt,
    category,
    seoTitle,
    seoDescription,
    socialTitle,
    socialDescription,
    authorUserId,
    featuredMediaId,
    socialMediaId,
    canonicalPath: canonical,
    body: parseArticleBody(input.body),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

async function insertVersion(db: Queryable, articleId: string, clientId: string, input: CleanArticle, actorUserId: string): Promise<string> {
  const next = await db.query<{ n: number }>("select coalesce(max(version_number), 0)::int + 1 as n from blog_article_versions where article_id = $1", [articleId]);
  const { rows } = await db.query<{ id: string }>(
    `insert into blog_article_versions
      (article_id, client_id, version_number, title, slug, excerpt, category, body, seo_title, seo_description,
       social_title, social_description, featured_media_id, social_media_id, canonical_path, indexable, author_user_id, reviewer_user_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) returning id`,
    [
      articleId, clientId, next.rows[0]!.n, input.title, input.slug, input.excerpt, input.category, JSON.stringify(input.body),
      input.seoTitle, input.seoDescription, input.socialTitle, input.socialDescription, input.featuredMediaId, input.socialMediaId,
      input.canonicalPath, input.indexable, input.authorUserId, input.reviewerUserId, actorUserId,
    ],
  );
  return rows[0]!.id;
}

const ARTICLE_WRITE = `
  title = $2, slug = $3, excerpt = $4, category = $5, author_user_id = $6, reviewer_user_id = $7,
  seo_title = $8, seo_description = $9, social_title = $10, social_description = $11,
  featured_media_id = $12, social_media_id = $13, canonical_path = $14, indexable = $15, body = $16::jsonb,
  current_version_id = $17, updated_by = $18, updated_at = now()
`;

function writeParams(id: string, clean: CleanArticle, versionId: string, actorUserId: string, expectedVersionId: string): unknown[] {
  return [
    id, clean.title, clean.slug, clean.excerpt, clean.category, clean.authorUserId, clean.reviewerUserId,
    clean.seoTitle, clean.seoDescription, clean.socialTitle, clean.socialDescription, clean.featuredMediaId, clean.socialMediaId,
    clean.canonicalPath, clean.indexable, JSON.stringify(clean.body), versionId, actorUserId, expectedVersionId,
  ];
}

export async function createArticle(db: Queryable, input: ArticleInput, actorUserId: string): Promise<string> {
  const clean = cleanInput(input);
  await websiteFor(db, clean.clientId, clean.websiteId);
  let id = "";
  try {
    const inserted = await db.query<{ id: string }>(
      `insert into blog_articles
        (client_id, website_id, title, slug, excerpt, category, author_user_id, reviewer_user_id, status,
         seo_title, seo_description, social_title, social_description, canonical_path, indexable, body, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $16) returning id`,
      [
        clean.clientId, clean.websiteId, clean.title, clean.slug, clean.excerpt, clean.category, clean.authorUserId, clean.reviewerUserId,
        clean.seoTitle, clean.seoDescription, clean.socialTitle, clean.socialDescription, clean.canonicalPath, clean.indexable, JSON.stringify(clean.body), actorUserId,
      ],
    );
    id = inserted.rows[0]!.id;
    const versionId = await insertVersion(db, id, clean.clientId, clean, actorUserId);
    await mark(db, "save");
    const { rowCount } = await db.query("update blog_articles set current_version_id = $2 where id = $1", [id, versionId]);
    if (!rowCount) throw new BlogRuleError("Article was not saved.");
    await recordActivity(db, { id, client_id: clean.clientId, current_version_id: versionId }, "saved", actorUserId, null, versionId);
  } catch (error) {
    if (isUniqueViolation(error)) throw new BlogRuleError("That slug is already used on this website.", "slug");
    throw error;
  }
  await recordAudit(db, { actorType: "staff", actorUserId, action: "blog.create", targetType: "blog_article", targetId: id, clientId: clean.clientId, outcome: "success", metadata: { status: "draft" } });
  return id;
}

function editable(article: ArticleRow): boolean {
  if (article.status === "archived" || article.status === "in_review" || article.status === "approved") return false;
  if (article.status === "published" && article.working_status && article.working_status !== "draft") return false;
  return article.status === "draft" || article.status === "published";
}

export async function updateArticle(db: Queryable, id: string, input: ArticleInput, actorUserId: string, expectedVersionId: string): Promise<void> {
  const current = await getArticle(db, id);
  if (!current) throw new BlogRuleError("Article not found.");
  if (!editable(current)) throw new BlogRuleError("Return the article to draft before editing.");
  if (!expectedVersionId || current.current_version_id !== expectedVersionId) {
    throw new BlogRuleError("A newer version was saved. Reload this article before saving.", "expectedVersionId");
  }
  if (input.websiteId && input.websiteId !== current.website_id) {
    throw new BlogRuleError("An article stays on the website where it was created.", "websiteId");
  }
  const clean = cleanInput({ ...input, clientId: current.client_id, websiteId: current.website_id }, current);
  await assertMediaBelongs(db, id, clean.featuredMediaId, "featuredMediaId");
  await assertMediaBelongs(db, id, clean.socialMediaId, "socialMediaId");
  const versionId = await insertVersion(db, id, current.client_id, clean, actorUserId);
  await mark(db, "save");
  const working = current.status === "published" ? "draft" : null;
  let rowCount = 0;
  try {
    const updated = await db.query(
      `update blog_articles set ${ARTICLE_WRITE}, working_status = $20
       where id = $1 and current_version_id = $19`,
      [...writeParams(id, clean, versionId, actorUserId, expectedVersionId), working],
    );
    rowCount = updated.rowCount ?? 0;
  } catch (error) {
    if (isUniqueViolation(error)) throw new BlogRuleError("That slug is already used on this website.", "slug");
    throw error;
  }
  if (!rowCount) throw new BlogRuleError("A newer version was saved. Reload this article before saving.", "expectedVersionId");
  await recordActivity(db, current, "saved", actorUserId, null, versionId);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "blog.update", targetType: "blog_article", targetId: id, clientId: current.client_id, outcome: "success", metadata: { status: current.status, versionId } });
}

export async function startRevision(db: Queryable, id: string, actorUserId: string): Promise<void> {
  const article = await requireArticle(db, id);
  if (article.status !== "published" || !article.live_version_id) throw new BlogRuleError("Only a published article can start a revision.");
  if (article.working_status) throw new BlogRuleError("This article already has a working revision.");
  const live = await getArticleVersion(db, id, article.live_version_id);
  if (!live) throw new BlogRuleError("The live version is missing.");
  const clean = cleanInput({
    clientId: article.client_id,
    websiteId: article.website_id,
    title: live.title,
    slug: live.slug,
    slugEdited: true,
    excerpt: live.excerpt,
    category: live.category,
    authorUserId: article.author_user_id,
    reviewerUserId: article.reviewer_user_id,
    seoTitle: live.seo_title,
    seoDescription: live.seo_description,
    socialTitle: live.social_title,
    socialDescription: live.social_description,
    featuredMediaId: live.featured_media_id,
    socialMediaId: live.social_media_id,
    canonicalPath: live.canonical_path,
    indexable: live.indexable,
    body: live.body,
  }, article);
  const versionId = await insertVersion(db, id, article.client_id, clean, actorUserId);
  await mark(db, "save");
  const { rowCount } = await db.query(
    "update blog_articles set current_version_id = $2, working_status = 'draft', updated_by = $3, updated_at = now() where id = $1 and working_status is null and status = 'published'",
    [id, versionId, actorUserId],
  );
  if (!rowCount) throw new BlogRuleError("A revision was not started.");
  await recordActivity(db, article, "saved", actorUserId, null, versionId);
}

async function assertMediaBelongs(db: Queryable, articleId: string, mediaId: string | null, field: string): Promise<void> {
  if (!mediaId) return;
  const { rows } = await db.query("select 1 from blog_media where id = $1 and article_id = $2", [mediaId, articleId]);
  if (!rows.length) throw new BlogRuleError("Choose an image from this article.", field);
}

async function requireArticle(db: Queryable, id: string): Promise<ArticleRow> {
  const article = await getArticle(db, id);
  if (!article) throw new BlogRuleError("Article not found.");
  return article;
}

async function actorRole(db: Queryable, actorUserId: string): Promise<PlatformRole> {
  const { rows } = await db.query<{ platform_role: PlatformRole }>("select platform_role from staff_users where id = $1 and active", [actorUserId]);
  const role = rows[0]?.platform_role;
  if (!role) throw new PermissionDeniedError();
  return role;
}

function isInReview(article: ArticleRow): boolean {
  return article.status === "in_review" || (article.status === "published" && article.working_status === "in_review");
}

function isApproved(article: ArticleRow): boolean {
  return article.status === "approved" || (article.status === "published" && article.working_status === "approved");
}

function isWorkDraft(article: ArticleRow): boolean {
  return article.status === "draft" || (article.status === "published" && article.working_status === "draft");
}

async function reviewerIsEligible(db: Queryable, clientId: string, reviewerUserId: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>("select blog_reviewer_can_review($1, $2) as ok", [reviewerUserId, clientId]);
  return rows[0]?.ok === true;
}

function readinessIssues(article: ArticleRow, media: ArticleMediaRow[]): BlogFieldIssue[] {
  const issues: BlogFieldIssue[] = [];
  if (!article.title.trim()) issues.push({ field: "title", message: "Enter a title." });
  if (!blockText(article.body.blocks[0] ?? { type: "paragraph", text: "" }).trim() && !article.body.blocks.some((block) => blockText(block).trim())) {
    issues.push({ field: "body", message: "Add some article text." });
  }
  try {
    assertPublishableBody(article.body, new Set(media.map((item) => item.id)));
  } catch (error) {
    if (error instanceof BlogRuleError) issues.push({ field: "body", message: error.message });
    else throw error;
  }
  if (!article.slug) issues.push({ field: "slug", message: "Enter a valid slug." });
  if (!article.reviewer_user_id) issues.push({ field: "reviewerUserId", message: "Choose a reviewer." });
  const rules = article.requirements;
  if (rules.author && !article.author_user_id) issues.push({ field: "authorUserId", message: "This website requires an author." });
  if (rules.category && !article.category.trim()) issues.push({ field: "category", message: "This website requires a category." });
  if (rules.featuredImage && (!article.featured_media_id || !media.some((item) => item.id === article.featured_media_id && item.alt_text.trim()))) {
    issues.push({ field: "featuredMediaId", message: "This website requires a featured image with alt text." });
  }
  if (rules.seo && (!article.seo_title.trim() || !article.seo_description.trim())) {
    issues.push({ field: "seoTitle", message: "This website requires an SEO title and description." });
  }
  if (rules.social && (!article.social_title.trim() || !article.social_description.trim())) {
    issues.push({ field: "socialTitle", message: "This website requires sharing title and description." });
  }
  return issues;
}

export async function submitArticleForReview(db: Queryable, id: string, actorUserId: string): Promise<void> {
  const article = await requireArticle(db, id);
  if (!isWorkDraft(article) || !article.current_version_id) throw new BlogRuleError("Only a draft can be submitted for review.");
  const media = await listArticleMedia(db, id);
  const issues = readinessIssues(article, media);
  if (article.reviewer_user_id && !(await reviewerIsEligible(db, article.client_id, article.reviewer_user_id))) {
    issues.push({ field: "reviewerUserId", message: "Choose a reviewer who can review this client." });
  }
  if (issues.length) throw new BlogRuleError("This article is not ready for review.", issues[0]?.field, issues);
  await mark(db, "submit");
  const nextWorking = article.status === "published" ? "in_review" : null;
  const nextStatus = article.status === "published" ? "published" : "in_review";
  const { rowCount } = await db.query(
    "update blog_articles set status = $2, working_status = $3, updated_by = $4, updated_at = now() where id = $1 and current_version_id = $5",
    [id, nextStatus, nextWorking, actorUserId, article.current_version_id],
  );
  if (!rowCount) throw new BlogRuleError("Article was not submitted.");
  await recordActivity(db, article, "submitted", actorUserId);
  await recordTimeline(db, { clientId: article.client_id, eventType: "article_submitted", title: `Submitted “${article.title || "Untitled article"}” for review`, summary: article.slug ? articlePath(article.slug) : "Draft", relatedType: "blog_article", relatedId: id, actorUserId, dedupeKey: `blog-submit:${article.current_version_id}` });
  await recordAudit(db, { actorType: "staff", actorUserId, action: "blog.submit_review", targetType: "blog_article", targetId: id, clientId: article.client_id, outcome: "success", metadata: { versionId: article.current_version_id } });
}

async function assertAssignedReviewer(db: Queryable, article: ArticleRow, actorUserId: string): Promise<void> {
  const role = await actorRole(db, actorUserId);
  if (role === "admin" || role === "manager") return;
  if (role === "reviewer" && actorUserId === article.reviewer_user_id) return;
  throw new PermissionDeniedError("Only the assigned reviewer can decide.");
}

async function setReviewState(db: Queryable, article: ArticleRow, next: "draft" | "approved", actorUserId: string): Promise<void> {
  const status = article.status === "published" ? "published" : next;
  const working = article.status === "published" ? (next === "approved" ? "approved" : "draft") : null;
  const { rowCount } = await db.query(
    "update blog_articles set status = $2, working_status = $3, updated_by = $4, updated_at = now() where id = $1 and current_version_id = $5",
    [article.id, status, working, actorUserId, article.current_version_id],
  );
  if (!rowCount) throw new BlogRuleError("Review was not recorded.");
}

export async function decideArticleReview(db: Queryable, id: string, decision: "approved" | "returned", note: string | null, actorUserId: string): Promise<void> {
  const article = await requireArticle(db, id);
  if (!isInReview(article) || !article.current_version_id) throw new BlogRuleError("This article is not in review.");
  await assertAssignedReviewer(db, article, actorUserId);
  const feedback = note?.trim() || "";
  if (decision === "returned" && !feedback) throw new BlogRuleError("Enter feedback before requesting changes.", "note");
  await db.query(
    `insert into blog_approvals (article_id, client_id, version_id, reviewer_user_id, decision, note)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, article.client_id, article.current_version_id, actorUserId, decision, feedback || null],
  );
  await mark(db, decision === "approved" ? "approve" : "request_changes");
  await setReviewState(db, article, decision === "approved" ? "approved" : "draft", actorUserId);
  await recordActivity(db, article, decision === "approved" ? "approved" : "changes_requested", actorUserId, feedback || null);
  await recordTimeline(db, {
    clientId: article.client_id,
    eventType: decision === "approved" ? "article_approved" : "article_returned",
    title: decision === "approved" ? `Approved “${article.title || "Untitled article"}”` : `Requested changes on “${article.title || "Untitled article"}”`,
    summary: article.slug ? articlePath(article.slug) : "Draft",
    relatedType: "blog_article",
    relatedId: id,
    actorUserId,
    dedupeKey: decision === "approved" ? `blog-approve:${article.current_version_id}:${Date.now()}` : `blog-return:${article.current_version_id}:${Date.now()}`,
  });
  await recordAudit(db, { actorType: "staff", actorUserId, action: decision === "approved" ? "blog.approve" : "blog.return", targetType: "blog_article", targetId: id, clientId: article.client_id, outcome: "success", metadata: { versionId: article.current_version_id } });
}

export async function returnArticleToDraft(db: Queryable, id: string, actorUserId: string): Promise<void> {
  const article = await requireArticle(db, id);
  if (!article.current_version_id || (!isInReview(article) && !isApproved(article))) {
    throw new BlogRuleError("Only an article in review or an approved article can be returned to draft.");
  }
  const role = await actorRole(db, actorUserId);
  const editor = role === "admin" || role === "manager" || role === "specialist";
  const assigned = role === "reviewer" && actorUserId === article.reviewer_user_id;
  if (!editor && !assigned) throw new PermissionDeniedError("You cannot return this article to draft.");
  await db.query(
    `insert into blog_approvals (article_id, client_id, version_id, reviewer_user_id, decision, note)
     values ($1, $2, $3, $4, 'withdrawn', null)`,
    [id, article.client_id, article.current_version_id, actorUserId],
  );
  await mark(db, "withdraw");
  await setReviewState(db, article, "draft", actorUserId);
  await recordActivity(db, article, "withdrawn", actorUserId);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "blog.withdraw", targetType: "blog_article", targetId: id, clientId: article.client_id, outcome: "success", metadata: { versionId: article.current_version_id } });
}

async function withdrawVersion(db: Queryable, article: ArticleRow, versionId: string, actorUserId: string): Promise<void> {
  await db.query(
    `insert into blog_approvals (article_id, client_id, version_id, reviewer_user_id, decision)
     values ($1, $2, $3, $4, 'withdrawn')`,
    [article.id, article.client_id, versionId, actorUserId],
  );
}

export async function publishArticle(db: Queryable, id: string, actorUserId: string): Promise<void> {
  const role = await actorRole(db, actorUserId);
  if (role !== "admin" && role !== "manager") throw new PermissionDeniedError("Only an admin or manager can publish.");
  const article = await requireArticle(db, id);
  if (!article.native) throw new BlogRuleError("Publishing is not available for this website. Native websites can be published from Genie Works. Wix Blog publishing is not available.");
  if (!article.current_version_id) throw new BlogRuleError("Approve the current version before publishing.");
  if (article.status === "published" && !article.working_status && article.live_version_id === article.current_version_id) return;
  if (!isApproved(article)) throw new BlogRuleError("Approve the current version before publishing.");
  const { rows: decisions } = await db.query<{ decision: string }>(
    "select decision from blog_approvals where article_id = $1 and version_id = $2 order by decided_at desc limit 1",
    [id, article.current_version_id],
  );
  if (decisions[0]?.decision !== "approved") throw new BlogRuleError("Approve the current version before publishing.");
  await mark(db, "publish");
  const { rowCount } = await db.query(
    `update blog_articles
       set status = 'published', working_status = null, live_version_id = current_version_id,
           published_at = now(), first_published_at = coalesce(first_published_at, now()), unpublished_at = null,
           updated_by = $2, updated_at = now()
     where id = $1 and current_version_id = $3`,
    [id, actorUserId, article.current_version_id],
  );
  if (!rowCount) throw new BlogRuleError("Article was not published.");
  const { rows: publication } = await db.query<{ id: string }>(
    `insert into blog_publications (article_id, client_id, website_id, version_id, action, actor_user_id)
     values ($1, $2, $3, $4, 'publish', $5) returning id`,
    [id, article.client_id, article.website_id, article.current_version_id, actorUserId],
  );
  const replacing = Boolean(article.live_version_id);
  await recordActivity(db, article, replacing ? "revision_published" : "published", actorUserId);
  await recordTimeline(db, { clientId: article.client_id, eventType: "article_published", title: `Published “${article.title || "Untitled article"}”`, summary: article.slug ? articlePath(article.slug) : "Article", relatedType: "blog_article", relatedId: id, actorUserId, dedupeKey: `blog-publish:${publication[0]!.id}` });
  await recordAudit(db, { actorType: "staff", actorUserId, action: "blog.publish", targetType: "blog_article", targetId: id, clientId: article.client_id, outcome: "success", metadata: { path: article.slug ? articlePath(article.slug) : null, versionId: article.current_version_id } });
}

export async function unpublishArticle(db: Queryable, id: string, actorUserId: string): Promise<void> {
  const role = await actorRole(db, actorUserId);
  if (role !== "admin" && role !== "manager") throw new PermissionDeniedError("Only an admin or manager can unpublish.");
  const article = await requireArticle(db, id);
  if (!article.live_version_id) throw new BlogRuleError("This article is not published.");
  const live = await getArticleVersion(db, id, article.live_version_id);
  if (!live) throw new BlogRuleError("This article is not published.");
  await withdrawVersion(db, article, article.live_version_id, actorUserId);
  if (article.current_version_id && article.current_version_id !== article.live_version_id) {
    await withdrawVersion(db, article, article.current_version_id, actorUserId);
  }
  await mark(db, "unpublish");
  const { rowCount } = await db.query(
    "update blog_articles set status = 'draft', working_status = null, live_version_id = null, unpublished_at = now(), updated_by = $2, updated_at = now() where id = $1 and live_version_id is not null",
    [id, actorUserId],
  );
  if (!rowCount) throw new BlogRuleError("Article was not unpublished.");
  const { rows: publication } = await db.query<{ id: string }>(
    `insert into blog_publications (article_id, client_id, website_id, version_id, action, actor_user_id)
     values ($1, $2, $3, $4, 'unpublish', $5) returning id`,
    [id, article.client_id, article.website_id, article.live_version_id, actorUserId],
  );
  await recordActivity(db, article, "unpublished", actorUserId, null, article.live_version_id);
  await recordTimeline(db, { clientId: article.client_id, eventType: "article_unpublished", title: `Unpublished “${live.title || "Untitled article"}”`, summary: live.slug ? articlePath(live.slug) : "Article", relatedType: "blog_article", relatedId: id, actorUserId, dedupeKey: `blog-unpublish:${publication[0]!.id}` });
  await recordAudit(db, { actorType: "staff", actorUserId, action: "blog.unpublish", targetType: "blog_article", targetId: id, clientId: article.client_id, outcome: "success", metadata: { path: live.slug ? articlePath(live.slug) : null, versionId: article.live_version_id } });
}

export async function archiveArticle(db: Queryable, id: string, actorUserId: string): Promise<void> {
  const article = await requireArticle(db, id);
  if (article.live_version_id || article.status === "published") throw new BlogRuleError("Unpublish the article before archiving it.");
  if (article.status === "in_review" || article.working_status === "in_review") throw new BlogRuleError("Return the article to draft before archiving it.");
  if (article.status === "archived") return;
  if (article.status !== "draft" && article.status !== "approved") throw new BlogRuleError("Only a draft or approved article can be archived.");
  await mark(db, "archive");
  const { rowCount } = await db.query(
    "update blog_articles set status = 'archived', updated_by = $2, updated_at = now() where id = $1 and status in ('draft', 'approved') and live_version_id is null",
    [id, actorUserId],
  );
  if (!rowCount) throw new BlogRuleError("Article was not archived.");
  await recordActivity(db, article, "archived", actorUserId);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "blog.archive", targetType: "blog_article", targetId: id, clientId: article.client_id, outcome: "success" });
}

export async function restoreArticle(db: Queryable, id: string, actorUserId: string): Promise<void> {
  const article = await requireArticle(db, id);
  if (article.status !== "archived") throw new BlogRuleError("Only an archived article can be restored.");
  await mark(db, "restore");
  const { rowCount } = await db.query(
    "update blog_articles set status = 'draft', working_status = null, updated_by = $2, updated_at = now() where id = $1 and status = 'archived'",
    [id, actorUserId],
  );
  if (!rowCount) throw new BlogRuleError("Article was not restored.");
  await recordActivity(db, article, "restored", actorUserId);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "blog.restore", targetType: "blog_article", targetId: id, clientId: article.client_id, outcome: "success" });
}

export async function restoreArticleVersion(db: Queryable, id: string, versionId: string, actorUserId: string, replaceWorking = false): Promise<void> {
  const article = await requireArticle(db, id);
  if (article.status === "in_review" || article.status === "approved") {
    throw new BlogRuleError("Return the article to draft before restoring a version.");
  }
  if (article.status === "published" && article.working_status && !replaceWorking) {
    throw new BlogRuleError("A working revision already exists. Confirm that it should be replaced.", "replaceWorking");
  }
  const version = await getArticleVersion(db, id, versionId);
  if (!version) throw new BlogRuleError("That version is not on this article.");
  if (article.current_version_id && article.working_status && article.working_status !== "draft") {
    await withdrawVersion(db, article, article.current_version_id, actorUserId);
  }
  const clean = cleanInput({
    clientId: article.client_id,
    websiteId: article.website_id,
    title: version.title,
    slug: version.slug,
    slugEdited: true,
    excerpt: version.excerpt,
    category: version.category,
    authorUserId: article.author_user_id,
    reviewerUserId: article.reviewer_user_id,
    seoTitle: version.seo_title,
    seoDescription: version.seo_description,
    socialTitle: version.social_title,
    socialDescription: version.social_description,
    featuredMediaId: version.featured_media_id,
    socialMediaId: version.social_media_id,
    canonicalPath: version.canonical_path,
    indexable: version.indexable,
    body: version.body,
  }, article);
  const newVersionId = await insertVersion(db, id, article.client_id, clean, actorUserId);
  await mark(db, "restore_version");
  const status = article.live_version_id ? "published" : "draft";
  const working = article.live_version_id ? "draft" : null;
  const { rowCount } = await db.query(
    `update blog_articles set ${ARTICLE_WRITE}, status = $20, working_status = $21
     where id = $1 and current_version_id = $19`,
    [...writeParams(id, clean, newVersionId, actorUserId, article.current_version_id ?? ""), status, working],
  );
  if (!rowCount) throw new BlogRuleError("The version was not restored.");
  await recordActivity(db, article, "version_restored", actorUserId, null, newVersionId);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "blog.restore_version", targetType: "blog_article", targetId: id, clientId: article.client_id, outcome: "success", metadata: { versionId: newVersionId, sourceVersionId: versionId } });
}

export async function addArticleMedia(db: Queryable, articleId: string, input: { storageKey: string; altText: string; contentType: string; byteSize: number }, actorUserId: string): Promise<string> {
  const article = await requireArticle(db, articleId);
  if (article.status === "archived" || !editable(article)) throw new BlogRuleError("This article cannot take new images.");
  const alt = input.altText.trim();
  if (!alt || alt.length > 300) throw new BlogRuleError("Enter alt text of 300 characters or fewer.", "altText");
  if (!["image/png", "image/jpeg", "image/webp"].includes(input.contentType)) throw new BlogRuleError("Use a PNG, JPEG or WebP image.", "file");
  if (input.byteSize < 1 || input.byteSize > 1_000_000) throw new BlogRuleError("Images must be 1 MB or smaller.", "file");
  const { rows } = await db.query<{ id: string }>(
    `insert into blog_media (article_id, client_id, storage_key, alt_text, content_type, byte_size, created_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [articleId, article.client_id, input.storageKey, alt, input.contentType, input.byteSize, actorUserId],
  );
  return rows[0]!.id;
}

export async function getArticleMediaFile(db: Queryable, mediaId: string): Promise<(ArticleMediaRow & { client_id: string }) | null> {
  const { rows } = await db.query<ArticleMediaRow & { client_id: string }>(
    "select id, alt_text, content_type, byte_size, storage_key, client_id from blog_media where id = $1",
    [mediaId],
  );
  return rows[0] ?? null;
}

export async function issueArticlePreview(db: Queryable, articleId: string, actorUserId: string): Promise<{ token: string; expiresAt: Date }> {
  const article = await requireArticle(db, articleId);
  if (!article.current_version_id) throw new BlogRuleError("Save the article before creating a preview.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + PREVIEW_HOURS * 60 * 60 * 1000);
  await db.query(
    "insert into blog_preview_tokens (article_id, client_id, version_id, token_hash, expires_at, created_by) values ($1, $2, $3, $4, $5, $6)",
    [articleId, article.client_id, article.current_version_id, tokenHash, expiresAt, actorUserId],
  );
  return { token, expiresAt };
}

export async function revokeArticlePreviews(db: Queryable, articleId: string, actorUserId: string): Promise<void> {
  const article = await requireArticle(db, articleId);
  const { rowCount } = await db.query(
    "update blog_preview_tokens set revoked_at = now() where article_id = $1 and revoked_at is null and expires_at > now()",
    [articleId],
  );
  if (!rowCount) throw new BlogRuleError("There is no active preview link.");
  await recordAudit(db, { actorType: "staff", actorUserId, action: "blog.preview_revoke", targetType: "blog_article", targetId: articleId, clientId: article.client_id, outcome: "success" });
}

export async function getArticlePreview(db: Queryable, token: string): Promise<ArticleRow | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { rows } = await db.query<{ article_id: string; version_id: string | null }>(
    "select article_id, version_id from blog_preview_tokens where token_hash = $1 and expires_at > now() and revoked_at is null",
    [tokenHash],
  );
  const match = rows[0];
  if (!match) return null;
  const article = await getArticle(db, match.article_id);
  if (!article || !match.version_id) return null;
  const version = await getArticleVersion(db, article.id, match.version_id);
  if (!version) return null;
  return {
    ...article,
    title: version.title,
    slug: version.slug,
    excerpt: version.excerpt,
    category: version.category,
    body: version.body,
    seo_title: version.seo_title,
    seo_description: version.seo_description,
    social_title: version.social_title,
    social_description: version.social_description,
    featured_media_id: version.featured_media_id,
    social_media_id: version.social_media_id,
    canonical_path: version.canonical_path,
    indexable: version.indexable,
    current_version_id: match.version_id,
    version_number: version.version_number,
  };
}

export interface PublishedBlogArticle {
  id: string;
  path: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  authorName: string | null;
  featuredMediaId: string | null;
  featuredAlt: string | null;
  seoTitle: string;
  seoDescription: string;
  socialTitle: string;
  socialDescription: string;
  socialMediaId: string | null;
  canonicalPath: string | null;
  indexable: boolean;
  publishedAt: string;
  updatedAt: string;
  body: ArticleBody;
  media: Array<{ id: string; alt: string; contentType: string }>;
}

export interface PublishedBlog {
  layout: "clinic-article-v1";
  origin: string | null;
  articles: PublishedBlogArticle[];
  sitemap: Array<{ path: string; lastModified: string }>;
}

interface LiveArticleRow {
  id: string;
  published_at: Date | null;
  first_published_at: Date | null;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  author_name: string | null;
  body: unknown;
  seo_title: string;
  seo_description: string;
  social_title: string;
  social_description: string;
  canonical_path: string | null;
  indexable: boolean;
  featured_media_id: string | null;
  social_media_id: string | null;
  revised_at: Date;
  website_url: string | null;
}

function websiteOrigin(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export async function getPublishedBlog(db: Queryable, websiteId: string, token: string): Promise<PublishedBlog | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { rows: authorised } = await db.query("select 1 from seo_site_tokens where website_id = $1 and token_hash = $2 and revoked_at is null", [websiteId, tokenHash]);
  if (!authorised.length) return null;
  const { rows: sites } = await db.query<{ url: string | null }>("select url from websites where id = $1", [websiteId]);
  const { rows } = await db.query<LiveArticleRow>("select * from published_blog_articles($1, $2)", [websiteId, tokenHash]);
  const articles: PublishedBlogArticle[] = [];
  for (const row of rows) {
    const body = parseArticleBody(row.body);
    const used = new Set(body.blocks.flatMap((block) => block.type === "image" ? [block.mediaId] : []));
    if (row.featured_media_id) used.add(row.featured_media_id);
    if (row.social_media_id) used.add(row.social_media_id);
    const media = [];
    for (const mediaId of used) {
      const item = await getPublishedBlogMedia(db, websiteId, mediaId, token);
      if (item) media.push(item);
    }
    const revisedAt = new Date(row.revised_at).toISOString();
    const publishedAt = new Date(row.first_published_at ?? row.published_at ?? row.revised_at).toISOString();
    const featured = media.find((item) => item.id === row.featured_media_id);
    articles.push({
      id: row.id,
      path: articlePath(row.slug),
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      category: row.category,
      authorName: row.author_name,
      featuredMediaId: featured ? row.featured_media_id : null,
      featuredAlt: featured?.alt_text ?? null,
      seoTitle: row.seo_title,
      seoDescription: row.seo_description,
      socialTitle: row.social_title,
      socialDescription: row.social_description,
      socialMediaId: row.social_media_id,
      canonicalPath: row.canonical_path,
      indexable: row.indexable,
      publishedAt,
      updatedAt: revisedAt,
      body,
      media: media.map((item) => ({ id: item.id, alt: item.alt_text, contentType: item.content_type })),
    });
  }
  return {
    layout: "clinic-article-v1",
    origin: websiteOrigin(sites[0]?.url ?? rows[0]?.website_url ?? null),
    articles,
    sitemap: articles.filter((article) => article.indexable).map((article) => ({ path: article.path, lastModified: article.updatedAt })),
  };
}

export async function getPublishedBlogMedia(db: Queryable, websiteId: string, mediaId: string, token: string): Promise<ArticleMediaRow | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { rows: authorised } = await db.query("select 1 from seo_site_tokens where website_id = $1 and token_hash = $2 and revoked_at is null", [websiteId, tokenHash]);
  if (!authorised.length) return null;
  const { rows } = await db.query<ArticleMediaRow & { body: unknown; featured_media_id: string | null; social_media_id: string | null }>(
    "select * from published_blog_media($1, $2, $3)",
    [websiteId, mediaId, tokenHash],
  );
  const media = rows[0];
  if (!media) return null;
  const inBody = parseArticleBody(media.body).blocks.some((block) => block.type === "image" && block.mediaId === media.id);
  const featured = media.featured_media_id === media.id || media.social_media_id === media.id;
  if (!inBody && !featured) return null;
  return { id: media.id, alt_text: media.alt_text, content_type: media.content_type, byte_size: media.byte_size, storage_key: media.storage_key };
}
