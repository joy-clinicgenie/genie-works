import { BLOG_LAYOUT } from "@clinic-genie/contracts";

export const BLOG_LAYOUT_ID = BLOG_LAYOUT;

export interface BlogFieldIssue {
  field: string;
  message: string;
}

export class BlogRuleError extends Error {
  field?: string;
  issues?: BlogFieldIssue[];
  constructor(message: string, field?: string, issues?: BlogFieldIssue[]) {
    super(message);
    this.name = "BlogRuleError";
    this.field = field ?? issues?.[0]?.field;
    this.issues = issues;
  }
}

export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type ArticleBlock =
  | { type: "paragraph"; text: string; spans?: TextSpan[] }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "link"; href: string; text: string }
  | { type: "image"; mediaId: string; alt: string };

export interface ArticleBody {
  layout: typeof BLOG_LAYOUT;
  blocks: ArticleBlock[];
}

export interface BlogRequirements {
  author: boolean;
  category: boolean;
  featuredImage: boolean;
  seo: boolean;
  social: boolean;
}

export const PERMISSIVE_BLOG_REQUIREMENTS: BlogRequirements = {
  author: false,
  category: false,
  featuredImage: false,
  seo: false,
  social: false,
};

/** Native clinic sites are Next.js deployments. Wix is never treated as native. */
export function isNativeWebsitePlatform(platform: string): boolean {
  const value = platform.trim().toLowerCase();
  if (!value || value.includes("wix")) return false;
  return value.includes("next.js") || value.includes("nextjs") || value.includes("vercel");
}

export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "article";
}

export function articlePath(slug: string): string {
  return `/blog/${slug}`;
}

export function emptyArticleBody(): ArticleBody {
  return { layout: BLOG_LAYOUT, blocks: [{ type: "paragraph", text: "" }] };
}

export function parseBlogRequirements(value: unknown): BlogRequirements {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    author: row.author === true,
    category: row.category === true,
    featuredImage: row.featuredImage === true,
    seo: row.seo === true,
    social: row.social === true,
  };
}

export function parseArticleBody(value: unknown): ArticleBody {
  if (!value || typeof value !== "object") throw new BlogRuleError("Article content is missing.", "body");
  const body = value as { layout?: unknown; blocks?: unknown };
  if (body.layout !== BLOG_LAYOUT || !Array.isArray(body.blocks)) throw new BlogRuleError("Article content uses an unknown layout.", "body");
  if (body.blocks.length > 80) throw new BlogRuleError("Use 80 content blocks or fewer.", "body");
  return { layout: BLOG_LAYOUT, blocks: body.blocks.map(parseBlock) };
}

function parseBlock(value: unknown, index = 0): ArticleBlock {
  if (!value || typeof value !== "object") throw new BlogRuleError("A content block is invalid.", "body");
  const block = value as { type?: unknown; text?: unknown; level?: unknown; href?: unknown; mediaId?: unknown; alt?: unknown; ordered?: unknown; items?: unknown; spans?: unknown };
  if (block.type === "paragraph" || block.type === "heading") {
    const text = stringField(block.text, 4000, "Block text", true);
    if (block.type === "heading") {
      const level = block.level === 2 || block.level === 3 ? block.level : null;
      if (!level) throw new BlogRuleError("Headings are level 2 or 3.", "body");
      return { type: "heading", level, text };
    }
    const spans = Array.isArray(block.spans) ? block.spans.map(parseSpan) : undefined;
    return spans ? { type: "paragraph", text, spans } : { type: "paragraph", text };
  }
  if (block.type === "list") {
    if (!Array.isArray(block.items) || block.items.length < 1 || block.items.length > 40) {
      throw new BlogRuleError("A list needs between 1 and 40 items.", "body");
    }
    return { type: "list", ordered: block.ordered === true, items: block.items.map((item) => stringField(item, 2000, "List item", true)) };
  }
  if (block.type === "link") {
    return { type: "link", href: httpUrl(block.href), text: stringField(block.text, 300, "Link text", false) };
  }
  if (block.type === "image") {
    const mediaId = stringField(block.mediaId, 80, "Image", false);
    if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw new BlogRuleError("Choose an uploaded image.", "body");
    const alt = stringField(block.alt, 300, "Alt text", true);
    return { type: "image", mediaId, alt };
  }
  throw new BlogRuleError(`Content block ${index + 1} is not supported.`, "body");
}

