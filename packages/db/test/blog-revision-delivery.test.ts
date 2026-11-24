import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyContext } from "../src/client";
import { runMigrations } from "../src/migrate";
import { seedDemo } from "../src/seed";
import {
  createArticle,
  decideArticleReview,
  getArticle,
  getPublishedBlog,
  publishArticle,
  returnArticleToDraft,
  startRevision,
  submitArticleForReview,
  unpublishArticle,
  updateArticle,
  type ArticleBody,
} from "../src/services/blog";
import {
  completeDeliveryAttempt,
  completeVerificationAttempt,
  getRevisionState,
  grantWebsitePublisher,
  listPublishingHistory,
  requestShip,
  requestVerification,
  revokeWebsitePublisher,
} from "../src/services/blog-publishing";
import { createIsolatedDatabase, staffContext, type IsolatedDatabase } from "./isolated";
import { provisionClinic } from "./provision";

/** D87 behaviour, on an isolated, migrated and seeded database. */

type Staff = { id: string; platform_role: "admin" | "manager" | "specialist" | "reviewer" | "read_only" };
const body: ArticleBody = { layout: "clinic-article-v1", blocks: [{ type: "paragraph", text: "A fictional note." }] };
let db: IsolatedDatabase;
let admin: Staff, manager: Staff, specA: Staff, specB: Staff, reviewer: Staff, readonly: Staff;

beforeAll(async () => {
  db = await createIsolatedDatabase("delivery");
  await runMigrations(db.admin);
  await seedDemo(db.admin);
  const people = await Promise.all(
    ["admin", "manager", "specialist-a", "specialist-b", "reviewer", "readonly"].map((name) => db.staff(`${name}@example.invalid`)),
  ) as Staff[];
  [admin, manager, specA, specB, reviewer, readonly] = people as [Staff, Staff, Staff, Staff, Staff, Staff];
}, 180_000);

afterAll(async () => {
  await db?.drop();
});

async function as(tx: pg.PoolClient, user: Staff) {
  await applyContext(tx, staffContext(user));
}

/** A client with two native websites, specA and the reviewer as members, specA granted on site A only. */
async function setup(tx: pg.PoolClient) {
  await as(tx, admin);
  const clinic = await provisionClinic(tx, admin.id, [specA.id, reviewer.id]);
  await grantWebsitePublisher(tx, { websiteId: clinic.websiteId, userId: specA.id }, admin.id);
  return { clientId: clinic.clientId, siteA: clinic.websiteId, siteB: clinic.stagingId };
}

async function approvedArticle(tx: pg.PoolClient, clientId: string, websiteId: string, slug = `note-${randomBytes(3).toString("hex")}`) {
  await as(tx, specA);
  const id = await createArticle(tx, {
    clientId, websiteId, title: "Publishing note", slug, category: "Care", authorUserId: specA.id, reviewerUserId: reviewer.id,
    seoTitle: "Publishing note", seoDescription: "Fictional.", canonicalPath: null, indexable: true, body,
  }, specA.id);
  await submitArticleForReview(tx, id, specA.id);
  await as(tx, reviewer);
  await decideArticleReview(tx, id, "approved", null, reviewer.id);
  const article = (await getArticle(tx, id))!;
  return { id, versionId: article.current_version_id! };
}

async function editAndApprove(tx: pg.PoolClient, articleId: string, title: string) {
  await as(tx, specA);
  await startRevision(tx, articleId, specA.id);
  const working = (await getArticle(tx, articleId))!;
  await updateArticle(tx, articleId, {
    clientId: working.client_id, websiteId: working.website_id, title, slug: working.slug, category: "Care", authorUserId: specA.id,
    reviewerUserId: reviewer.id, seoTitle: title, seoDescription: "Fictional.", canonicalPath: null, indexable: true, body,
  }, specA.id, working.current_version_id!);
  await submitArticleForReview(tx, articleId, specA.id);
  await as(tx, reviewer);
  await decideArticleReview(tx, articleId, "approved", null, reviewer.id);
  return (await getArticle(tx, articleId))!.current_version_id!;
}

