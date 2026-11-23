import { afterAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  SERVICE,
  applyContext,
  beginWithContext,
  closePools,
  createClient,
  createWebsite,
  getActiveStaffByEmail,
  getPool,
  grantMembership,
  type PoolClient,
} from "@clinic-genie/db";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("./auth", () => ({ auth: authMock }));

import { loadSeoContextWithDb } from "@/lib/seo-workspace";
import { checkConnectionAction } from "@/app/actions/seo-connections";

afterAll(async () => {
  await closePools();
});

async function staff(db: PoolClient, email: string) {
  const user = await getActiveStaffByEmail(db, email);
  if (!user) throw new Error(`Seed user ${email} missing. Run npm run db:seed.`);
  return user;
}

/** Two fictional clinics, rolled back. Clinic A has a production and a preview website; clinic B has one. */
async function withClinics<T>(fn: (db: PoolClient, ids: { a: string; aProd: string; aPreview: string; b: string; bProd: string }) => Promise<T>): Promise<T> {
  const db = await getPool().connect();
  try {
    await beginWithContext(db, SERVICE);
    const admin = await staff(db, "admin@example.invalid");
    const specialist = await staff(db, "specialist-a@example.invalid");
    const make = async (label: string, members: string[]) => {
      const suffix = randomBytes(4).toString("hex");
      const client = await createClient(db, { slug: `seo-scope-${label}-${suffix}`, name: `Scope Fixture ${label.toUpperCase()}`, ownerUserId: admin.id, channels: ["website", "seo"], isSynthetic: true, notes: null }, admin.id);
      for (const member of members) await grantMembership(db, { userId: member, clientId: client.id }, admin.id);
      return client.id;
    };
    const site = (clientId: string, environment: "production" | "staging") => createWebsite(db, {
      clientId,
      name: "Fixture site",
      url: environment === "production" ? "https://fixture.example.invalid" : "https://preview.fixture.example.invalid",
      platform: "Next.js on Vercel",
      environment,
      notes: null,
    }, admin.id);
    const a = await make("a", [specialist.id]);
    const b = await make("b", []);
    const aProd = (await site(a, "production")).id;
    const aPreview = (await site(a, "staging")).id;
    const bProd = (await site(b, "production")).id;
    await applyContext(db, { kind: "staff", userId: specialist.id, role: specialist.platform_role });
    return await fn(db, { a, aProd, aPreview, b, bProd });
  } finally {
    await db.query("rollback").catch(() => {});
    db.release();
  }
}

describe("SEO selection resolved on the server (SEO-01.1)", () => {
  it("lists only readable website and environment pairs", async () => {
    await withClinics(async (db, ids) => {
      const ctx = await loadSeoContextWithDb(db, {});
      const listed = ctx.sites.map((site) => site.id);
      expect(listed).toEqual(expect.arrayContaining([ids.aProd, ids.aPreview]));
      expect(listed).not.toContain(ids.bProd);
      expect(ctx.sites.filter((site) => site.clientId === ids.a).map((site) => site.environment).sort()).toEqual(["production", "staging"]);
      expect(ctx.selected).toBeNull();
    });
  });

  it("denies a direct link to another clinic's website and shows no data", async () => {
    await withClinics(async (db, ids) => {
      const direct = await loadSeoContextWithDb(db, { website: ids.bProd });
      expect(direct.selected).toBeNull();
      expect(direct.website).toBeUndefined();
      expect(direct.contextNote).toBe("That website is not available to you. Choose a website.");
      const withClient = await loadSeoContextWithDb(db, { client: ids.b, website: ids.bProd });
      expect(withClient.selected).toBeNull();
      expect(withClient.contextNote).toBe("That client is not available.");
    });
  });

  it("keeps each environment separate and derives the clinic from the website", async () => {
    await withClinics(async (db, ids) => {
      const preview = await loadSeoContextWithDb(db, { website: ids.aPreview });
      expect(preview.selected).toMatchObject({ id: ids.aPreview, environment: "staging", clientId: ids.a });
      expect(preview.client).toBe(ids.a);
      const production = await loadSeoContextWithDb(db, { website: ids.aProd });
      expect(production.selected?.environment).toBe("production");
    });
  });

  it("reopens the remembered website, lets the URL win, and reports a remembered website that is no longer readable", async () => {
    await withClinics(async (db, ids) => {
      const remembered = await loadSeoContextWithDb(db, {}, ids.aPreview);
      expect(remembered.selected?.id).toBe(ids.aPreview);
      expect(remembered.savedUnavailable).toBe(false);

      const urlWins = await loadSeoContextWithDb(db, { website: ids.aProd }, ids.aPreview);
      expect(urlWins.selected?.id).toBe(ids.aProd);

      const gone = await loadSeoContextWithDb(db, {}, ids.bProd);
      expect(gone.selected).toBeNull();
      expect(gone.savedUnavailable).toBe(true);
      expect(gone.contextNote).toBe("The website you last opened is no longer available to you. Choose a website.");
    });
  });
});

describe("connection check action authorisation (SEO-08.1)", () => {
  const missing = "33333333-3333-4333-8333-333333333333";

  it("keeps checks with an administrator or manager", async () => {
    authMock.mockResolvedValue({ user: { email: "specialist-a@example.invalid" } });
    await expect(checkConnectionAction({ websiteId: missing, connectionId: missing })).resolves.toEqual({
      ok: false, websiteId: missing, connectionId: missing, error: "Checking a connection needs an administrator or manager.",
    });
  });

  it("returns no connection data for a website the server cannot resolve", async () => {
    authMock.mockResolvedValue({ user: { email: "admin@example.invalid" } });
    await expect(checkConnectionAction({ websiteId: missing, connectionId: missing })).resolves.toMatchObject({ ok: false, error: "That connection is not available for this website." });
    await expect(checkConnectionAction({ websiteId: "not-a-website", connectionId: missing })).resolves.toMatchObject({ ok: false, error: "That connection is not available for this website." });
  });
});
