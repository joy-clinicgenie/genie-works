import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = 1;

function keyMaterial(): Buffer {
  const raw = process.env.ANALYTICS_TOKEN_KEY;
  if (!raw || raw.length < 16) throw new Error("ANALYTICS_TOKEN_KEY is not set.");
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): { ciphertext: string; nonce: string; keyVersion: number } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), nonce);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext: body.toString("base64"), nonce: nonce.toString("base64"), keyVersion: VERSION };
}

export function decryptSecret(ciphertext: string, nonce: string): string {
  const buffer = Buffer.from(ciphertext, "base64");
  const tag = buffer.subarray(buffer.length - 16);
  const data = buffer.subarray(0, buffer.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", keyMaterial(), Buffer.from(nonce, "base64"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function randomUrlToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}
