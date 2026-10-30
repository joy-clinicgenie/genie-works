"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addArticleMedia,
  archiveArticle,
  canEditClient,
  canPublishClient,
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
import { isBlogImage, storeBlogImage } from "@/lib/storage";

const MAX_IMAGE_BYTES = 1_000_000;

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
  revalidatePath("/blog");
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
  revalidatePath("/blog");
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
  if (!existing || !canPublishClient(access, existing.client_id)) return { ok: false, error: "You cannot publish this article." };
  if (str(form, "confirm") !== "yes") return { ok: false, error: "Confirm publication before continuing." };
  try {
    await staffTx(access, (db) => publishArticle(db, id, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/blog");
  revalidatePath(`/blog/${id}`);
  return { ok: true, message: existing.indexable ? "Published. The native site reads this revision, and the sitemap includes it." : "Published. The native site reads this revision. It is marked noindex, so the sitemap omits it." };
}

export async function unpublishArticleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "articleId");
  const existing = await staffTx(access, (db) => getArticle(db, id));
  if (!existing || !canPublishClient(access, existing.client_id)) return { ok: false, error: "You cannot unpublish this article." };
  if (str(form, "confirm") !== "yes") return { ok: false, error: "Confirm removal before continuing." };
  try {
    await staffTx(access, (db) => unpublishArticle(db, id, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/blog");
  revalidatePath(`/blog/${id}`);
  return { ok: true, message: "Unpublished. The public page and sitemap no longer include it. Version history is kept." };
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
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Images must be 1 MB or smaller.", field: "file" };
  if (!alt) return { ok: false, error: "Alt text is required.", field: "altText" };
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = await storeBlogImage(existing.client_id, bytes, file.name);
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
