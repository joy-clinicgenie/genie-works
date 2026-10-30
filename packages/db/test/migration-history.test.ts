import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const appliedDirectoryMigrations = {
  "0009_client_master_list.sql": "d30d9c49260721ebb111ac3f4d43fec349b7a28a48e9b20f074da02541082836",
  "0031_clinic_websites.sql": "4b861898d42ca9dfebe83a60d60b190da93569093c6b42d54ed7bd82b9def5cb",
  "0034_client_public_profiles.sql": "81ae7000b60c9bcce3830861be56b4f637928927c96881a05a51cc0e7244136a",
} as const;

describe("applied directory migrations", () => {
  it("keeps the applied files byte-for-byte so existing checksums stay valid", () => {
    for (const [name, checksum] of Object.entries(appliedDirectoryMigrations)) {
      const sql = readFileSync(join(dir, name));
      expect(createHash("sha256").update(sql).digest("hex")).toBe(checksum);
    }
  });
});