/** Ship, deliver and verify one revision as specA. */
async function shipAndVerify(tx: pg.PoolClient, articleId: string, websiteId: string, versionId: string) {
  await as(tx, specA);
  const shipped = await requestShip(tx, { articleId, websiteId, versionId }, specA.id);
  await completeDeliveryAttempt(tx, shipped.attempt!.id, { ok: true }, specA.id);
  const check = await requestVerification(tx, { articleId, websiteId, versionId }, specA.id);
  return completeVerificationAttempt(tx, check.attempt!.id, { verified: true, publicUrl: "https://check.example.invalid/blog/note" }, specA.id);
}

const count = async (sql: string, params: unknown[]) => Number((await db.admin.query(sql, params)).rows[0].n);

describe("revision states (D87)", () => {
  it("a new draft has only a working revision and cannot be shipped", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const { clientId, siteA } = await setup(tx);
      await as(tx, specA);
      const id = await createArticle(tx, {
        clientId, websiteId: siteA, title: "Draft", slug: "draft-only", category: "Care", authorUserId: specA.id, reviewerUserId: reviewer.id,
        seoTitle: "Draft", seoDescription: "Fictional.", canonicalPath: null, indexable: true, body,
      }, specA.id);
      const state = (await getRevisionState(tx, id))!;
      expect(state.working?.versionNumber).toBe(1);
      expect(state).toMatchObject({ approved: null, released: null, verified: null, releasedDelivery: null, websiteStatus: "not_published", websiteStatusLabel: "Not published" });
      await expect(requestShip(tx, { articleId: id, websiteId: siteA, versionId: state.working!.versionId }, specA.id)).rejects.toThrow(/approv/i);
    });
  });

  it("an edit after approval needs approval again, while the verified live revision stays", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const { clientId, siteA } = await setup(tx);
      const { id, versionId: v1 } = await approvedArticle(tx, clientId, siteA);
      await shipAndVerify(tx, id, siteA, v1);
      // v2 approved and shipped, but delivery fails: released v2, verified still v1.
      const v2 = await editAndApprove(tx, id, "Second revision");
      await as(tx, specA);
      const shipped = await requestShip(tx, { articleId: id, websiteId: siteA, versionId: v2 }, specA.id);
      await completeDeliveryAttempt(tx, shipped.attempt!.id, { ok: false, code: "site_unreachable" }, specA.id);
      // v3: a new working draft.
      await startRevision(tx, id, specA.id);
      const state = (await getRevisionState(tx, id))!;
      expect(state.working!.versionNumber).toBeGreaterThan(state.approved!.versionNumber);
      expect(state.approved?.versionId).toBe(v2);
      expect(state.released?.versionId).toBe(v2);
      expect(state.verified?.versionId).toBe(v1);
      expect(state.websiteStatus).toBe("delivery_failed");
      // The edited working revision cannot be shipped until it is approved.
      await expect(requestShip(tx, { articleId: id, websiteId: siteA, versionId: state.working!.versionId }, specA.id)).rejects.toThrow(/approv/i);

      // Approval followed by an edit on an unpublished article: the approval does not carry over.
      const other = await approvedArticle(tx, clientId, siteA);
      await as(tx, specA);
      await returnArticleToDraft(tx, other.id, specA.id);
      const draft = (await getArticle(tx, other.id))!;
      await updateArticle(tx, other.id, {
        clientId, websiteId: siteA, title: "Edited after approval", slug: draft.slug, category: "Care", authorUserId: specA.id,
        reviewerUserId: reviewer.id, seoTitle: "x", seoDescription: "Fictional.", canonicalPath: null, indexable: true, body,
      }, specA.id, draft.current_version_id!);
      const edited = (await getRevisionState(tx, other.id))!;
      expect(edited.approved).toBeNull();
      await expect(requestShip(tx, { articleId: other.id, websiteId: siteA, versionId: other.versionId }, specA.id)).rejects.toThrow(/current approved revision/);
      await expect(requestShip(tx, { articleId: other.id, websiteId: siteA, versionId: edited.working!.versionId }, specA.id)).rejects.toThrow(/approv/i);
    });
  });

  it("never reaches four distinct revisions, and an older approval never makes a newer draft shippable", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const { clientId, siteA } = await setup(tx);
      const { id, versionId: v1 } = await approvedArticle(tx, clientId, siteA);
      await shipAndVerify(tx, id, siteA, v1);
      // Released R: approved, shipped, delivery failed. Verified stays v1.
      const released = await editAndApprove(tx, id, "Released revision");
      await as(tx, specA);
      const shipped = await requestShip(tx, { articleId: id, websiteId: siteA, versionId: released }, specA.id);
      await completeDeliveryAttempt(tx, shipped.attempt!.id, { ok: false, code: "site_unreachable" }, specA.id);
      // A newer revision A is approved but not shipped: working and approved are the same revision.
      const approved = await editAndApprove(tx, id, "Approved, not shipped");
      let state = (await getRevisionState(tx, id))!;
      expect([state.working?.versionId, state.approved?.versionId, state.released?.versionId, state.verified?.versionId])
        .toEqual([approved, approved, released, v1]);
      // Editing A requires returning it to draft, which withdraws A's approval: approved falls back to R.
      await as(tx, specA);
      await returnArticleToDraft(tx, id, specA.id);
      const draft = (await getArticle(tx, id))!;
      await updateArticle(tx, id, {
        clientId, websiteId: siteA, title: "Unapproved edit", slug: draft.slug, category: "Care", authorUserId: specA.id,
        reviewerUserId: reviewer.id, seoTitle: "x", seoDescription: "Fictional.", canonicalPath: null, indexable: true, body,
      }, specA.id, draft.current_version_id!);
      state = (await getRevisionState(tx, id))!;
      const working = state.working!.versionId;
      expect(new Set([working, released, v1]).size).toBe(3);
      expect([state.approved?.versionId, state.released?.versionId, state.verified?.versionId]).toEqual([released, released, v1]);
      // Neither the withdrawn approval of A nor R's approval makes the newer draft shippable.
      await expect(requestShip(tx, { articleId: id, websiteId: siteA, versionId: working }, specA.id)).rejects.toThrow(/approv/i);
      await expect(requestShip(tx, { articleId: id, websiteId: siteA, versionId: approved }, specA.id)).rejects.toThrow(/current approved revision/);
      await as(tx, admin);
      await expect(publishArticle(tx, id, admin.id)).rejects.toThrow(/Approve/);
      // Re-delivering the released revision is allowed and reuses its delivery; the live revision does not change.
      await as(tx, specA);
      const again = await requestShip(tx, { articleId: id, websiteId: siteA, versionId: released }, specA.id);
      expect(again.delivery.id).toBe(shipped.delivery.id);
      expect((await getArticle(tx, id))!.live_version_id).toBe(released);
    });
  });

  it("an older internal publication reports Website publication unverified and keeps its API behaviour", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const { clientId, siteA } = await setup(tx);
      const { id, versionId } = await approvedArticle(tx, clientId, siteA);
      await as(tx, admin);
      await publishArticle(tx, id, admin.id);
      const state = (await getRevisionState(tx, id))!;
      expect(state.released?.versionId).toBe(versionId);
      expect(state).toMatchObject({ verified: null, releasedDelivery: null, websiteStatus: "unverified", websiteStatusLabel: "Website publication unverified" });
      await applyContext(tx, { kind: "service" });
      const token = randomBytes(32).toString("base64url");
      await tx.query("insert into seo_site_tokens (client_id, website_id, token_hash, created_by) values ($1, $2, $3, $4)",
        [clientId, siteA, createHash("sha256").update(token).digest("hex"), admin.id]);
      const api = await getPublishedBlog(tx, siteA, token);
      expect(api?.articles.map((article) => article.id)).toEqual([id]);
    });
  });
});

