import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyContext } from "../src/client";
import { runMigrations } from "../src/migrate";
import { seedDemo } from "../src/seed";
import { countArticleQueues, createArticle, decideArticleReview, getArticle, listArticleCategories, listArticles, publishArticle, startRevision, submitArticleForReview, type ArticleBody } from "../src/services/blog";
import { completeDeliveryAttempt, completeVerificationAttempt, grantWebsitePublisher, requestShip, requestVerification } from "../src/services/blog-publishing";
import { BLOG_QUEUES } from "../src/services/blog-queues";
import { createIsolatedDatabase, staffContext, type IsolatedDatabase } from "./isolated";
import { provisionClinic } from "./provision";

/** D87: Overview queue counts equal the filtered Posts list, per client and per website. */

type Staff = { id: string; platform_role: "admin" | "specialist" | "reviewer" };
const body: ArticleBody = { layout: "clinic-article-v1", blocks: [{ type: "paragraph", text: "Fictional." }] };
let db: IsolatedDatabase;
let admin: Staff, specA: Staff, reviewer: Staff;

beforeAll(async () => {
  db = await createIsolatedDatabase("queues");
  await runMigrations(db.admin);
  await seedDemo(db.admin);
  admin = (await db.staff("admin@example.invalid")) as Staff;
  specA = (await db.staff("specialist-a@example.invalid")) as Staff;
  reviewer = (await db.staff("reviewer@example.invalid")) as Staff;
}, 180_000);
afterAll(async () => { await db?.drop(); });

async function article(tx: pg.PoolClient, clientId: string, websiteId: string, stage: "draft" | "returned" | "review" | "approved" | "released" | "failed" | "verify_failed" | "verified" | "revision_returned", category = "Care") {
  await applyContext(tx, staffContext(specA));
  const id = await createArticle(tx, {
    clientId, websiteId, title: `${stage} article`, slug: `${stage.replace(/_/g, "-")}-${randomBytes(3).toString("hex")}`, category, authorUserId: specA.id, reviewerUserId: reviewer.id,
    seoTitle: "x", seoDescription: "Fictional.", canonicalPath: null, indexable: true, body,
  }, specA.id);
  if (stage === "draft") return id;
  await submitArticleForReview(tx, id, specA.id);
  if (stage === "review") return id;
  await applyContext(tx, staffContext(reviewer));
  await decideArticleReview(tx, id, stage === "returned" ? "returned" : "approved", stage === "returned" ? "Please revise" : null, reviewer.id);
  if (stage === "returned" || stage === "approved") return id;
  await applyContext(tx, staffContext(admin));
  if (stage === "released") { await publishArticle(tx, id, admin.id); return id; }
  const versionId = (await getArticle(tx, id))!.current_version_id!;
  const shipped = await requestShip(tx, { articleId: id, websiteId, versionId }, admin.id);
  if (stage === "failed") { await completeDeliveryAttempt(tx, shipped.attempt!.id, { ok: false, code: "site_unreachable" }, admin.id); return id; }
  await completeDeliveryAttempt(tx, shipped.attempt!.id, { ok: true }, admin.id);
  const check = await requestVerification(tx, { articleId: id, websiteId, versionId }, admin.id);
  if (stage === "verify_failed") { await completeVerificationAttempt(tx, check.attempt!.id, { verified: false, code: "different_revision" }, admin.id); return id; }
  await completeVerificationAttempt(tx, check.attempt!.id, { verified: true, publicUrl: "https://check.example.invalid/blog/x" }, admin.id);
  if (stage === "verified") return id;
  // A live article whose new revision was returned by the reviewer.
  await applyContext(tx, staffContext(specA));
  await startRevision(tx, id, specA.id);
  await submitArticleForReview(tx, id, specA.id);
  await applyContext(tx, staffContext(reviewer));
  await decideArticleReview(tx, id, "returned", "Revise the update", reviewer.id);
  return id;
}

describe("Blog queues (D87)", () => {
  it("counts each queue exactly as the filtered list does, for all websites and for each website", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const clinic = await provisionClinic(tx, admin.id, [specA.id, reviewer.id]);
      await grantWebsitePublisher(tx, { websiteId: clinic.websiteId, userId: specA.id }, admin.id);
      const siteA = clinic.websiteId;
      const siteB = clinic.stagingId;
      const ids: Record<string, string> = {};
      for (const stage of ["draft", "returned", "review", "approved", "released", "failed", "verify_failed", "verified", "revision_returned"] as const) {
        ids[`${stage}-A`] = await article(tx, clinic.clientId, siteA, stage, stage === "draft" ? "News" : "Care");
      }
      ids["returned-B"] = await article(tx, clinic.clientId, siteB, "returned");
      ids["approved-B"] = await article(tx, clinic.clientId, siteB, "approved");
      await applyContext(tx, staffContext(admin));
      const expected = {
        all: { changes_requested: 3, awaiting_review: 1, ready_to_publish: 2, publishing_issues: 2 },
        A: { changes_requested: 2, awaiting_review: 1, ready_to_publish: 1, publishing_issues: 2 },
        B: { changes_requested: 1, awaiting_review: 0, ready_to_publish: 1, publishing_issues: 0 },
      };
      for (const [scope, websiteId] of [["all", null], ["A", siteA], ["B", siteB]] as const) {
        const counts = await countArticleQueues(tx, { clientId: clinic.clientId, websiteId });
        expect(counts).toEqual(expected[scope]);
        for (const queue of BLOG_QUEUES) {
          const list = await listArticles(tx, { clientId: clinic.clientId, websiteId: websiteId ?? undefined, queue, pageSize: 100 });
          expect(list.total, `${scope} ${queue}`).toBe(counts[queue]);
          expect(list.articles).toHaveLength(counts[queue]);
        }
      }
      const statuses = Object.fromEntries((await listArticles(tx, { clientId: clinic.clientId, pageSize: 100 })).articles.map((a) => [a.id, a.website_status]));
      expect(statuses[ids["released-A"]!]).toBe("unverified");
      expect(statuses[ids["failed-A"]!]).toBe("delivery_failed");
      expect(statuses[ids["verify_failed-A"]!]).toBe("awaiting_verification");
      expect(statuses[ids["verified-A"]!]).toBe("verified");
      expect(statuses[ids["draft-A"]!]).toBe("not_published");
      expect(await listArticleCategories(tx, { clientId: clinic.clientId })).toEqual([{ category: "Care", articles: 10 }, { category: "News", articles: 1 }]);
      expect(await listArticleCategories(tx, { clientId: clinic.clientId, websiteId: siteB })).toEqual([{ category: "Care", articles: 2 }]);
    });
  });
});
