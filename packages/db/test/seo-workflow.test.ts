import { afterAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import { saveConnection } from "../src/analytics/connections";
import { sealedToken } from "../src/analytics/sync";
import { AiAccessFetchError, readAiAccess, recordAiAccessCheck, type TextFetcher, type TextFetchResult } from "../src/services/ai-access";
import { saveSeoBusinessProfile } from "../src/services/seo-soft-launch";
import { createSeoPage } from "../src/services/seo";
import { transitionTask } from "../src/services/tasks";
import { checkSitemap, finishSiteCheckRun, recordSitemapCheck, runSiteChecks, siteCheckTargets, startSiteCheckRun } from "../src/services/technical-seo";
import {
  acceptRecommendation,
  dismissRecommendation,
  listCompletedTasks,
  listRecommendations,
  listSeoIssues,
  moveSeoIssue,
  recordSetupReview,
  refreshRecommendations,
  seoWorkCounts,
  setupChecklist,
  verifySeoIssue,
} from "../src/services/seo-workflow";

process.env.ANALYTICS_TOKEN_KEY = process.env.ANALYTICS_TOKEN_KEY || "analytics-test-key-0123456789";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

const SITE = "https://check.example.invalid";
type Served = (Partial<TextFetchResult> & { status: number }) | { error: string };
function fixture(pages: Record<string, Served>): TextFetcher {
  return async (url) => {
    const page = pages[url] ?? { status: 404 };
    if ("error" in page) throw new AiAccessFetchError(page.error);
    return { contentType: "text/html", body: "", bytes: 0, finalUrl: url, ...page };
  };
}
const html = (title: string, description?: string): Served => ({ status: 200, contentType: "text/html", body: `<html><head><title>${title}</title>${description ? `<meta name="description" content="${description}">` : ""}</head></html>` });
const xml = (body: string): Served => ({ status: 200, contentType: "application/xml", body });

async function run(db: pg.PoolClient, ids: { clientId: string; websiteId: string }, actorId: string, site: TextFetcher, at: string) {
  const runId = (await startSiteCheckRun(db, { ...ids, actorUserId: actorId, now: new Date(at) }))!;
  await finishSiteCheckRun(db, { runId, ...ids, results: await runSiteChecks(site, await siteCheckTargets(db, ids.websiteId, SITE)), now: new Date(at) });
}

describe("setup checklist (SEO-02.1)", () => {
  it("shows 4/5 with the sitemap pending, opens Sitemaps, then 5/5 after a full pass", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const ids = { clientId: clinic.clientId, websiteId: clinic.websiteId };
      const token = sealedToken({ accessToken: "fixture", expiresAt: "2100-01-01T00:00:00.000Z" });
      await saveConnection(db, { ...ids, provider: "gsc", externalPropertyId: "sc-domain:check.example.invalid", streamOrSiteRef: null, providerTimezone: "America/Los_Angeles", tokenCiphertext: token.ciphertext, tokenNonce: token.nonce, actorUserId: admin.id });
      await applyContext(db, staffCtx(admin));
      expect((await setupChecklist(db, { id: clinic.websiteId, clientId: clinic.clientId })).done).toBe(1);
      for (const step of ["website_details", "homepage_seo", "indexing"] as const) await recordSetupReview(db, { ...ids, step, note: null, actorUserId: admin.id });

      let checklist = await setupChecklist(db, { id: clinic.websiteId, clientId: clinic.clientId });
      expect(`${checklist.done}/${checklist.total}`).toBe("4/5");
      expect(checklist.next?.key).toBe("sitemap");
      expect(checklist.next?.href).toBe(`/seo/site-health?website=${clinic.websiteId}&tab=crawl`);
      expect(checklist.steps.filter((step) => step.complete).every((step) => step.evidenceAt instanceof Date)).toBe(true);

      await applyContext(db, SERVICE);
      const reading = await checkSitemap(fixture({ [`${SITE}/sitemap.xml`]: xml(`<urlset><url><loc>${SITE}/</loc></url></urlset>`) }), `${SITE}/sitemap.xml`);
      await recordSitemapCheck(db, { ...ids, source: "default", reading, actorUserId: admin.id });
      await applyContext(db, staffCtx(admin));
      checklist = await setupChecklist(db, { id: clinic.websiteId, clientId: clinic.clientId });
      expect(`${checklist.done}/${checklist.total}`).toBe("5/5");
      expect(checklist.next).toBeNull();
    });
  });
});