describe("delivery and verification (D87)", () => {
  it("concurrent ship requests share one delivery, one attempt and one publication", async () => {
    const { clientId, siteA } = await db.asContext(staffContext(admin), (tx) => setup(tx), { commit: true });
    const { id, versionId } = await db.asContext(staffContext(admin), (tx) => approvedArticle(tx, clientId, siteA), { commit: true });
    const ship = () => db.asContext(staffContext(specA), (tx) => requestShip(tx, { articleId: id, websiteId: siteA, versionId }, specA.id), { commit: true });
    const results = await Promise.all([ship(), ship(), ship()]);
    expect(results.filter((r) => r.outcome === "started")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "in_progress")).toHaveLength(2);
    expect(new Set(results.map((r) => r.attempt!.id)).size).toBe(1);
    expect(await count("select count(*) n from blog_deliveries where article_id = $1", [id])).toBe(1);
    expect(await count("select count(*) n from blog_delivery_attempts where article_id = $1", [id])).toBe(1);
    expect(await count("select count(*) n from blog_publications where article_id = $1", [id])).toBe(1);
  });

  it("a failed delivery is retried on the same delivery, and a timed-out attempt's late result changes nothing", async () => {
    const { clientId, siteA } = await db.asContext(staffContext(admin), (tx) => setup(tx), { commit: true });
    const { id, versionId } = await db.asContext(staffContext(admin), (tx) => approvedArticle(tx, clientId, siteA), { commit: true });
    const input = { articleId: id, websiteId: siteA, versionId };
    await db.asContext(staffContext(specA), async (tx) => {
      const first = await requestShip(tx, input, specA.id);
      const failed = await completeDeliveryAttempt(tx, first.attempt!.id, { ok: false, code: "site_unreachable" }, specA.id);
      expect(failed.applied && failed.delivery.state).toBe("delivery_failed");
      const retry = await requestShip(tx, input, specA.id);
      expect(retry.outcome).toBe("started");
      expect(retry.delivery.id).toBe(first.delivery.id);
      expect(retry.attempt!.attempt_number).toBe(2);
    }, { commit: true });
    // Attempt 2 is lost (no result). After the lease, a retry times it out and starts attempt 3.
    // Simulates the passage of time: the start time is otherwise immutable, so the owner bypasses triggers for this one statement.
    const owner = await db.admin.connect();
    try {
      await owner.query("begin");
      await owner.query("set local session_replication_role = replica");
      await owner.query("update blog_delivery_attempts set started_at = now() - interval '10 minutes' where article_id = $1 and status = 'started'", [id]);
      await owner.query("commit");
    } finally {
      owner.release();
    }
    await db.asContext(staffContext(specA), async (tx) => {
      const third = await requestShip(tx, input, specA.id);
      expect(third.attempt!.attempt_number).toBe(3);
      const [lost] = (await listPublishingHistory(tx, id)).filter((a) => a.attempt_number === 2);
      expect(lost!.status).toBe("timed_out");
      // The lost attempt reports late: ignored.
      expect(await completeDeliveryAttempt(tx, lost!.id, { ok: true }, specA.id)).toEqual({ applied: false, reason: "already_finished" });
      expect((await getRevisionState(tx, id))!.websiteStatus).toBe("delivery_pending");
      const done = await completeDeliveryAttempt(tx, third.attempt!.id, { ok: true }, specA.id);
      expect(done.applied && done.delivery.state).toBe("awaiting_verification");
      // A completed attempt cannot report twice.
      expect(await completeDeliveryAttempt(tx, third.attempt!.id, { ok: false, code: "site_error" }, specA.id)).toEqual({ applied: false, reason: "already_finished" });
      const history = await listPublishingHistory(tx, id);
      expect([...history].sort((x, y) => y.attempt_number - x.attempt_number).map((a) => [a.attempt_number, a.kind, a.status])).toEqual([[3, "deliver", "succeeded"], [2, "deliver", "timed_out"], [1, "deliver", "failed"]]);
    }, { commit: true });
    expect(await count("select count(*) n from blog_deliveries where article_id = $1", [id])).toBe(1);
    expect(await count("select count(*) n from blog_publications where article_id = $1", [id])).toBe(1);
    expect(await count("select count(*) n from blog_activity where article_id = $1 and action = 'publish_failed'", [id])).toBe(1);
    // History rows are append-only once finished.
    await expect(db.admin.query("update blog_delivery_attempts set status = 'succeeded' where article_id = $1", [id])).rejects.toThrow(/cannot change/);
  });

  it("a verification retry only verifies: no content is re-sent", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const { clientId, siteA } = await setup(tx);
      const { id, versionId } = await approvedArticle(tx, clientId, siteA);
      const input = { articleId: id, websiteId: siteA, versionId };
      await as(tx, specA);
      await expect(requestVerification(tx, input, specA.id)).rejects.toThrow(/not been shipped/);
      const shipped = await requestShip(tx, input, specA.id);
      await expect(requestVerification(tx, input, specA.id)).rejects.toThrow(/Delivery has not succeeded/);
      await completeDeliveryAttempt(tx, shipped.attempt!.id, { ok: true }, specA.id);
      // Asking to ship again now does not start another delivery.
      expect((await requestShip(tx, input, specA.id)).outcome).toBe("awaiting_verification");
      const firstCheck = await requestVerification(tx, input, specA.id);
      expect((await requestVerification(tx, input, specA.id)).outcome).toBe("in_progress");
      const pending = await completeVerificationAttempt(tx, firstCheck.attempt!.id, { verified: false, code: "different_revision" }, specA.id);
      expect(pending.applied && pending.delivery.state).toBe("awaiting_verification");
      const secondCheck = await requestVerification(tx, input, specA.id);
      const verified = await completeVerificationAttempt(tx, secondCheck.attempt!.id, { verified: true, publicUrl: "https://check.example.invalid/blog/note" }, specA.id);
      expect(verified.applied && verified.delivery.state).toBe("verified");
      expect((await requestShip(tx, input, specA.id)).outcome).toBe("already_verified");
      expect((await requestVerification(tx, input, specA.id)).outcome).toBe("already_verified");
      const history = await listPublishingHistory(tx, id);
      expect(history.filter((a) => a.kind === "deliver")).toHaveLength(1);
      expect(history.filter((a) => a.kind === "verify").map((a) => a.status)).toEqual(["succeeded", "failed"]);
      const state = (await getRevisionState(tx, id))!;
      expect(state).toMatchObject({ websiteStatus: "verified", websiteStatusLabel: "Verified on website" });
      expect(state.verified).toMatchObject({ versionId, publicUrl: "https://check.example.invalid/blog/note" });
      // A verified delivery cannot be moved back.
      await tx.query("savepoint back");
      await expect(tx.query("update blog_deliveries set state = 'awaiting_verification' where id = $1", [shipped.delivery.id])).rejects.toThrow(/verified delivery/);
      await tx.query("rollback to savepoint back");
    });
  });

  it("a late verification of an older revision never replaces a newer verified revision", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const { clientId, siteA } = await setup(tx);
      const { id, versionId: v1 } = await approvedArticle(tx, clientId, siteA);
      await as(tx, specA);
      const ship1 = await requestShip(tx, { articleId: id, websiteId: siteA, versionId: v1 }, specA.id);
      await completeDeliveryAttempt(tx, ship1.attempt!.id, { ok: true }, specA.id);
      const check1 = await requestVerification(tx, { articleId: id, websiteId: siteA, versionId: v1 }, specA.id);
      // v1's check is slow. Meanwhile v2 is approved, shipped and verified.
      const v2 = await editAndApprove(tx, id, "Second revision");
      const ok = await shipAndVerify(tx, id, siteA, v2);
      expect(ok.applied).toBe(true);
      // v1's result arrives late.
      expect(await completeVerificationAttempt(tx, check1.attempt!.id, { verified: true, publicUrl: "https://check.example.invalid/blog/old" }, specA.id))
        .toEqual({ applied: false, reason: "newer_revision_verified" });
      const state = (await getRevisionState(tx, id))!;
      expect(state.verified?.versionId).toBe(v2);
      expect(state.released?.versionId).toBe(v2);
      expect(state.websiteStatus).toBe("verified");
      expect((await listPublishingHistory(tx, id)).find((a) => a.id === check1.attempt!.id)?.status).toBe("superseded");
      // The database refuses a downgrade written directly.
      await tx.query("savepoint downgrade");
      await expect(tx.query("update blog_verified_revisions set version_id = $2, version_number = 1, delivery_id = $3 where article_id = $1", [id, v1, ship1.delivery.id]))
        .rejects.toThrow(/verified delivery|older revision/);
      await tx.query("rollback to savepoint downgrade");
    });
  });
});

