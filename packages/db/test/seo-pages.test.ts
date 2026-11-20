import { afterAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { propertyCovers } from "../src/analytics/providers/gsc";
import { sealedToken, type FetchLike, type FetchResponse, type SyncDeps } from "../src/analytics/sync";
import { createSeoPage } from "../src/services/seo";
import { getPublishedSeoConfiguration, issueSeoSiteToken, saveSeoPageSetting } from "../src/services/seo-soft-launch";
import { inspectNext, refreshIndexInventory } from "../src/services/site-health";
import {
  compareLive,
  effectivePageSeo,
  findInventoryPage,
  inspectionUrlFor,
  listPageInventory,
  loadInspectionTarget,
  loadPageEvidence,
  pageEditRoute,
  pageRouteId,
  parseLiveHead,
  readPageInspections,
  recordLiveCheck,
  recordUrlInspection,
  routeKey,
  runUrlInspection,
  searchInventory,
  type InspectionTarget,
} from "../src/services/seo-pages";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

function jsonResponse(status: number, body: unknown): FetchResponse {
  return { status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
}

const PROPERTY = "sc-domain:check.example.invalid";

function mapPage(db: pg.PoolClient, clientId: string, websiteId: string, pagePath: string, pageTitle: string, actorId: string) {
  return createSeoPage(db, clientId, {
    websiteId, pagePath, pageTitle, primaryKeyword: null, secondaryKeywords: [], searchIntent: null, contentStatus: "published",
    ownerUserId: null, lastReviewedOn: null, nextReviewOn: null, mappingFlag: "none", flagNote: null, notes: null,
  }, actorId);
}

async function connectSearch(db: pg.PoolClient, clientId: string, websiteId: string, actorId: string, property = PROPERTY) {
  const token = sealedToken({ accessToken: "fixture-access", expiresAt: "2100-01-01T00:00:00.000Z" });
  return saveConnection(db, {
    clientId, websiteId, provider: "gsc", externalPropertyId: property, streamOrSiteRef: null, providerTimezone: "America/Los_Angeles",
    tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId: actorId,
  });
}

function inspectionDeps(status: number, body: unknown): SyncDeps & { calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push(`${url} ${init?.body ?? ""}`);
    return jsonResponse(status, body);
  };
  return { fetch, now: new Date("2026-11-20T02:00:00.000Z"), calls };
}

const INDEXED = {
  inspectionResult: {
    indexStatusResult: {
      verdict: "PASS",
      coverageState: "Submitted and indexed",
      indexingState: "INDEXING_ALLOWED",
      pageFetchState: "SUCCESSFUL",
      robotsTxtState: "ALLOWED",
      lastCrawlTime: "2026-11-18T07:15:00Z",
      googleCanonical: "https://check.example.invalid/services/consultation",
    },
  },
};

describe("page inventory (SEO-03.1)", () => {
  it("treats equivalent paths as one route and keeps distinct routes apart", () => {
    const key = routeKey("/services/consultation");
    expect(routeKey("/services/consultation/")).toBe(key);
    expect(routeKey("//services//consultation")).toBe(key);
    expect(routeKey("/services/consultation?utm_source=x#top")).toBe(key);
    expect(routeKey("/services/%63onsultation")).toBe(key);
    expect(routeKey("https://check.example.invalid/services/consultation/")).toBe(key);
    expect(routeKey("/Services/Consultation")).not.toBe(key);
    expect(routeKey("/services/consultation-b")).not.toBe(key);
    expect(routeKey("/a/%2F")).toBe("/a/%2F");
    expect(routeKey("/../etc")).toBeNull();
    expect(pageRouteId("w", "/a")).toBe(pageRouteId("w", "/a"));
    expect(pageRouteId("w", "/a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("lists one row per route, finds it by title or path, and resolves its ID only inside its website", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id, [specA.id]);
      const mapped = await mapPage(db, clinic.clientId, clinic.websiteId, "/services/consultation", "Consultation service", admin.id);
      await mapPage(db, clinic.clientId, clinic.websiteId, "/services/Consultation", "Different case page", admin.id);
      await applyContext(db, staffCtx(admin));
      await saveSeoPageSetting(db, clinic.clientId, clinic.websiteId, { pagePath: "/services/consultation/", title: "Override", description: null, canonicalPath: null, indexable: null }, admin.id);

      await applyContext(db, staffCtx(specA));
      const pages = await listPageInventory(db, clinic.websiteId);
      expect(pages[0]?.key).toBe("/");
      expect(pages.map((page) => page.key).sort()).toEqual(["/", "/services/Consultation", "/services/consultation"]);
      const row = pages.find((page) => page.key === "/services/consultation")!;
      expect(row.id).toBe(mapped);
      expect(row.sources.sort()).toEqual(["mapped", "setting"]);
      expect(row.aliases).toContain(pageRouteId(clinic.websiteId, "/services/consultation"));

      const byTitle = searchInventory(pages, "consultation service");
      expect(byTitle.map((page) => page.id)).toEqual([mapped]);
      // A path or URL naming a known route returns exactly that row, not the distinct /services/Consultation.
      expect(searchInventory(pages, "/services/consultation").map((page) => page.id)).toEqual([mapped]);
      expect(searchInventory(pages, "https://check.example.invalid/services/consultation/").map((page) => page.id)).toEqual([mapped]);
      // A partial query matches part of the title or path and lists distinct routes separately.
      expect(searchInventory(pages, "consultation").map((page) => page.key).sort()).toEqual(["/services/Consultation", "/services/consultation"]);
      expect(searchInventory(pages, "/serv").length).toBe(2);

      expect((await findInventoryPage(db, clinic.websiteId, mapped))?.key).toBe("/services/consultation");
      const home = pages.find((page) => page.key === "/")!;
      expect((await findInventoryPage(db, clinic.websiteId, home.id))?.sources).toEqual(["home"]);
      // The same ID inside the other environment, or for another clinic's staff, resolves to nothing.
      expect(await findInventoryPage(db, clinic.stagingId, mapped)).toBeNull();
      await applyContext(db, staffCtx(specB));
      expect(await listPageInventory(db, clinic.websiteId)).toEqual([]);
      expect(await findInventoryPage(db, clinic.websiteId, mapped)).toBeNull();
    });
  });
});

describe("page SEO settings and evidence (SEO-03.2)", () => {
  it("keeps a title override, inherits the rest, and advances each state only on its own evidence", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const mapped = await mapPage(db, clinic.clientId, clinic.websiteId, "/services/consultation", "Consultation service", admin.id);
      await applyContext(db, staffCtx(admin));
      const token = await issueSeoSiteToken(db, clinic.clientId, clinic.websiteId, admin.id);
      expect(await saveSeoPageSetting(db, clinic.clientId, clinic.websiteId, { pagePath: "/services/consultation", title: "Consultations at Check Clinic", description: null, canonicalPath: null, indexable: null }, admin.id)).toBe("saved");

      let page = (await findInventoryPage(db, clinic.websiteId, mapped))!;
      expect(effectivePageSeo(page)).toEqual({
        title: { value: "Consultations at Check Clinic", source: "override" },
        description: { value: null, source: "website_default" },
        indexable: { value: null, source: "website_default" },
      });
      expect(pageEditRoute("Next.js on Vercel", page)).toBe("settings_api");
      expect(pageEditRoute("Wix", page)).toBe("read_only");

      // Saved only: the website has not fetched the settings, nobody checked the live page, Google has said nothing.
      let evidence = await loadPageEvidence(db, page);
      expect(evidence.saved?.at).toBeInstanceOf(Date);
      expect(evidence.published).toEqual({ state: "waiting", lastFetch: null });
      expect(evidence.live).toEqual({ state: "not_checked" });
      expect(evidence.google).toEqual({ lastSuccess: null, newerFailure: null });

      // The website fetches its settings: Published advances. The inherited keys are left out.
      await applyContext(db, SERVICE);
      const served = await getPublishedSeoConfiguration(db, clinic.websiteId, token, new Date(Date.now() + 1000));
      expect(served?.pages).toEqual([{ path: "/services/consultation", canonicalPath: null, title: "Consultations at Check Clinic" }]);
      await applyContext(db, staffCtx(admin));
      evidence = await loadPageEvidence(db, page);
      expect(evidence.published.state).toBe("published");
      expect(evidence.live.state).toBe("not_checked");

      // A live check that sees the old title differs; one that sees the new title matches.
      await applyContext(db, SERVICE);
      const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
      await recordLiveCheck(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, pagePath: page.path, pageUrl: "https://check.example.invalid/services/consultation", httpStatus: 200, head: { title: "Old title", description: "Code default", robots: null }, errorCode: null, actorUserId: admin.id, now: later(5) });
      await applyContext(db, staffCtx(admin));
      evidence = await loadPageEvidence(db, page);
      expect(evidence.live).toMatchObject({ state: "differs", fields: ["title"] });
      await applyContext(db, SERVICE);
      await recordLiveCheck(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, pagePath: page.path, pageUrl: "https://check.example.invalid/services/consultation", httpStatus: 200, head: { title: "Consultations at Check Clinic", description: "Code default", robots: "index, follow" }, errorCode: null, actorUserId: admin.id, now: later(10) });
      await applyContext(db, staffCtx(admin));
      evidence = await loadPageEvidence(db, page);
      expect(evidence.live.state).toBe("matches");
      expect(evidence.google.lastSuccess).toBeNull();

      // Clearing every override removes the row and the page inherits again.
      expect(await saveSeoPageSetting(db, clinic.clientId, clinic.websiteId, { pagePath: "/services/consultation", title: null, description: null, canonicalPath: null, indexable: null }, admin.id)).toBe("cleared");
      page = (await findInventoryPage(db, clinic.websiteId, mapped))!;
      expect(page.setting).toBeNull();
      expect(effectivePageSeo(page).title.source).toBe("website_default");
    });
  });

  it("reports no credential, and a live check from before the save as stale", () => {
    const setting = { id: "s", pagePath: "/a", title: "New", description: null, indexable: false, canonicalPath: null, updatedAt: new Date("2026-11-20T02:00:00Z"), updatedByName: null };
    const before = { checkedAt: new Date("2026-11-20T01:00:00Z"), httpStatus: 200, title: "New", description: null, robots: null, errorCode: null };
    expect(compareLive(setting, before).state).toBe("before_save");
    const after = { ...before, checkedAt: new Date("2026-11-20T03:00:00Z") };
    expect(compareLive(setting, after)).toMatchObject({ state: "differs", fields: ["indexing"] });
    expect(compareLive(setting, { ...after, robots: "noindex, nofollow" }).state).toBe("matches");
    expect(compareLive(setting, { ...after, errorCode: "timeout" }).state).toBe("failed");
  });

  it("reads the served title, description and robots directives from the page head", () => {
    const head = parseLiveHead(`<!doctype html><html><head>
      <title> Consultations &amp; care | Check </title>
      <meta content="Book a consultation." name="description">
      <meta name='robots' content='noindex'>
      </head><body><title>Not this</title></body></html>`, "nofollow");
    expect(head).toEqual({ title: "Consultations & care | Check", description: "Book a consultation.", robots: "noindex, nofollow" });
    expect(parseLiveHead("<html><body>No head</body></html>")).toEqual({ title: null, description: null, robots: null });
  });
});