describe("issues from website checks (SEO-02.2)", () => {
  it("stays unresolved while ready to verify, falls by one when verified, and reopens on recurrence", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(SERVICE, async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      const ids = { clientId: clinic.clientId, websiteId: clinic.websiteId };
      await createSeoPage(db, clinic.clientId, { websiteId: clinic.websiteId, pagePath: "/services/consultation", pageTitle: "Consultation", primaryKeyword: null, secondaryKeywords: [], searchIntent: null, contentStatus: "published", ownerUserId: null, lastReviewedOn: null, nextReviewOn: null, mappingFlag: "none", flagNote: null, notes: null }, admin.id);
      const broken = fixture({ [`${SITE}/`]: html("Home", "Home page"), [`${SITE}/services/consultation`]: html("Consultation") });
      const fixed = fixture({ [`${SITE}/`]: html("Home", "Home page"), [`${SITE}/services/consultation`]: html("Consultation", "Book a consultation") });
      const unresolved = async () => (await seoWorkCounts(db, { ...ids, start: "2026-11-01", end: "2026-11-30" })).unresolvedIssues;

      await run(db, ids, admin.id, broken, "2099-01-01T01:00:00Z");
      await run(db, ids, admin.id, broken, "2099-01-02T01:00:00Z");
      let issues = await listSeoIssues(db, clinic.websiteId);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ status: "open", pagePath: "/services/consultation", checkType: "missing_description", source: "Website check" });
      expect(await unresolved()).toBe(1);

      const issueId = issues[0]!.id;
      await moveSeoIssue(db, { websiteId: clinic.websiteId, issueId, to: "investigating", note: null, actorUserId: admin.id });
      await moveSeoIssue(db, { websiteId: clinic.websiteId, issueId, to: "resolved_pending_verification", note: "Description added on the website.", actorUserId: admin.id });
      expect(await unresolved()).toBe(1);
      // No recheck yet: verification needs a check or a recorded verification.
      await expect(verifySeoIssue(db, { websiteId: clinic.websiteId, issueId, evidence: "recheck", note: null, actorUserId: admin.id })).rejects.toThrow(/No website check/);
      await expect(verifySeoIssue(db, { websiteId: clinic.websiteId, issueId, evidence: "recorded", note: " ", actorUserId: admin.id })).rejects.toThrow(/Record what you checked/);

      await run(db, ids, admin.id, fixed, "2099-01-03T01:00:00Z");
      issues = await listSeoIssues(db, clinic.websiteId);
      expect(issues[0]?.recheckEvidence?.at).toEqual(new Date("2099-01-03T01:00:00Z"));
      await verifySeoIssue(db, { websiteId: clinic.websiteId, issueId, evidence: "recheck", note: null, actorUserId: admin.id });
      expect(await unresolved()).toBe(0);
      expect((await listSeoIssues(db, clinic.websiteId))[0]?.status).toBe("verified_closed");

      await run(db, ids, admin.id, broken, "2099-01-04T01:00:00Z");
      issues = await listSeoIssues(db, clinic.websiteId);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ id: issueId, status: "reopened", reopenCount: 1 });
      expect(await unresolved()).toBe(1);

      // A recorded verification also closes it; another website's staff cannot act on it.
      await moveSeoIssue(db, { websiteId: clinic.websiteId, issueId, to: "resolved_pending_verification", note: "Fixed again.", actorUserId: admin.id });
      await verifySeoIssue(db, { websiteId: clinic.websiteId, issueId, evidence: "recorded", note: "Viewed the page source: description present.", actorUserId: admin.id });
      expect(await unresolved()).toBe(0);
      await expect(moveSeoIssue(db, { websiteId: clinic.stagingId, issueId, to: "investigating", note: null, actorUserId: admin.id })).rejects.toThrow(/not part of this website/);
    });
  });
});

