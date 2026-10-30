import { afterAll, describe, expect, it } from "vitest";
import { adminPool, appPool, asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";
import { createApproval, decideApproval, getApproval } from "../src/services/approvals";
import { createTask, transitionTask, TaskRuleError, getTask } from "../src/services/tasks";
import { openIssue, transitionIssue, getIssue } from "../src/services/issues";
import { createClaim, assignReview, decideReview, addSource, addWording, getClaim } from "../src/services/medical";
import { addSnapshot, listSnapshots } from "../src/services/reports";
import { recordTimeline } from "../src/services/timeline";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("tasks (A-09, A-10)", () => {
  it("waiting requires waiting-on and a follow-up date", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    await asContext(staffCtx(specA), async (db) => {
      const id = await createTask(db, { clientId: harbour, title: "Rule test", description: null, ownerUserId: specA.id, priority: "medium", dueDate: null, relatedType: null, relatedId: null }, specA.id);
      await expect(transitionTask(db, id, { status: "waiting", note: null, waitingOn: "", followUpDate: null }, specA.id)).rejects.toBeInstanceOf(TaskRuleError);
      await transitionTask(db, id, { status: "waiting", note: "chasing", waitingOn: "Client", followUpDate: "2026-10-25" }, specA.id);
      await transitionTask(db, id, { status: "completed", note: "done", waitingOn: null, followUpDate: null }, specA.id);
      const task = await getTask(db, id);
      expect(task?.status).toBe("completed");
      expect(task?.history.map((h: { to_status: string }) => h.to_status)).toEqual(["open", "waiting", "completed"]);
    });
  });

  it("rejects a related record from another client", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    const { rows } = await adminPool.query("select i.id from issues i join clients c on c.id = i.client_id where c.slug = 'northgate-physio' limit 1");
    await expect(asContext(staffCtx(specA), (db) => createTask(db, { clientId: harbour, title: "Bad link", description: null, ownerUserId: specA.id, priority: "low", dueDate: null, relatedType: "issue", relatedId: rows[0].id }, specA.id))).rejects.toThrow(/does not belong/);
  });
});

describe("approvals are append-only (A-11, A-12)", () => {
  it("a requester cannot decide, a revised decision supersedes and never edits the original", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const manager = await staffByEmail("manager@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    await asContext(staffCtx(manager), async (db) => {
      const id = await createApproval(db, { clientId: harbour, title: "Append-only test", summary: null, requestType: "other", relatedType: null, relatedId: null }, specA.id, true);
      await expect(decideApproval(db, id, { outcome: "approved", note: null }, specA.id)).rejects.toThrow(/cannot decide/);
      const first = await decideApproval(db, id, { outcome: "changes_requested", note: "tighten the copy" }, manager.id);
      const second = await decideApproval(db, id, { outcome: "approved", note: "now fine" }, manager.id);
      const a = await getApproval(db, id);
      expect(a?.status).toBe("approved");
      expect(a?.current_decision_id).toBe(second);
      const firstRow = a!.decisions.find((d) => d.id === first)!;
      expect(firstRow.outcome).toBe("changes_requested");
      expect(firstRow.superseded_at).not.toBeNull();
      expect(a!.decisions.find((d) => d.id === second)!.supersedes_decision_id).toBe(first);
      await db.query("savepoint guard");
      await expect(db.query("update approval_decisions set outcome = 'approved' where id = $1", [first])).rejects.toThrow(/append-only/);
      await db.query("rollback to savepoint guard");
      await expect(db.query("delete from approval_decisions where id = $1", [first])).rejects.toThrow(/append-only|permission denied/);
      await db.query("rollback to savepoint guard");
    });
  });
});

describe("issue verification (A-15)", () => {
  it("records verifier, date and result; failed verification reopens", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const manager = await staffByEmail("manager@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    await asContext(staffCtx(manager), async (db) => {
      const id = await openIssue(db, harbour, { title: "Verify me", description: null, severity: "low", ownerUserId: specA.id, relatedType: null, relatedId: null }, specA.id);
      await expect(transitionIssue(db, id, { status: "verified_closed", note: "x" }, manager.id)).rejects.toThrow(/Cannot move/);
      await transitionIssue(db, id, { status: "resolved_pending_verification", note: "fixed" }, specA.id);
      await transitionIssue(db, id, { status: "reopened", note: "still broken", verificationResult: "failed" }, manager.id);
      let issue = await getIssue(db, id);
      expect(issue?.status).toBe("reopened");
      expect(issue?.verification_result).toBe("failed");
      expect(issue?.verified_by).toBe(manager.id);
      await transitionIssue(db, id, { status: "resolved_pending_verification", note: "fixed again" }, specA.id);
      await transitionIssue(db, id, { status: "verified_closed", note: "checked on three devices", verificationResult: "passed" }, manager.id);
      issue = await getIssue(db, id);
      expect(issue?.status).toBe("verified_closed");
      expect(issue?.verification_result).toBe("passed");
      expect(issue?.history.map((h: { to_status: string }) => h.to_status)).toEqual(["open", "resolved_pending_verification", "reopened", "resolved_pending_verification", "verified_closed"]);
    });
  });
});

