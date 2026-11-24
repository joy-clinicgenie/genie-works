import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readStoredFile, storeBlogImage, storeEvidenceFile, usesBlobStore } from "./storage";

// Local mode only: no Blob store is configured in tests, so files go to a temporary UPLOADS_DIR.
describe("private file storage (local mode, D91)", () => {
  const saved = { dir: process.env.UPLOADS_DIR, store: process.env.BLOB_STORE_ID, token: process.env.BLOB_READ_WRITE_TOKEN };
  let dir = "";

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cg-storage-"));
    process.env.UPLOADS_DIR = dir; // absolute, so resolve() ignores the cwd prefix
    delete process.env.BLOB_STORE_ID;
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of [["UPLOADS_DIR", saved.dir], ["BLOB_STORE_ID", saved.store], ["BLOB_READ_WRITE_TOKEN", saved.token]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses the local directory when no Blob store is configured", () => {
    expect(usesBlobStore()).toBe(false);
  });

  it("stores and reads back a blog image and an evidence file", async () => {
    const image = Buffer.from("fake-png-bytes");
    const blog = await storeBlogImage("client-a", image, "Photo.PNG", "image/png");
    expect(blog.storageKey).toMatch(/^blog\/client-a\/[0-9a-f]{16}-\d+\.png$/);
    expect(await readStoredFile(blog.storageKey)).toEqual(image);

    const evidence = await storeEvidenceFile("client-a", Buffer.from("a,b\n1,2\n"), "export.csv", "text/csv");
    expect(evidence.storageKey).toMatch(/^client-a\/[0-9a-f]{16}-\d+\.csv$/);
    expect((await readStoredFile(evidence.storageKey))?.toString()).toBe("a,b\n1,2\n");
  });

  it("returns null for a missing file instead of throwing", async () => {
    expect(await readStoredFile("blog/client-a/missing.png")).toBeNull();
  });

  it("refuses keys that could leave the storage root", async () => {
    await expect(readStoredFile("../etc/passwd")).rejects.toThrow("Invalid key");
    await expect(readStoredFile("/etc/passwd")).rejects.toThrow("Invalid key");
    await expect(readStoredFile("")).rejects.toThrow("Invalid key");
  });
});
