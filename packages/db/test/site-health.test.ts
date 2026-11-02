import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, applyContext } from "../src/client";
import { saveConnection } from "../src/analytics/connections";
import { sealedToken, type FetchResponse } from "../src/analytics/sync";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { createArticle, decideArticleReview, publishArticle, submitArticleForReview, type ArticleBody } from "../src/services/blog";
import { createClient, createWebsite, grantMembership } from "../src/services/registry";
import { createSeoPage } from "../src/services/seo";
import { saveSeoPageSetting } from "../src/services/seo-soft-launch";
import { indexLabels, inspectNext, listSpeedChecks, listWebsiteIndex, measureNext, refreshIndexInventory } from "../src/services/site-health";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const body: ArticleBody = {
  layout: "clinic-article-v1",
  blocks: [{ type: "paragraph", text: "A short fictional note about routine care." }],
};

function jsonResponse(status: number, payload: unknown): FetchResponse {
  return {
    status,
    headers: { get: () => null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

describe("public index inventory", () => {
  it("lists every public page, asks Google once per page, and hides the rows from another clinic", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const reviewer = await staffByEmail("reviewer@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const calls: string[] = [];
    const targets: string[] = [];
    const fetch = async (url: string, init?: { body?: string }) => {
      calls.push(url);
      const inspectionUrl = typeof init?.body === "string" ? (JSON.parse(init.body) as { inspectionUrl?: string }).inspectionUrl : undefined;
      targets.push(inspectionUrl ?? url);
      if (url.includes("pagespeedonline")) {
        return jsonResponse(200, {
          lighthouseResult: {
            categories: { performance: { score: 0.9 } },
            audits: {
              "largest-contentful-paint": { numericValue: 1800 },
              "cumulative-layout-shift": { numericValue: 0.02 },
              "total-blocking-time": { numericValue: 40 },
            },
          },
        });
      }
      if (calls.filter((item) => item.includes("urlInspection")).length === 2) return jsonResponse(500, {});
      return jsonResponse(200, {
        inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", indexingState: "INDEXING_ALLOWED" } },
      });
    };
    const deps = { fetch, now: new Date("2026-11-02T00:00:00.000Z") };

    await asContext(staffCtx(admin), async (db) => {
      const client = await createClient(db, {
        slug: "index-check-clinic", name: "Index check clinic", ownerUserId: admin.id, channels: ["website"], isSynthetic: true, notes: null,
      }, admin.id);
      const site = await createWebsite(db, {
        clientId: client.id, name: "Index check site", url: "https://index-check.example.invalid/", platform: "Next.js", environment: "production", notes: null,
      }, admin.id);
      await grantMembership(db, { userId: reviewer.id, clientId: client.id }, admin.id);
      await createSeoPage(db, client.id, {
        websiteId: site.id, pagePath: "/planned-care", pageTitle: "Planned", primaryKeyword: null, secondaryKeywords: [], searchIntent: null,
        contentStatus: "planned", ownerUserId: null, lastReviewedOn: null, nextReviewOn: null, mappingFlag: "none", flagNote: null, notes: null,
      }, admin.id);
      await createSeoPage(db, client.id, {
        websiteId: site.id, pagePath: "/retired-care", pageTitle: "Retired", primaryKeyword: null, secondaryKeywords: [], searchIntent: null,
        contentStatus: "retired", ownerUserId: null, lastReviewedOn: null, nextReviewOn: null, mappingFlag: "none", flagNote: null, notes: null,
      }, admin.id);
      await saveSeoPageSetting(db, client.id, site.id, {
        pagePath: "/private-page", title: "Private", description: "A fictional page that should not be indexed.", canonicalPath: null, indexable: false,
      }, admin.id);
      await createArticle(db, {
        clientId: client.id, websiteId: site.id, title: "Draft note", slug: "index-draft-note", category: "Care",
        authorUserId: admin.id, reviewerUserId: reviewer.id, seoTitle: "Draft note", seoDescription: "A fictional draft that is not on the public site.",
        canonicalPath: null, indexable: true, body,
      }, admin.id);
      const liveId = await createArticle(db, {
        clientId: client.id, websiteId: site.id, title: "Live note", slug: "index-live-note", category: "Care",
        authorUserId: admin.id, reviewerUserId: reviewer.id, seoTitle: "Live note", seoDescription: "A fictional published note.",
        canonicalPath: null, indexable: true, body,
      }, admin.id);
      await submitArticleForReview(db, liveId, admin.id);
      await decideArticleReview(db, liveId, "approved", "Ready", admin.id);
      await publishArticle(db, liveId, admin.id);

      const before = await listWebsiteIndex(db, site.id);
      expect(before.map((row) => row.pagePath).sort()).toEqual(["/", "/blog/index-live-note", "/planned-care", "/private-page"]);
      expect(before.find((row) => row.pagePath === "/blog/index-draft-note")).toBeUndefined();
      expect(before.find((row) => row.pagePath === "/retired-care")).toBeUndefined();
      expect(indexLabels(before.find((row) => row.pagePath === "/")!)).toMatchObject({ configured: "Index allowed", live: "Not checked", google: "Not connected" });
      expect(indexLabels(before.find((row) => row.pagePath === "/private-page")!).configured).toBe("Noindex saved");

      await applyContext(db, SERVICE);
      const token = sealedToken({ accessToken: "index-token", expiresAt: "2100-01-01T00:00:00.000Z" });
      await saveConnection(db, {
        clientId: client.id, websiteId: site.id, provider: "gsc", externalPropertyId: "https://index-check.example.invalid/",
        streamOrSiteRef: null, providerTimezone: "America/Los_Angeles", tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId: admin.id,
      });
      await applyContext(db, staffCtx(admin));
      expect(indexLabels((await listWebsiteIndex(db, site.id)).find((row) => row.pagePath === "/")!).google).toBe("Connected");

      await applyContext(db, SERVICE);
      await refreshIndexInventory(db, site.id);
      expect(await inspectNext(db, deps, site.id)).toBe("done");
      expect(calls[0]).toContain("urlInspection");
      expect(targets[0]).toBe("https://index-check.example.invalid/");
      expect(await inspectNext(db, deps, site.id)).toBe("done");
      const failedUrl = targets.at(-1);
      expect(await inspectNext(db, deps, site.id)).toBe("done");
      expect(targets.at(-1)).not.toBe(failedUrl);

      await applyContext(db, staffCtx(admin));
      const after = await listWebsiteIndex(db, site.id);
      expect(indexLabels(after.find((row) => row.pagePath === "/")!)).toMatchObject({ live: "Indexable", google: "Indexed" });
      expect(after.find((row) => row.pagePath === "/")?.coverage).toBe("Submitted and indexed");
      expect(after.some((row) => row.failed)).toBe(true);

      await applyContext(db, SERVICE);
      expect(await measureNext(db, deps, site.id)).toBe("done");
      await applyContext(db, staffCtx(admin));
      const speed = await listSpeedChecks(db, site.id);
      expect(speed[0]).toMatchObject({ pagePath: "/", strategy: "mobile", score: 90, lcpMs: 1800, failed: false });

      await applyContext(db, staffCtx(specB));
      expect(await listWebsiteIndex(db, site.id)).toEqual([]);
      expect((await db.query("select count(*)::int as n from seo_index_checks")).rows[0].n).toBe(0);
      await db.query("savepoint outsider_insert");
      await expect(db.query(
        "insert into seo_index_checks (client_id, website_id, page_path, item_kind, configured) values ($1, $2, '/secret', 'home', 'index_allowed')",
        [client.id, site.id],
      )).rejects.toThrow(/row-level security|website does not belong/);
      await db.query("rollback to savepoint outsider_insert");

      await applyContext(db, staffCtx(admin));
      await db.query("savepoint staff_insert");
      await expect(db.query(
        "insert into seo_index_checks (client_id, website_id, page_path, item_kind, configured) values ($1, $2, '/secret', 'home', 'index_allowed')",
        [client.id, site.id],
      )).rejects.toThrow(/row-level security/);
      await db.query("rollback to savepoint staff_insert");
    });
  });
});