describe("website-scoped shipping (D87)", () => {
  it("separates two websites of one client, and other clients", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const { clientId, siteA, siteB } = await setup(tx);
      const onA = await approvedArticle(tx, clientId, siteA);
      const onB = await approvedArticle(tx, clientId, siteB);
      await as(tx, specA);
      // Granted on A only.
      expect((await requestShip(tx, { articleId: onA.id, websiteId: siteA, versionId: onA.versionId }, specA.id)).outcome).toBe("started");
      await expect(requestShip(tx, { articleId: onB.id, websiteId: siteB, versionId: onB.versionId }, specA.id)).rejects.toThrow(/not authorised/);
      await expect(publishArticle(tx, onB.id, specA.id)).rejects.toThrow(/not authorised/);
      // The article's own website only, even for an administrator.
      await as(tx, admin);
      await expect(requestShip(tx, { articleId: onB.id, websiteId: siteA, versionId: onB.versionId }, admin.id)).rejects.toThrow(/different website/);
      await expect(requestShip(tx, { articleId: onB.id, websiteId: siteB, versionId: onA.versionId }, admin.id)).rejects.toThrow(/does not belong/);
      // The database refuses a delivery whose article, revision and website do not belong together.
      await tx.query("savepoint mismatch");
      await expect(tx.query("insert into blog_deliveries (article_id, client_id, website_id, version_id, started_by) values ($1, $2, $3, $4, $5)",
        [onB.id, clientId, siteA, onB.versionId, admin.id])).rejects.toThrow(/do not belong together/);
      await tx.query("rollback to savepoint mismatch");

      // Another client's specialist, even with a grant on their own client's website, cannot see or ship this article.
      const other = await provisionClinic(tx, admin.id, [specB.id]);
      await grantWebsitePublisher(tx, { websiteId: other.websiteId, userId: specB.id }, admin.id);
      await as(tx, specB);
      await expect(requestShip(tx, { articleId: onA.id, websiteId: siteA, versionId: onA.versionId }, specB.id)).rejects.toThrow(/not found/);
      expect(await getRevisionState(tx, onA.id)).toBeNull();
      expect(await listPublishingHistory(tx, onA.id)).toEqual([]);
    });
  });

  it("a client-level grant alone (membership or the manager role) never authorises shipping", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const { clientId, siteA, siteB } = await setup(tx);
      const onB = await approvedArticle(tx, clientId, siteB);
      // specA is a member of the client and may edit it, but holds no grant on site B.
      await as(tx, specA);
      await expect(requestShip(tx, { articleId: onB.id, websiteId: siteB, versionId: onB.versionId }, specA.id)).rejects.toThrow(/not authorised/);
      // The manager role is global but not website-scoped: service, guard trigger and policies all refuse.
      await as(tx, manager);
      await expect(requestShip(tx, { articleId: onB.id, websiteId: siteB, versionId: onB.versionId }, manager.id)).rejects.toThrow(/not authorised/);
      await expect(publishArticle(tx, onB.id, manager.id)).rejects.toThrow(/not authorised/);
      await tx.query("savepoint direct");
      await tx.query("select set_config('app.blog_transition', 'publish', true)");
      await expect(tx.query("update blog_articles set status = 'published', live_version_id = current_version_id, working_status = null where id = $1", [onB.id]))
        .rejects.toThrow(/not authorised to publish/);
      await tx.query("rollback to savepoint direct");
      await tx.query("savepoint publication");
      await expect(tx.query("insert into blog_publications (article_id, client_id, website_id, version_id, action, actor_user_id) values ($1, $2, $3, $4, 'publish', $5)",
        [onB.id, clientId, siteB, onB.versionId, manager.id])).rejects.toThrow(/row-level security/);
      await tx.query("rollback to savepoint publication");
      await tx.query("savepoint delivery");
      await expect(tx.query("insert into blog_deliveries (article_id, client_id, website_id, version_id, started_by) values ($1, $2, $3, $4, $5)",
        [onB.id, clientId, siteB, onB.versionId, manager.id])).rejects.toThrow(/row-level security/);
      await tx.query("rollback to savepoint delivery");
      // The reviewer approves (client-scoped) but cannot ship.
      await as(tx, reviewer);
      await expect(requestShip(tx, { articleId: onB.id, websiteId: siteB, versionId: onB.versionId }, reviewer.id)).rejects.toThrow(/not authorised/);
      // A manager with a grant may ship; the same person may approve and ship.
      await as(tx, admin);
      await grantWebsitePublisher(tx, { websiteId: siteB, userId: manager.id }, admin.id);
      await as(tx, manager);
      expect((await requestShip(tx, { articleId: onB.id, websiteId: siteB, versionId: onB.versionId }, manager.id)).outcome).toBe("started");
      // Unpublishing is website-scoped too: specA (no grant on B) cannot.
      await as(tx, specA);
      await expect(unpublishArticle(tx, onB.id, specA.id)).rejects.toThrow(/not authorised/);
      void siteA;
    });
  });

  it("grants are administrator-only, refuse read-only accounts, need client access, and stop working when revoked", async () => {
    await db.asContext(staffContext(admin), async (tx) => {
      const { clientId, siteA } = await setup(tx);
      await as(tx, manager);
      await expect(grantWebsitePublisher(tx, { websiteId: siteA, userId: specB.id }, manager.id)).rejects.toThrow(/administrator/);
      await as(tx, admin);
      await tx.query("savepoint ro");
      await expect(grantWebsitePublisher(tx, { websiteId: siteA, userId: readonly.id }, admin.id)).rejects.toThrow(/read-only/);
      await tx.query("rollback to savepoint ro");
      // A grant without client access does not authorise: specB is not a member of this client.
      await grantWebsitePublisher(tx, { websiteId: siteA, userId: specB.id }, admin.id);
      const article = await approvedArticle(tx, clientId, siteA);
      await as(tx, specB);
      await expect(requestShip(tx, { articleId: article.id, websiteId: siteA, versionId: article.versionId }, specB.id)).rejects.toThrow(/not found/);
      // Revoked: specA loses shipping on site A.
      await as(tx, admin);
      expect(await grantWebsitePublisher(tx, { websiteId: siteA, userId: specA.id }, admin.id)).toBeTruthy();
      expect(await revokeWebsitePublisher(tx, { websiteId: siteA, userId: specA.id }, admin.id)).toBe(true);
      await as(tx, specA);
      await expect(requestShip(tx, { articleId: article.id, websiteId: siteA, versionId: article.versionId }, specA.id)).rejects.toThrow(/not authorised/);
      // A revoked grant cannot be edited back into force.
      await as(tx, admin);
      await tx.query("savepoint unrevoke");
      await expect(tx.query("update website_publishers set revoked_at = null, revoked_by = null where website_id = $1 and user_id = $2", [siteA, specA.id])).rejects.toThrow(/only be revoked/);
      await tx.query("rollback to savepoint unrevoke");
    });
  });
});
