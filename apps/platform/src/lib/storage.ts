import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { get, put } from "@vercel/blob";

/**
 * Private file storage for blog images and issue evidence (D91).
 *
 * - When a private Vercel Blob store is connected (BLOB_STORE_ID with Vercel OIDC on a
 *   deployment, or BLOB_READ_WRITE_TOKEN), files go to that store with `access: "private"`.
 *   Deployments must use this: their filesystem is read-only and not kept between instances.
 * - Otherwise (local development and tests) files are written under UPLOADS_DIR, outside the web root.
 *
 * Files are never public. They are served only by the permission-checked routes under
 * app/api/evidence, app/api/blog-media and app/api/public/blog.
 */
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/csv"]);

/**
 * Largest file accepted by an upload action. A Vercel Function request body is limited to
 * 4.5 MB and next.config sets serverActions.bodySizeLimit to 4.4 MB, which leaves room for
 * the multipart overhead.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "4 MB";

function root(): string {
  return resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "..", process.env.UPLOADS_DIR || ".data/uploads");
}

/** True when a Vercel Blob store is configured for this process. */
export function usesBlobStore(): boolean {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

export function isAllowedType(mime: string): boolean {
  return ALLOWED_TYPES.has(mime);
}

const BLOG_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isBlogImage(mime: string): boolean {
  return BLOG_IMAGE_TYPES.has(mime);
}

function assertSafeKey(storageKey: string): void {
  if (!storageKey || storageKey.includes("..") || storageKey.startsWith("/") || storageKey.includes("\\")) {
    throw new Error("Invalid key");
  }
}

function safeExtension(originalName: string, fallback: string): string {
  return (originalName.split(".").pop() ?? fallback).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || fallback;
}

async function writeStoredFile(storageKey: string, bytes: Buffer, contentType: string): Promise<void> {
  assertSafeKey(storageKey);
  if (usesBlobStore()) {
    await put(storageKey, bytes, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: false });
    return;
  }
  const path = join(/*turbopackIgnore: true*/ root(), storageKey);
  await mkdir(join(/*turbopackIgnore: true*/ path, ".."), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
}

export async function storeBlogImage(clientId: string, bytes: Buffer, originalName: string, contentType: string): Promise<{ storageKey: string; sha256: string }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `blog/${clientId}/${sha256.slice(0, 16)}-${Date.now()}.${safeExtension(originalName, "img")}`;
  await writeStoredFile(storageKey, bytes, contentType);
  return { storageKey, sha256 };
}

export async function storeEvidenceFile(clientId: string, bytes: Buffer, originalName: string, contentType: string): Promise<{ storageKey: string; sha256: string }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `${clientId}/${sha256.slice(0, 16)}-${Date.now()}.${safeExtension(originalName, "bin")}`;
  await writeStoredFile(storageKey, bytes, contentType);
  return { storageKey, sha256 };
}

/** Reads a stored file. Returns null when the file is missing (for example, lost before D91). */
export async function readStoredFile(storageKey: string): Promise<Buffer | null> {
  assertSafeKey(storageKey);
  if (usesBlobStore()) {
    const result = await get(storageKey, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  try {
    return await readFile(join(/*turbopackIgnore: true*/ root(), storageKey));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