/** Removes a committed fixture clinic. Append-only triggers are suspended for this owner transaction only. */
async function removeClinic(clientId: string) {
  const db = await adminPool.connect();
  try {
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    for (const table of ["seo_recommendations", "task_history", "tasks", "seo_ai_access_checks", "seo_business_profiles", "websites", "timeline_events", "audit_events", "memberships"]) {
      await db.query(`delete from ${table} where client_id = $1`, [clientId]);
    }
    await db.query("delete from clients where id = $1", [clientId]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}

describe("recommendations (SEO-02.3)", () => {
  async function seed(db: pg.PoolClient, adminId: string) {
    const clinic = await provisionClinic(db, adminId);
    await saveSeoBusinessProfile(db, clinic.clientId, { branchName: "Branch C", profileUrl: null, externalIdentifier: null, setupStatus: "not_started", notes: null }, adminId);
    await recordAiAccessCheck(db, { clientId: clinic.clientId, websiteId: clinic.websiteId, userId: adminId, reading: await readAiAccess(fixture({}), SITE) });
    return clinic;
  }

  it("creates one task when accepted twice, keeps a dismissal, and counts only new suggestions", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(staffCtx(admin), async (db) => {
      const clinic = await seed(db, admin.id);
      const site = { id: clinic.websiteId, clientId: clinic.clientId };
      expect(await refreshRecommendations(db, site)).toBe(2);
      expect(await refreshRecommendations(db, site)).toBe(0);
      const [branch, llms] = ["branch_unmapped", "llms_missing"].map((kind) => kind);
      let list = await listRecommendations(db, clinic.websiteId);
      const unmapped = list.find((rec) => rec.kind === branch)!;
      const missing = list.find((rec) => rec.kind === llms)!;
      expect(unmapped).toMatchObject({ status: "new", title: "Map Branch C to its Google listing", affected: "Branch C" });
      expect((await seoWorkCounts(db, { websiteId: clinic.websiteId, clientId: clinic.clientId, start: "2026-11-01", end: "2026-11-30" })).newRecommendations).toBe(2);

      const first = await acceptRecommendation(db, { websiteId: clinic.websiteId, recommendationId: unmapped.id, ownerUserId: admin.id, actorUserId: admin.id });
      const second = await acceptRecommendation(db, { websiteId: clinic.websiteId, recommendationId: unmapped.id, ownerUserId: admin.id, actorUserId: admin.id });
      expect(first.created).toBe(true);
      expect(second).toEqual({ taskId: first.taskId, created: false });
      expect((await db.query("select count(*)::int as n from tasks where related_type = 'seo_recommendation' and related_id = $1", [unmapped.id])).rows[0].n).toBe(1);

      await dismissRecommendation(db, { websiteId: clinic.websiteId, recommendationId: missing.id, reason: "The website owner does not want an llms.txt yet.", actorUserId: admin.id });
      list = await listRecommendations(db, clinic.websiteId);
      expect(list.find((rec) => rec.id === unmapped.id)).toMatchObject({ status: "task_created", taskId: first.taskId, decidedByName: "Demo Admin" });
      expect(list.find((rec) => rec.id === missing.id)).toMatchObject({ status: "dismissed", dismissReason: "The website owner does not want an llms.txt yet.", decidedByName: "Demo Admin" });
      expect((await seoWorkCounts(db, { websiteId: clinic.websiteId, clientId: clinic.clientId, start: "2026-11-01", end: "2026-11-30" })).newRecommendations).toBe(0);
      // A refresh does not bring decided suggestions back.
      expect(await refreshRecommendations(db, site)).toBe(0);
      await expect(acceptRecommendation(db, { websiteId: clinic.websiteId, recommendationId: missing.id, ownerUserId: admin.id, actorUserId: admin.id })).rejects.toThrow(/dismissed/);
    });
  });

  it("creates one task when two accepts run at the same time", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    // Committed rows, because concurrent transactions cannot see each other's uncommitted work. Removed afterwards.
    const { clinic, recommendationId } = await asContext(staffCtx(admin), async (db) => {
      const clinic = await seed(db, admin.id);
      await refreshRecommendations(db, { id: clinic.websiteId, clientId: clinic.clientId });
      return { clinic, recommendationId: (await listRecommendations(db, clinic.websiteId)).find((rec) => rec.kind === "branch_unmapped")!.id };
    }, { commit: true });
    try {
      const accept = () => asContext(staffCtx(admin), (db) => acceptRecommendation(db, { websiteId: clinic.websiteId, recommendationId, ownerUserId: admin.id, actorUserId: admin.id }), { commit: true });
      const [a, b] = await Promise.all([accept(), accept()]);
      expect(a.taskId).toBe(b.taskId);
      expect([a.created, b.created].sort()).toEqual([false, true]);
      expect((await adminPool.query("select count(*)::int as n from tasks where related_type = 'seo_recommendation' and related_id = $1", [recommendationId])).rows[0].n).toBe(1);
    } finally {
      await removeClinic(clinic.clientId);
    }
  });
});

