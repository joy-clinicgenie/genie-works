"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addArticleMedia,
  getWebsiteConnection,
  saveWebsiteConnection,
  grantWebsitePublisher,
  isAdmin,
  revokeWebsitePublisher,
  archiveArticle,
  canEditClient,
  canShipWebsite,
  canReviewClient,
  createArticle,
  decideArticleReview,
  getArticle,
  issueArticlePreview,
  listBlogWebsites,
  parseArticleBody,
  publishArticle,
  restoreArticle,
  restoreArticleVersion,
  returnArticleToDraft,
  revokeArticlePreviews,
  startRevision,
  submitArticleForReview,
  unpublishArticle,
  updateArticle,
} from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { bool, optional, str, toActionError, type ActionState } from "@/lib/actions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, isBlogImage, storeBlogImage } from "@/lib/storage";
import { assertDeliveryOrigin, refreshWebsiteAfterUnpublish, retryVerification, shipToSite, websitePreviewUrl } from "@/lib/blog-delivery";


function articleInput(form: FormData) {
  let body;
  try {
    body = parseArticleBody(JSON.parse(str(form, "body") || "{}"));
  } catch (err) {
    if (err instanceof Error && err.name === "BlogRuleError") throw err;
    throw Object.assign(new Error("Article content could not be read."), { name: "BlogRuleError", field: "body" });
  }
  return {
    clientId: str(form, "clientId"),
    websiteId: str(form, "websiteId"),
    title: str(form, "title"),
    slug: optional(form, "slug"),
    slugEdited: bool(form, "slugEdited"),
    excerpt: str(form, "excerpt"),
    category: str(form, "category"),
    authorUserId: optional(form, "authorUserId"),
    reviewerUserId: optional(form, "reviewerUserId"),
    seoTitle: str(form, "seoTitle"),
    seoDescription: str(form, "seoDescription"),
    socialTitle: str(form, "socialTitle"),
    socialDescription: str(form, "socialDescription"),
    featuredMediaId: optional(form, "featuredMediaId"),
    socialMediaId: optional(form, "socialMediaId"),
    canonicalPath: optional(form, "canonicalPath"),
    indexable: bool(form, "indexable"),
    body,
  };
}