describe("URL Inspection (SEO-03.3)", () => {
  it("matches URLs to properties by Google's documented rules", () => {
    expect(propertyCovers("sc-domain:example.invalid", "https://www.example.invalid/a")).toBe(true);
    expect(propertyCovers("sc-domain:example.invalid", "http://example.invalid/")).toBe(true);
    expect(propertyCovers("sc-domain:example.invalid", "https://notexample.invalid/")).toBe(false);
    expect(propertyCovers("sc-domain:example.invalid", "https://example.invalid.evil.test/")).toBe(false);
    expect(propertyCovers("https://www.example.invalid/", "https://www.example.invalid/services")).toBe(true);
    expect(propertyCovers("https://www.example.invalid/", "http://www.example.invalid/services")).toBe(false);
    expect(propertyCovers("https://www.example.invalid/", "https://m.example.invalid/services")).toBe(false);
    expect(propertyCovers("https://www.example.invalid/pets/", "https://www.example.invalid/pets/dogs")).toBe(true);
    expect(propertyCovers("https://www.example.invalid/pets/", "https://www.example.invalid/petstore")).toBe(false);
    expect(propertyCovers("https://www.example.invalid", "https://www.example.invalid/a")).toBe(false);
  });

  it("keeps the earlier result and its time when a recheck fails, and never sends another property's URL", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id, [specA.id]);
      await mapPage(db, clinic.clientId, clinic.websiteId, "/services/consultation", "Consultation service", admin.id);
      const connection = await connectSearch(db, clinic.clientId, clinic.websiteId, admin.id);
      const target = (await loadInspectionTarget(db, clinic.websiteId)) as InspectionTarget;
      const url = inspectionUrlFor("https://check.example.invalid", "/services/consultation")!;
      const record = (outcome: Awaited<ReturnType<typeof runUrlInspection>>, at: string) => recordUrlInspection(db, {
        clientId: clinic.clientId, websiteId: clinic.websiteId, pagePath: "/services/consultation", inspectionUrl: url,
        property: PROPERTY, connectionId: connection.id, outcome, actorUserId: admin.id, now: new Date(at),
      });

      const ok = inspectionDeps(200, INDEXED);
      const first = await runUrlInspection(target, url, ok);
      expect(first.ok).toBe(true);
      expect(ok.calls[0]).toContain(`"siteUrl":"${PROPERTY}"`);
      await record(first, "2026-11-19T09:00:00Z");

      const outage = inspectionDeps(503, {});
      const recheck = await runUrlInspection(target, url, outage);
      expect(recheck).toEqual({ ok: false, code: "provider_unavailable" });
      await record(recheck, "2026-11-20T09:00:00Z");

      await applyContext(db, staffCtx(specA));
      const read = await readPageInspections(db, clinic.websiteId, "/services/consultation");
      expect(read.lastSuccess).toMatchObject({ verdict: "PASS", coverage: "Submitted and indexed", checkedAt: new Date("2026-11-19T09:00:00Z"), lastCrawlTime: new Date("2026-11-18T07:15:00Z"), errorCode: null });
      expect(read.newerFailure).toMatchObject({ errorCode: "provider_unavailable", checkedAt: new Date("2026-11-20T09:00:00Z") });

      // A URL on another host is refused before any request.
      const never = inspectionDeps(200, INDEXED);
      expect(await runUrlInspection(target, "https://other.example.test/services/consultation", never)).toEqual({ ok: false, code: "outside_property" });
      expect(never.calls).toEqual([]);

      // Permission problems and rejected credentials are reported for Website Connections.
      expect(await runUrlInspection(target, url, inspectionDeps(403, {}))).toEqual({ ok: false, code: "inspection_forbidden" });
      const rejected = await runUrlInspection(target, url, inspectionDeps(401, {}));
      expect(rejected).toEqual({ ok: false, code: "reconnect_required" });
      await applyContext(db, SERVICE);
      await record(rejected, "2026-11-20T10:00:00Z");
      expect((await db.query("select status from analytics_connections where id = $1", [connection.id])).rows[0].status).toBe("reconnect_required");
      expect(await runUrlInspection((await loadInspectionTarget(db, clinic.websiteId))!, url, never)).toEqual({ ok: false, code: "reconnect_required" });
      expect(never.calls).toEqual([]);
    });
  });

  it("applies the property rule to the scheduled check and appends its attempts", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      // The registry address is check.example.invalid; this property covers a different domain.
      await connectSearch(db, clinic.clientId, clinic.websiteId, admin.id, "sc-domain:other.example.test");
      await refreshIndexInventory(db, clinic.websiteId);
      const deps = inspectionDeps(200, INDEXED);
      expect(await inspectNext(db, deps, clinic.websiteId)).toBe("done");
      expect(deps.calls).toEqual([]);
      const stored = await readPageInspections(db, clinic.websiteId, "/");
      expect(stored).toMatchObject({ lastSuccess: null, newerFailure: { errorCode: "outside_property", source: "scheduled" } });
    });
  });
});
