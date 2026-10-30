import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Private evidence storage. Development writes under UPLOADS_DIR (outside the web root).
 * Production should swap this for object storage behind the same two functions.
 */
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/csv"]);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function root(): string {
  return resolve(process.cwd(), "..", "..", process.env.UPLOADS_DIR || ".data/uploads");
}

export function isAllowedType(mime: string): boolean {
  return ALLOWED_TYPES.has(mime);
}

const BLOG_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isBlogImage(mime: string): boolean {
  return BLOG_IMAGE_TYPES.has(mime);
}

export async function storeBlogImage(clientId: string, bytes: Buffer, originalName: string): Promise<{ storageKey: string; sha256: string }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const safeExt = (originalName.split(".").pop() ?? "img").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "img";
  const storageKey = `blog/${clientId}/${sha256.slice(0, 16)}-${Date.now()}.${safeExt}`;
  const path = join(root(), storageKey);
  await mkdir(join(root(), "blog", clientId), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
  return { storageKey, sha256 };
}

export async function storeEvidenceFile(clientId: string, bytes: Buffer, originalName: string): Promise<{ storageKey: string; sha256: string }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const safeExt = (originalName.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const storageKey = `${clientId}/${sha256.slice(0, 16)}-${Date.now()}.${safeExt}`;
  const path = join(root(), storageKey);
  await mkdir(join(root(), clientId), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
  return { storageKey, sha256 };
}

export async function readEvidenceFile(storageKey: string): Promise<Buffer> {
  if (storageKey.includes("..")) throw new Error("Invalid key");
  return readFile(join(root(), storageKey));
}