export async function createArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  let id = "";
  try {
    const input = articleInput(form);
    const site = (await staffTx(access, (db) => listBlogWebsites(db))).find((item) => item.id === input.websiteId);
    if (!site) return { ok: false, error: "Choose an active website.", field: "websiteId" };
    if (!canEditClient(access, site.client_id)) return { ok: false, error: "You cannot create articles for this client." };
    id = await staffTx(access, (db) => createArticle(db, { ...input, clientId: site.client_id }, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/blog", "layout");
  redirect(`/blog/${id}`);
}

export async function updateArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !canEditClient(access, existing.client_id)) return { ok: false, error: "You cannot edit this article." };
  try {
    const input = articleInput(form);
    await staffTx(access, (db) => updateArticle(db, id, { ...input, clientId: existing.client_id }, access.user.id, str(form, "expectedVersionId")));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/blog", "layout");
  revalidatePath(`/blog/${id}`);
  const keptLive = Boolean(existing.live_version_id) || existing.status === "published";
  return { ok: true, message: keptLive ? "Draft saved. The published page is unchanged until this revision is approved and published." : "Draft saved. A new version was kept." };
}

export async function submitArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !canEditClient(access, existing.client_id)) return { ok: false, error: "You cannot submit this article." };
  try {
    await staffTx(access, (db) => submitArticleForReview(db, id, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/blog/${id}`);
  return { ok: true, message: "Submitted for review." };
}

export async function reviewArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !canReviewClient(access, existing.client_id)) return { ok: false, error: "You cannot review this article." };
  const decision = str(form, "decision") === "returned" ? "returned" : "approved";
  try {
    await staffTx(access, (db) => decideArticleReview(db, id, decision, optional(form, "note"), access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/blog/${id}`);
  return { ok: true, message: decision === "approved" ? "Approved." : "Returned to draft." };
}

export async function publishArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  // D87: the same website-scoped predicate as the database; a client-level role alone is not enough.
  if (!existing || !(await staffTx(access, (db) => canShipWebsite(db, existing.website_id)))) return { ok: false, error: "You are not authorised to release to this website. Your publishing access may have been revoked; reload the page." };
  if (str(form, "confirm") !== "yes") return { ok: false, error: "Confirm publication before continuing." };
  try {
    await staffTx(access, (db) => publishArticle(db, id, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/blog", "layout");
  revalidatePath(`/blog/${id}`);
  // D87: this releases the revision to the content API only. Nothing is delivered to or checked on the website.
  return { ok: true, message: `Released to the content API${existing.indexable ? "" : " (marked noindex, so the sitemap omits it)"}. Website publication is unverified: nothing was delivered to or checked on the website.` };
}

export async function unpublishArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !(await staffTx(access, (db) => canShipWebsite(db, existing.website_id)))) return { ok: false, error: "You are not authorised to unpublish from this website." };
  if (str(form, "confirm") !== "yes") return { ok: false, error: "Confirm removal before continuing." };
  try {
    await staffTx(access, (db) => unpublishArticle(db, id, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/blog", "layout");
  revalidatePath(`/blog/${id}`);
  // D89 websites cache articles; tell a connected website to drop this one now (D92).
  const websiteFailure = await refreshWebsiteAfterUnpublish(access, id).catch(() => "site_unreachable" as const);
  if (websiteFailure) {
    return { ok: true, message: "Unpublished. The website could not be told straight away, so the article may stay visible there for up to 10 minutes. Version history is kept." };
  }
  return { ok: true, message: "Unpublished. The website, public page and sitemap no longer include it. Version history is kept." };
}

export async function archiveArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !canEditClient(access, existing.client_id)) return { ok: false, error: "You cannot archive this article." };
  try {
    await staffTx(access, (db) => archiveArticle(db, id, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/blog/${id}`);
  return { ok: true, message: "Archived." };
}

export async function revokePreviewAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !canEditClient(access, existing.client_id)) return { ok: false, error: "You cannot revoke this preview." };
  try {
    await staffTx(access, (db) => revokeArticlePreviews(db, id, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  return { ok: true, message: "Preview links for this article were revoked." };
}

export async function previewArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing) return { ok: false, error: "Article not found." };
  try {
    const preview = await staffTx(access, (db) => issueArticlePreview(db, id, access.user.id));
    return { ok: true, message: "Preview ready.", id: preview.token };
  } catch (err) {
    return toActionError(err);
  }
}

export async function uploadArticleMediaAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !canEditClient(access, existing.client_id)) return { ok: false, error: "You cannot add images to this article." };
  const file = form.get("file");
  const alt = str(form, "altText");
  if (!(file instanceof File) || file.size < 1) return { ok: false, error: "Choose an image.", field: "file" };
  if (!isBlogImage(file.type)) return { ok: false, error: "Use a PNG, JPEG or WebP image.", field: "file" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `Images must be ${MAX_UPLOAD_LABEL} or smaller.`, field: "file" };
  if (!alt) return { ok: false, error: "Alt text is required.", field: "altText" };
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = await storeBlogImage(existing.client_id, bytes, file.name, file.type);
    await staffTx(access, (db) => addArticleMedia(db, id, { storageKey: stored.storageKey, altText: alt, contentType: file.type, byteSize: bytes.length }, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/blog/${id}`);
  return { ok: true, message: "Image added. You can use it as the featured image or inside the article." };
}

export async function startRevisionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !canEditClient(access, existing.client_id)) return { ok: false, error: "You cannot revise this article." };
  try {
    await staffTx(access, (db) => startRevision(db, id, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/blog/${id}`);
  return { ok: true, message: "A working revision was created. The live article is unchanged." };
}

export async function returnToDraftAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing) return { ok: false, error: "Article not found." };
  const allowed = canEditClient(access, existing.client_id) || (canReviewClient(access, existing.client_id) && access.user.id === existing.reviewer_user_id);
  if (!allowed) return { ok: false, error: "You cannot return this article to draft." };
  try {
    await staffTx(access, (db) => returnArticleToDraft(db, id, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/blog/${id}`);
  return { ok: true, message: "Returned to draft. The previous approval no longer covers publication." };
}

export async function restoreArchivedAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !canEditClient(access, existing.client_id)) return { ok: false, error: "You cannot restore this article." };
  try {
    await staffTx(access, (db) => restoreArticle(db, id, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/blog/${id}`);
  return { ok: true, message: "Restored to draft. It is not published." };
}

export async function restoreVersionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !canEditClient(access, existing.client_id)) return { ok: false, error: "You cannot restore a version of this article." };
  try {
    await staffTx(access, (db) => restoreArticleVersion(db, id, str(form, "versionId"), access.user.id, bool(form, "replaceWorking")));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/blog/${id}`);
  return { ok: true, message: existing.live_version_id ? "Restored into the working revision. The live article is unchanged." : "Restored as a new draft. Earlier versions are kept." };
}

const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function publishingNames(access: Awaited<ReturnType<typeof requireAccess>>, websiteId: string, userId: string) {
  return staffTx(access, async (db) => {
    const site = (await db.query<{ name: string }>("select name from websites where id = $1", [websiteId])).rows[0];
    const person = (await db.query<{ display_name: string }>("select display_name from staff_users where id = $1", [userId])).rows[0];
    return { website: site?.name ?? "this website", person: person?.display_name ?? "This staff member" };
  });
}

/** D87: an administrator grants one staff member publishing access to one website. */
export async function grantPublishingAccessAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  if (!isAdmin(access)) return { ok: false, error: "Only an administrator can grant website publishing access." };
  const websiteId = str(form, "websiteId");
  const userId = str(form, "userId");
  if (!UUID_ID.test(websiteId)) return { ok: false, error: "Choose a website.", field: "websiteId" };
  if (!UUID_ID.test(userId)) return { ok: false, error: "Choose a staff member.", field: "userId" };
  let created = false;
  try {
    created = (await staffTx(access, (db) => grantWebsitePublisher(db, { websiteId, userId }, access.user.id))).created;
  } catch (err) {
    return toActionError(err);
  }
  const names = await publishingNames(access, websiteId, userId);
  revalidatePath("/blog", "layout");
  return { ok: true, message: created ? `${names.person} can now release to ${names.website}.` : `${names.person} already had publishing access to ${names.website}.` };
}

/** D87: an administrator revokes one staff member's publishing access to one website. The record is kept. */
export async function revokePublishingAccessAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  if (!isAdmin(access)) return { ok: false, error: "Only an administrator can revoke website publishing access." };
  const websiteId = str(form, "websiteId");
  const userId = str(form, "userId");
  if (!UUID_ID.test(websiteId) || !UUID_ID.test(userId)) return { ok: false, error: "Choose a grant to revoke." };
  let revoked = false;
  try {
    revoked = await staffTx(access, (db) => revokeWebsitePublisher(db, { websiteId, userId }, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  const names = await publishingNames(access, websiteId, userId);
  revalidatePath("/blog", "layout");
  return revoked
    ? { ok: true, message: `${names.person} no longer has publishing access to ${names.website}.` }
    : { ok: false, error: `${names.person} did not have publishing access to ${names.website}.` };
}

/** D89: Ship to site. The service re-checks the website grant, the article's website and the approved revision. */
export async function shipToSiteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !(await staffTx(access, (db) => canShipWebsite(db, existing.website_id)))) {
    return { ok: false, error: "You are not authorised to ship to this website. Your publishing access may have been revoked; reload the page." };
  }
  let result;
  try {
    result = await shipToSite(access, id);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/blog", "layout");
  revalidatePath(`/blog/${id}`);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, message: "Shipped and verified on the website.", href: result.publicUrl };
}

/** D89: re-checks the website without sending anything again. */
export async function retryVerificationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !(await staffTx(access, (db) => canShipWebsite(db, existing.website_id)))) return { ok: false, error: "You are not authorised to ship to this website." };
  let result;
  try {
    result = await retryVerification(access, id);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/blog", "layout");
  revalidatePath(`/blog/${id}`);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, message: "Verified: the website shows this revision.", href: result.publicUrl };
}

/** D89: a private preview of the saved revision in the website's own article template (72 hours). */
export async function websitePreviewAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing) return { ok: false, error: "Article not found." };
  const connection = await staffTx(access, (db) => getWebsiteConnection(db, existing.website_id));
  if (!connection?.configured || !connection.websiteUrl) return { ok: false, error: "This website is not connected for previews." };
  try {
    const origin = assertDeliveryOrigin(connection.websiteUrl);
    const preview = await staffTx(access, (db) => issueArticlePreview(db, id, access.user.id));
    return { ok: true, message: "Website preview ready. The link expires in 72 hours.", href: websitePreviewUrl(origin, preview.token) };
  } catch (err) {
    if (err instanceof Error && /^(Delivery needs|A hosted server|The website URL)/.test(err.message)) return { ok: false, error: err.message };
    return toActionError(err);
  }
}

/** D89: administrator saves a website's blog route and, optionally, a new publish secret (stored encrypted). */
export async function saveWebsiteConnectionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  if (!isAdmin(access)) return { ok: false, error: "Only an administrator can change a website connection." };
  const websiteId = str(form, "websiteId");
  if (!UUID_ID.test(websiteId)) return { ok: false, error: "Choose a website.", field: "websiteId" };
  try {
    const saved = await staffTx(access, (db) => saveWebsiteConnection(db, { websiteId, basePath: str(form, "basePath"), secret: optional(form, "secret") }, access.user.id));
    revalidatePath("/blog", "layout");
    return { ok: true, message: `Saved for ${saved.websiteName}. The connection is not tested until an article is shipped and verified.` };
  } catch (err) {
    return toActionError(err);
  }
}
