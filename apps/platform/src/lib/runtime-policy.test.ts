import { describe, expect, it } from "vitest";
import { assertRuntimeAuthSecret, decideSignIn, magicLinksEnabled } from "./runtime-policy";

const local = "postgresql://cg_app:cg_app_dev@127.0.0.1:54339/clinic_genie_rehearsal";
const shared = "postgresql://cg_app:secret@db.example.com:5432/neondb";

describe("shared-database sign-in boundaries", () => {
  it("allows development magic links only on a local database", () => {
    expect(magicLinksEnabled({ NODE_ENV: "development", AUTH_DEV_MAGIC_LINKS: "true", DATABASE_URL: local })).toBe(true);
    expect(magicLinksEnabled({ NODE_ENV: "development", AUTH_DEV_MAGIC_LINKS: "true", DATABASE_URL: shared })).toBe(false);
    expect(magicLinksEnabled({ NODE_ENV: "development", AUTH_DEV_MAGIC_LINKS: "true", DATABASE_URL: "" })).toBe(false);
    expect(magicLinksEnabled({ NODE_ENV: "development", AUTH_DEV_MAGIC_LINKS: "true", DATABASE_URL: "postgresql://cg_app:cg_app_dev@127.0.0.1:54339/neondb" })).toBe(false);
    expect(magicLinksEnabled({ NODE_ENV: "development", AUTH_DEV_MAGIC_LINKS: "true", DATABASE_URL: "postgresql://cg_app:cg_app_dev@127.0.0.1:54329/clinic_genie" })).toBe(false);
    expect(magicLinksEnabled({ NODE_ENV: "production", AUTH_DEV_MAGIC_LINKS: "true", DATABASE_URL: local })).toBe(false);
    expect(magicLinksEnabled({ NODE_ENV: "development", VERCEL_ENV: "preview", AUTH_DEV_MAGIC_LINKS: "true", DATABASE_URL: local })).toBe(false);
    expect(magicLinksEnabled({ NODE_ENV: "development", AUTH_DEV_MAGIC_LINKS: "false", DATABASE_URL: local })).toBe(false);
  });

  it("does not create an admin for an unknown Google user on a shared database", () => {
    const unknown = {
      email: "new-person@example.invalid",
      hasStaff: false,
      provider: "google",
      hostedDomain: "example.invalid",
    };
    expect(decideSignIn({ ...unknown, env: { NODE_ENV: "development", DATABASE_URL: shared, AUTH_GOOGLE_HD: "example.invalid" } })).toBe("deny");
    expect(decideSignIn({ ...unknown, env: { NODE_ENV: "development", DATABASE_URL: "postgresql://cg_app:cg_app_dev@127.0.0.1:54339/neondb", AUTH_GOOGLE_HD: "example.invalid" } })).toBe("deny");
    expect(decideSignIn({ ...unknown, env: { NODE_ENV: "development", DATABASE_URL: local, AUTH_GOOGLE_HD: "example.invalid" } })).toBe("create-admin");
    expect(decideSignIn({ ...unknown, hasStaff: true, env: { NODE_ENV: "development", DATABASE_URL: shared, AUTH_GOOGLE_HD: "example.invalid" } })).toBe("allow");
    expect(decideSignIn({ ...unknown, env: { NODE_ENV: "production", DATABASE_URL: local, AUTH_GOOGLE_HD: "example.invalid" } })).toBe("deny");
  });

  it("rejects a missing runtime secret and the build placeholder", () => {
    expect(() => assertRuntimeAuthSecret({ AUTH_SECRET: "" })).toThrow(/runtime/);
    expect(() => assertRuntimeAuthSecret({ AUTH_SECRET: "preview-build-only" })).toThrow(/build placeholder/);
    expect(() => assertRuntimeAuthSecret({ AUTH_SECRET: "replace-with-a-long-random-string" })).toThrow(/build placeholder/);
    expect(() => assertRuntimeAuthSecret({ AUTH_SECRET: "preview-build-only", NEXT_PHASE: "phase-production-build" })).not.toThrow();
    expect(() => assertRuntimeAuthSecret({ AUTH_SECRET: "a-real-runtime-secret-value" })).not.toThrow();
  });
});