describe("completed tasks (SEO-02.4)", () => {
  it("lists only tasks completed in the window for the website, and a reopened task leaves the list and the count", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    await asContext(staffCtx(admin), async (db) => {
      const clinic = await provisionClinic(db, admin.id);
      await saveSeoBusinessProfile(db, clinic.clientId, { branchName: "Branch C", profileUrl: null, externalIdentifier: null, setupStatus: "not_started", notes: null }, admin.id);
      await saveSeoBusinessProfile(db, clinic.clientId, { branchName: "Branch D", profileUrl: null, externalIdentifier: null, setupStatus: "not_started", notes: null }, admin.id);
      await refreshRecommendations(db, { id: clinic.websiteId, clientId: clinic.clientId });
      const [today, older] = await listRecommendations(db, clinic.websiteId);
      const t1 = (await acceptRecommendation(db, { websiteId: clinic.websiteId, recommendationId: today!.id, ownerUserId: admin.id, actorUserId: admin.id })).taskId;
      const t2 = (await acceptRecommendation(db, { websiteId: clinic.websiteId, recommendationId: older!.id, ownerUserId: admin.id, actorUserId: admin.id })).taskId;
      for (const id of [t1, t2]) await transitionTask(db, id, { status: "completed", note: null }, admin.id);
      // One completion falls outside the default 30-day window.
      await db.query("update tasks set completed_at = now() - interval '45 days' where id = $1", [t2]);
      const end = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
      const start = new Date(Date.now() - 29 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
      const window = { websiteId: clinic.websiteId, start, end };
      let done = await listCompletedTasks(db, window);
      expect(done.map((task) => task.id)).toEqual([t1]);
      expect(done[0]).toMatchObject({ status: "completed", ownerName: "Demo Admin", linkedType: "seo_recommendation" });
      expect((await seoWorkCounts(db, { ...window, clientId: clinic.clientId })).completedTasks).toBe(1);

      await transitionTask(db, t1, { status: "open", note: "Not finished" }, admin.id);
      done = await listCompletedTasks(db, window);
      expect(done).toEqual([]);
      expect((await seoWorkCounts(db, { ...window, clientId: clinic.clientId })).completedTasks).toBe(0);
      // Another environment of the website sees none of them.
      expect(await listCompletedTasks(db, { ...window, websiteId: clinic.stagingId })).toEqual([]);
    });
  });
});