function parseSpan(value: unknown): TextSpan {
  if (!value || typeof value !== "object") throw new BlogRuleError("A text style is invalid.", "body");
  const span = value as { text?: unknown; bold?: unknown; italic?: unknown };
  return { text: stringField(span.text, 4000, "Block text", true), bold: span.bold === true, italic: span.italic === true };
}

function stringField(value: unknown, max: number, label: string, allowEmpty: boolean): string {
  if (typeof value !== "string") throw new BlogRuleError(`${label} is required.`, "body");
  const text = value.trim();
  if (!allowEmpty && !text) throw new BlogRuleError(`${label} is required.`, "body");
  if (text.length > max) throw new BlogRuleError(`${label} must be ${max} characters or fewer.`, "body");
  return text;
}

function httpUrl(value: unknown): string {
  const href = stringField(value, 500, "Link", false);
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new BlogRuleError("Links must be http or https URLs.", "body");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlogRuleError("Links must be http or https URLs.", "body");
  return url.toString();
}

export function blockText(block: ArticleBlock): string {
  if (block.type === "list") return block.items.join(" ");
  if (block.type === "image") return "";
  if (block.type === "paragraph" && block.spans?.length) return block.spans.map((span) => span.text).join("");
  return block.text;
}

/** Drafts may be incomplete. Submission and publication require readable content and alt text. */
export function assertPublishableBody(body: ArticleBody, mediaIds: Set<string>): void {
  if (body.blocks.length < 1 || body.blocks.length > 80) throw new BlogRuleError("Add between 1 and 80 content blocks.", "body");
  const readable = body.blocks.some((block) => blockText(block).trim().length > 0);
  if (!readable) throw new BlogRuleError("Add some article text before review.", "body");
  for (const block of body.blocks) {
    if (block.type === "list" && block.items.some((item) => !item.trim())) {
      throw new BlogRuleError("Fill in or remove empty list items before review.", "body");
    }
    if ((block.type === "paragraph" || block.type === "heading" || block.type === "link") && !block.text.trim() && !blockText(block).trim()) {
      throw new BlogRuleError("Fill in or remove empty blocks before review.", "body");
    }
    if (block.type === "image") {
      if (!block.alt.trim()) throw new BlogRuleError("Every image needs alt text.", "body");
      if (!mediaIds.has(block.mediaId)) throw new BlogRuleError("An image block uses a file that is not on this article.", "body");
    }
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}

function renderSpans(text: string, spans?: TextSpan[]): string {
  const source = spans?.length ? spans : parseInline(text);
  if (!source.length) return escapeHtml(text);
  return source.map((span) => {
    let html = escapeHtml(span.text);
    if (span.italic) html = `<em>${html}</em>`;
    if (span.bold) html = `<strong>${html}</strong>`;
    return html;
  }).join("");
}

/** Markers are stored as text and rendered as tags. Raw HTML in the text is escaped. */
export function parseInline(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const pattern = /\*\*([^*]+)\*\*|_([^_\n]+)_/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) spans.push({ text: text.slice(last, index) });
    if (match[1] != null) spans.push({ text: match[1], bold: true });
    else if (match[2] != null) spans.push({ text: match[2], italic: true });
    last = index + match[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.filter((span) => span.text.length > 0);
}

export interface RenderedArticle {
  path: string;
  slug: string;
  title: string;
  excerpt?: string;
  category: string;
  authorName?: string | null;
  featuredMediaId?: string | null;
  featuredAlt?: string | null;
  seoTitle: string;
  seoDescription: string;
  socialTitle?: string;
  socialDescription?: string;
  socialMediaId?: string | null;
  canonicalPath: string | null;
  indexable: boolean;
  publishedAt?: string | null;
  updatedAt: string;
  body: ArticleBody;
}

function renderBlocks(article: RenderedArticle, mediaBase: string): string {
  return article.body.blocks.map((block) => {
    if (block.type === "heading") {
      const tag = block.level === 2 ? "h2" : "h3";
      return `<${tag}>${escapeHtml(block.text)}</${tag}>`;
    }
    if (block.type === "list") {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((item) => `<li>${renderSpans(item)}</li>`).join("");
      return `<${tag}>${items}</${tag}>`;
    }
    if (block.type === "link") return `<p><a href="${escapeHtml(block.href)}" rel="noopener noreferrer">${escapeHtml(block.text)}</a></p>`;
    if (block.type === "image") {
      return `<figure><img src="${escapeHtml(`${mediaBase}/${block.mediaId}`)}" alt="${escapeHtml(block.alt)}"></figure>`;
    }
    return `<p>${renderSpans(block.text, block.spans)}</p>`;
  }).join("\n");
}

/** HTML the native site can render from a published revision. Text is escaped. Links stay http or https. */
export function renderPublishedArticle(article: RenderedArticle, origin: string | null, mediaBase: string): string {
  const canonical = article.canonicalPath || article.path;
  const canonicalHref = origin ? new URL(canonical, origin).toString() : canonical;
  const robots = article.indexable ? "index,follow" : "noindex,nofollow";
  const socialTitle = article.socialTitle?.trim() || article.seoTitle;
  const socialDescription = article.socialDescription?.trim() || article.seoDescription;
  const shareId = article.socialMediaId || article.featuredMediaId;
  const shareImage = shareId && origin ? new URL(`${mediaBase}/${shareId}`, origin).toString() : "";
  const featured = article.featuredMediaId
    ? `<figure><img src="${escapeHtml(`${mediaBase}/${article.featuredMediaId}`)}" alt="${escapeHtml(article.featuredAlt || article.title)}"></figure>`
    : "";
  const byline = [article.authorName, article.category, article.publishedAt ? article.publishedAt.slice(0, 10) : ""].filter(Boolean).join(" · ");
  const excerpt = article.excerpt?.trim() ? `<p>${escapeHtml(article.excerpt.trim())}</p>` : "";
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>${escapeHtml(article.seoTitle || article.title)}</title>
<meta name="description" content="${escapeHtml(article.seoDescription)}">
<link rel="canonical" href="${escapeHtml(canonicalHref)}">
<meta name="robots" content="${robots}">
<meta property="og:title" content="${escapeHtml(socialTitle)}">
<meta property="og:description" content="${escapeHtml(socialDescription)}">
${shareImage ? `<meta property="og:image" content="${escapeHtml(shareImage)}">` : ""}
</head>
<body>
<article>
${byline ? `<p>${escapeHtml(byline)}</p>` : ""}
<h1>${escapeHtml(article.title)}</h1>
${excerpt}
${featured}
${renderBlocks(article, mediaBase)}
</article>
</body>
</html>`;
}

export function renderPublishedIndex(articles: RenderedArticle[], origin: string | null, pageBase: string, mediaBase = ""): string {
  const items = articles.map((article) => {
    const href = `${pageBase}/${encodeURIComponent(article.slug)}`;
    const image = article.featuredMediaId && mediaBase
      ? `<img src="${escapeHtml(`${mediaBase}/${article.featuredMediaId}`)}" alt="${escapeHtml(article.featuredAlt || article.title)}">`
      : "";
    const meta = [article.authorName, article.category, article.publishedAt ? article.publishedAt.slice(0, 10) : ""].filter(Boolean).join(" · ");
    const excerpt = article.excerpt?.trim() ? `<p>${escapeHtml(article.excerpt.trim())}</p>` : "";
    return `<article>${image}<h2><a href="${escapeHtml(href)}">${escapeHtml(article.title)}</a></h2>${excerpt}${meta ? `<p>${escapeHtml(meta)}</p>` : ""}</article>`;
  }).join("\n");
  const canonical = origin ? new URL("/blog", origin).toString() : "/blog";
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Blog</title>
<link rel="canonical" href="${escapeHtml(canonical)}">
</head>
<body>
<main>
<h1>Blog</h1>
${items || "<p>No published articles.</p>"}
</main>
</body>
</html>`;
}

/** Sitemap of indexable published paths only. Preview and draft paths are never included. */
export function renderPublishedSitemap(articles: Array<{ path: string; indexable: boolean; updatedAt: string }>, origin: string | null): string {
  const urls = articles.filter((article) => article.indexable).map((article) => {
    const loc = origin ? new URL(article.path, origin).toString() : article.path;
    const lastmod = article.updatedAt.slice(0, 10);
    return `<url><loc>${escapeHtml(loc)}</loc><lastmod>${escapeHtml(lastmod)}</lastmod></url>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}