describe("medical review (A-17)", () => {
  it("never approves without a source, preserves reviews when wording changes", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const reviewer = await staffByEmail("reviewer@example.invalid");
    const meridian = await clientBySlug("meridian-skin");
    // One rolled-back transaction; the role context switches between the specialist and the reviewer.
    await asContext(staffCtx(specA), async (db) => {
      const asRole = (u: { id: string; platform_role: string }) => db.query("select set_config('app.platform_role', $1, true), set_config('app.user_id', $2, true)", [u.platform_role, u.id]);
      const claimId = await createClaim(db, meridian, { claimSummary: "Test claim", location: null, wording: "v1 wording" }, specA.id);
      const review = await assignReview(db, claimId, reviewer.id, specA.id);
      await asRole(reviewer);
      await expect(decideReview(db, review, { decision: "approved", note: "ok" }, reviewer.id, false)).rejects.toThrow(/without at least one recorded source/);
      await addSource(db, claimId, { title: "Source", citation: null, url: null, sourceType: "guideline", reviewId: null }, reviewer.id);
      await decideReview(db, review, { decision: "approved", note: "supported" }, reviewer.id, false);
      expect((await getClaim(db, claimId))?.status).toBe("approved");
      await db.query("savepoint guard");
      await expect(db.query("update medical_reviews set decision = 'rejected' where id = $1", [review])).rejects.toThrow(/immutable/);
      await db.query("rollback to savepoint guard");
      await asRole(specA);
      await addWording(db, claimId, "v2 wording", specA.id);
      const claim = await getClaim(db, claimId);
      expect(claim?.status).toBe("draft");
      expect(claim?.reviews[0]?.status).toBe("superseded");
      expect(claim?.reviews[0]?.decision).toBe("approved");
    });
  });
});

describe("report snapshots (A-18)", () => {
  it("re-recording a figure supersedes rather than edits, and null stays unavailable", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const northgate = await clientBySlug("harbourview-dental");
    await asContext(staffCtx(specA), async (db) => {
      const a = await addSnapshot(db, northgate, { source: "manual", channel: "all", metric: "clicks", periodStart: "2026-09-01", periodEnd: "2026-09-30", value: 10, note: null }, specA.id);
      const b = await addSnapshot(db, northgate, { source: "manual", channel: "all", metric: "clicks", periodStart: "2026-09-01", periodEnd: "2026-09-30", value: 12, note: "corrected" }, specA.id);
      const current = await listSnapshots(db, { clientId: northgate });
      expect(current.find((s) => s.id === b)?.value).toBe(12);
      expect(current.find((s) => s.id === a)).toBeUndefined();
      const all = await listSnapshots(db, { clientId: northgate, includeSuperseded: true });
      expect(all.find((s) => s.id === a)?.superseded_by_id).toBe(b);
      await db.query("savepoint guard");
      await expect(db.query("update report_snapshots set value = 99 where id = $1", [a])).rejects.toThrow(/append-only/);
      await db.query("rollback to savepoint guard");
      const u = await addSnapshot(db, northgate, { source: "manual", channel: "all", metric: "patients", periodStart: "2026-09-01", periodEnd: "2026-09-30", value: null, note: "not supplied" }, specA.id);
      expect(current.length).toBeGreaterThan(0);
      expect((await listSnapshots(db, { clientId: northgate })).find((s) => s.id === u)?.value).toBeNull();
    });
  });
});

describe("timeline idempotency (A-20)", () => {
  it("the same dedupe key never creates a second event", async () => {
    const manager = await staffByEmail("manager@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    await asContext(staffCtx(manager), async (db) => {
      const key = `test:${Date.now()}`;
      await recordTimeline(db, { clientId: harbour, eventType: "task_created", title: "once", relatedType: null, relatedId: null, actorUserId: manager.id, dedupeKey: key });
      await recordTimeline(db, { clientId: harbour, eventType: "task_created", title: "twice", relatedType: null, relatedId: null, actorUserId: manager.id, dedupeKey: key });
      const n = (await db.query("select count(*)::int as n from timeline_events where dedupe_key = $1", [key])).rows[0].n;
      expect(n).toBe(1);
    });
  });
});
