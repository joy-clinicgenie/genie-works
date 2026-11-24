import type { Queryable } from "../client";
import { recordAudit } from "./audit";
import { PermissionDeniedError } from "./auth";
import { BlogRuleError } from "./blog-content";
import { canShipWebsite, getArticle, publishArticle } from "./blog";

/**
 * D87. Revision and delivery tracking for "Ship to site".
 *
 * Revisions: working = current_version_id; approved = newest revision whose latest decision is
 * approved; released = live_version_id (what the content API serves, unchanged); verified = the
 * row in blog_verified_revisions, which only moves forward.
 *
 * Deliveries: one per website, article and revision. Each try is a blog_delivery_attempts row
 * (the Publishing history). This module records state only; the network calls that deliver to
 * and verify the website belong to the application and report back through complete*().
 */

export type DeliveryState = "delivery_pending" | "delivery_failed" | "awaiting_verification" | "verified";
export type AttemptKind = "deliver" | "verify";
export type AttemptStatus = "started" | "succeeded" | "failed" | "timed_out" | "superseded";
export type WebsitePublicationStatus = "not_published" | "unverified" | DeliveryState;

/** An attempt still "started" after this long is treated as lost and marked timed out. */
export const ATTEMPT_LEASE_SECONDS = 120;

export const WEBSITE_STATUS_LABEL: Record<WebsitePublicationStatus, string> = {
  not_published: "Not published",
  unverified: "Website publication unverified",
  delivery_pending: "Delivery pending",
  delivery_failed: "Delivery failed",
  awaiting_verification: "Awaiting verification",
  verified: "Verified on website",
};

const CODE = /^[a-z0-9_]{1,64}$/;

export interface RevisionRef {
  versionId: string;
  versionNumber: number;
}

export interface BlogDelivery {
  id: string;
  article_id: string;
  client_id: string;
  website_id: string;
  version_id: string;
  state: DeliveryState;
  failure_code: string | null;
  public_url: string | null;
  current_attempt_id: string | null;
  started_at: Date;
  updated_at: Date;
  verified_at: Date | null;
}

export interface DeliveryAttempt {
  id: string;
  delivery_id: string;
  article_id: string;
  website_id: string;
  version_id: string;
  version_number: number;
  kind: AttemptKind;
  attempt_number: number;
  status: AttemptStatus;
  outcome_code: string | null;
  public_url: string | null;
  started_by: string;
  started_by_name: string | null;
  started_at: Date;
  finished_at: Date | null;
}

export interface RevisionState {
  articleId: string;
  websiteId: string;
  working: RevisionRef | null;
  approved: RevisionRef | null;
  released: RevisionRef | null;
  verified: (RevisionRef & { verifiedAt: Date; publicUrl: string | null }) | null;
  /** The delivery of the released revision, if one has been requested. */
  releasedDelivery: BlogDelivery | null;
  websiteStatus: WebsitePublicationStatus;
  websiteStatusLabel: string;
}

export type ShipOutcome = "started" | "in_progress" | "awaiting_verification" | "already_verified";
export type CompleteOutcome = { applied: true; delivery: BlogDelivery } | { applied: false; reason: "not_found" | "already_finished" | "superseded" | "newer_revision_verified" };

const DELIVERY_COLUMNS = "id, article_id, client_id, website_id, version_id, state, failure_code, public_url, current_attempt_id, started_at, updated_at, verified_at";

async function revisionRef(db: Queryable, articleId: string, versionId: string | null): Promise<RevisionRef | null> {
  if (!versionId) return null;
  const { rows } = await db.query<{ version_number: number }>(
    "select version_number from blog_article_versions where id = $1 and article_id = $2",
    [versionId, articleId],
  );
  return rows[0] ? { versionId, versionNumber: rows[0].version_number } : null;
}

/** All four revisions of an article, and what the website is known to show. */
export async function getRevisionState(db: Queryable, articleId: string): Promise<RevisionState | null> {
  const article = await getArticle(db, articleId);
  if (!article) return null;
  const { rows: approvedRows } = await db.query<{ id: string; version_number: number }>(
    `select v.id, v.version_number
     from blog_article_versions v
     where v.article_id = $1 and blog_latest_decision($1, v.id) = 'approved'
     order by v.version_number desc
     limit 1`,
    [articleId],
  );
  const { rows: verifiedRows } = await db.query<{ version_id: string; version_number: number; verified_at: Date; public_url: string | null }>(
    "select version_id, version_number, verified_at, public_url from blog_verified_revisions where article_id = $1 and website_id = $2",
    [articleId, article.website_id],
  );
  const released = await revisionRef(db, articleId, article.live_version_id);
  const releasedDelivery = released
    ? (await db.query<BlogDelivery>(
        `select ${DELIVERY_COLUMNS} from blog_deliveries where website_id = $1 and article_id = $2 and version_id = $3`,
        [article.website_id, articleId, released.versionId],
      )).rows[0] ?? null
    : null;
  const verifiedRow = verifiedRows[0];
  const verified = verifiedRow
    ? { versionId: verifiedRow.version_id, versionNumber: verifiedRow.version_number, verifiedAt: verifiedRow.verified_at, publicUrl: verifiedRow.public_url }
    : null;
  let websiteStatus: WebsitePublicationStatus;
  if (!released) websiteStatus = "not_published";
  else if (verified?.versionId === released.versionId) websiteStatus = "verified";
  else if (releasedDelivery) websiteStatus = releasedDelivery.state;
  // Released before D87, or released without a delivery: never inferred as verified.
  else websiteStatus = "unverified";
  return {
    articleId,
    websiteId: article.website_id,
    working: await revisionRef(db, articleId, article.current_version_id),
    approved: approvedRows[0] ? { versionId: approvedRows[0].id, versionNumber: approvedRows[0].version_number } : null,
    released,
    verified,
    releasedDelivery,
    websiteStatus,
    websiteStatusLabel: WEBSITE_STATUS_LABEL[websiteStatus],
  };
}

/** Article, revision and destination website must belong together, and the actor must hold the website grant. */
async function requireShipScope(db: Queryable, input: { articleId: string; websiteId: string; versionId: string }) {
  const article = await getArticle(db, input.articleId);
  if (!article) throw new BlogRuleError("Article not found.");
  if (article.website_id !== input.websiteId) throw new BlogRuleError("This article is assigned to a different website.", "websiteId");
  const revision = await revisionRef(db, article.id, input.versionId);
  if (!revision) throw new BlogRuleError("That revision does not belong to this article.", "versionId");
  if (!(await canShipWebsite(db, article.website_id))) throw new PermissionDeniedError("You are not authorised to ship to this website.");
  return { article, revision };
}

async function lockDelivery(db: Queryable, input: { websiteId: string; articleId: string; versionId: string }): Promise<BlogDelivery | null> {
  const { rows } = await db.query<BlogDelivery>(
    `select ${DELIVERY_COLUMNS} from blog_deliveries where website_id = $1 and article_id = $2 and version_id = $3 for update`,
    [input.websiteId, input.articleId, input.versionId],
  );
  return rows[0] ?? null;
}

/**
 * Returns the delivery's running attempt if it is still within its lease. An attempt past the
 * lease is marked timed out, so a retry after a timeout starts a fresh attempt on the same delivery.
 */
async function runningAttempt(db: Queryable, deliveryId: string): Promise<{ id: string; kind: AttemptKind } | null> {
  const { rows } = await db.query<{ id: string; kind: AttemptKind; stale: boolean }>(
    `select id, kind, started_at < now() - make_interval(secs => $2) as stale
     from blog_delivery_attempts where delivery_id = $1 and status = 'started' for update`,
    [deliveryId, ATTEMPT_LEASE_SECONDS],
  );
  const running = rows[0];
  if (!running) return null;
  if (!running.stale) return { id: running.id, kind: running.kind };
  await db.query(
    "update blog_delivery_attempts set status = 'timed_out', outcome_code = 'timed_out', finished_at = now() where id = $1 and status = 'started'",
    [running.id],
  );
  return null;
}

async function startAttempt(db: Queryable, delivery: BlogDelivery, kind: AttemptKind, actorUserId: string): Promise<DeliveryAttempt> {
  const { rows } = await db.query<{ id: string }>(
    `insert into blog_delivery_attempts (delivery_id, article_id, client_id, website_id, version_id, kind, attempt_number, started_by)
     values ($1, $2, $3, $4, $5, $6, (select coalesce(max(attempt_number), 0) + 1 from blog_delivery_attempts where delivery_id = $1), $7)
     returning id`,
    [delivery.id, delivery.article_id, delivery.client_id, delivery.website_id, delivery.version_id, kind, actorUserId],
  );
  const attemptId = rows[0]!.id;
  await db.query(
    `update blog_deliveries
       set current_attempt_id = $2, updated_at = now(),
           state = case when $3 = 'deliver' then 'delivery_pending' else state end,
           failure_code = case when $3 = 'deliver' then null else failure_code end
     where id = $1`,
    [delivery.id, attemptId, kind],
  );
  return (await getAttempt(db, attemptId))!;
}

async function getAttempt(db: Queryable, attemptId: string): Promise<DeliveryAttempt | null> {
  const { rows } = await db.query<DeliveryAttempt>(
    `select a.id, a.delivery_id, a.article_id, a.website_id, a.version_id, v.version_number, a.kind, a.attempt_number,
            a.status, a.outcome_code, a.public_url, a.started_by, u.display_name as started_by_name, a.started_at, a.finished_at
     from blog_delivery_attempts a
     join blog_article_versions v on v.id = a.version_id
     left join staff_users u on u.id = a.started_by
     where a.id = $1`,
    [attemptId],
  );
  return rows[0] ?? null;
}

/**
 * Ship to site. Releases the approved current revision (the existing, idempotent publish step),
 * then opens or reuses its logical delivery and starts a deliver attempt. A repeated or concurrent
 * request reuses the running attempt; a delivered revision is never re-sent.
 */
export async function requestShip(
  db: Queryable,
  input: { articleId: string; websiteId: string; versionId: string },
  actorUserId: string,
): Promise<{ outcome: ShipOutcome; delivery: BlogDelivery; attempt: DeliveryAttempt | null }> {
  const { article } = await requireShipScope(db, input);
  if (article.live_version_id !== input.versionId) {
    if (article.current_version_id !== input.versionId) throw new BlogRuleError("Only the current approved revision can be shipped. Submit the latest revision for review first.", "versionId");
    await publishArticle(db, article.id, actorUserId);
  }
  await db.query(
    `insert into blog_deliveries (article_id, client_id, website_id, version_id, state, started_by)
     values ($1, $2, $3, $4, 'delivery_pending', $5)
     on conflict (website_id, article_id, version_id) do nothing`,
    [article.id, article.client_id, article.website_id, input.versionId, actorUserId],
  );
  const delivery = (await lockDelivery(db, input))!;
  if (delivery.state === "verified") return { outcome: "already_verified", delivery, attempt: null };
  if (delivery.state === "awaiting_verification") return { outcome: "awaiting_verification", delivery, attempt: null };
  const running = await runningAttempt(db, delivery.id);
  if (running) return { outcome: "in_progress", delivery, attempt: await getAttempt(db, running.id) };
  const attempt = await startAttempt(db, delivery, "deliver", actorUserId);
  await recordAudit(db, {
    actorType: "staff", actorUserId, action: "blog.ship_requested", targetType: "blog_article", targetId: article.id,
    clientId: article.client_id, outcome: "success", metadata: { websiteId: article.website_id, versionId: input.versionId, attempt: attempt.attempt_number },
  });
  return { outcome: "started", delivery: (await lockDelivery(db, input))!, attempt };
}

/**
 * Verification only: starts a verify attempt on a delivered revision. Content is not re-sent.
 */
export async function requestVerification(
  db: Queryable,
  input: { articleId: string; websiteId: string; versionId: string },
  actorUserId: string,
): Promise<{ outcome: "started" | "in_progress" | "already_verified"; delivery: BlogDelivery; attempt: DeliveryAttempt | null }> {
  await requireShipScope(db, input);
  const delivery = await lockDelivery(db, input);
  if (!delivery) throw new BlogRuleError("This revision has not been shipped to the website.");
  if (delivery.state === "verified") return { outcome: "already_verified", delivery, attempt: null };
  if (delivery.state !== "awaiting_verification") throw new BlogRuleError("Delivery has not succeeded yet. Retry shipping before verifying.");
  const running = await runningAttempt(db, delivery.id);
  if (running) return { outcome: "in_progress", delivery, attempt: await getAttempt(db, running.id) };
  const attempt = await startAttempt(db, delivery, "verify", actorUserId);
  return { outcome: "started", delivery: (await lockDelivery(db, input))!, attempt };
}

/** Locks the attempt and its delivery, and decides whether a result for it may still be applied. */
type LockResult = { reject: "not_found" | "already_finished" | "superseded" } | { deliveryId: string };

async function lockForResult(db: Queryable, attemptId: string, kind: AttemptKind): Promise<LockResult> {
  const { rows } = await db.query<{ delivery_id: string; status: AttemptStatus; kind: AttemptKind; current_attempt_id: string | null; state: DeliveryState }>(
    `select a.delivery_id, a.status, a.kind, d.current_attempt_id, d.state
     from blog_delivery_attempts a join blog_deliveries d on d.id = a.delivery_id
     where a.id = $1
     for update of a, d`,
    [attemptId],
  );
  const row = rows[0];
  if (!row) return { reject: "not_found" };
  if (row.kind !== kind) throw new BlogRuleError(`That is a ${row.kind} attempt.`);
  if (row.status !== "started") return { reject: "already_finished" };
  if (row.current_attempt_id !== attemptId || row.state === "verified") {
    await db.query("update blog_delivery_attempts set status = 'superseded', outcome_code = 'superseded', finished_at = now() where id = $1", [attemptId]);
    return { reject: "superseded" };
  }
  return { deliveryId: row.delivery_id };
}

async function activity(db: Queryable, delivery: BlogDelivery, action: "publish_verified" | "publish_failed", actorUserId: string, note: string) {
  await db.query(
    "insert into blog_activity (article_id, client_id, version_id, actor_user_id, action, note) values ($1, $2, $3, $4, $5, $6)",
    [delivery.article_id, delivery.client_id, delivery.version_id, actorUserId, action, note.slice(0, 2000)],
  );
}

async function requireAttemptPermission(db: Queryable, attemptId: string): Promise<void> {
  const { rows } = await db.query<{ website_id: string }>("select website_id from blog_delivery_attempts where id = $1", [attemptId]);
  if (rows[0] && !(await canShipWebsite(db, rows[0].website_id))) throw new PermissionDeniedError("You are not authorised to ship to this website.");
}

/** Records the result of a deliver attempt. A result for a stale or superseded attempt changes nothing. */
export async function completeDeliveryAttempt(
  db: Queryable,
  attemptId: string,
  result: { ok: true } | { ok: false; code: string },
  actorUserId: string,
): Promise<CompleteOutcome> {
  if (!result.ok && !CODE.test(result.code)) throw new BlogRuleError("Unknown failure code.");
  await requireAttemptPermission(db, attemptId);
  const locked = await lockForResult(db, attemptId, "deliver");
  if ("reject" in locked) return { applied: false, reason: locked.reject };
  await db.query(
    "update blog_delivery_attempts set status = $2, outcome_code = $3, finished_at = now() where id = $1",
    [attemptId, result.ok ? "succeeded" : "failed", result.ok ? null : result.code],
  );
  const { rows } = await db.query<BlogDelivery>(
    `update blog_deliveries set state = $2, failure_code = $3, updated_at = now() where id = $1 returning ${DELIVERY_COLUMNS}`,
    [locked.deliveryId, result.ok ? "awaiting_verification" : "delivery_failed", result.ok ? null : result.code],
  );
  const delivery = rows[0]!;
  if (!result.ok) await activity(db, delivery, "publish_failed", actorUserId, `Delivery failed: ${result.code}.`);
  return { applied: true, delivery };
}

/**
 * Records the result of a verify attempt. A success moves the verified revision forward only:
 * if a newer revision of this article is already verified on the website, the result is superseded.
 */
export async function completeVerificationAttempt(
  db: Queryable,
  attemptId: string,
  result: { verified: true; publicUrl: string } | { verified: false; code: string },
  actorUserId: string,
): Promise<CompleteOutcome> {
  if (!result.verified && !CODE.test(result.code)) throw new BlogRuleError("Unknown failure code.");
  if (result.verified && !/^https?:\/\//.test(result.publicUrl)) throw new BlogRuleError("The verified URL is not valid.");
  await requireAttemptPermission(db, attemptId);
  const locked = await lockForResult(db, attemptId, "verify");
  if ("reject" in locked) return { applied: false, reason: locked.reject };
  const attempt = (await getAttempt(db, attemptId))!;
  if (!result.verified) {
    await db.query("update blog_delivery_attempts set status = 'failed', outcome_code = $2, finished_at = now() where id = $1", [attemptId, result.code]);
    const { rows } = await db.query<BlogDelivery>(
      `update blog_deliveries set failure_code = $2, updated_at = now() where id = $1 returning ${DELIVERY_COLUMNS}`,
      [locked.deliveryId, result.code],
    );
    await activity(db, rows[0]!, "publish_failed", actorUserId, `Verification failed: ${result.code}.`);
    return { applied: true, delivery: rows[0]! };
  }
  const { rows: current } = await db.query<{ version_number: number }>(
    "select version_number from blog_verified_revisions where article_id = $1 and website_id = $2 for update",
    [attempt.article_id, attempt.website_id],
  );
  if (current[0] && current[0].version_number > attempt.version_number) {
    await db.query("update blog_delivery_attempts set status = 'superseded', outcome_code = 'newer_revision_verified', finished_at = now() where id = $1", [attemptId]);
    return { applied: false, reason: "newer_revision_verified" };
  }
  await db.query("update blog_delivery_attempts set status = 'succeeded', public_url = $2, finished_at = now() where id = $1", [attemptId, result.publicUrl]);
  const { rows } = await db.query<BlogDelivery>(
    `update blog_deliveries set state = 'verified', failure_code = null, public_url = $2, verified_at = now(), updated_at = now()
     where id = $1 returning ${DELIVERY_COLUMNS}`,
    [locked.deliveryId, result.publicUrl],
  );
  const delivery = rows[0]!;
  await db.query(
    `insert into blog_verified_revisions (article_id, website_id, client_id, version_id, version_number, delivery_id, public_url)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (article_id, website_id) do update
       set version_id = excluded.version_id, version_number = excluded.version_number, delivery_id = excluded.delivery_id,
           public_url = excluded.public_url, verified_at = now()
       where blog_verified_revisions.version_number <= excluded.version_number`,
    [delivery.article_id, delivery.website_id, delivery.client_id, delivery.version_id, attempt.version_number, delivery.id, result.publicUrl],
  );
  await activity(db, delivery, "publish_verified", actorUserId, `Live at ${result.publicUrl}`);
  await recordAudit(db, {
    actorType: "staff", actorUserId, action: "blog.ship_verified", targetType: "blog_article", targetId: delivery.article_id,
    clientId: delivery.client_id, outcome: "success", metadata: { websiteId: delivery.website_id, versionId: delivery.version_id },
  });
  return { applied: true, delivery };
}

/** Publishing history: every deliver and verify attempt for an article, newest first. */
export async function listPublishingHistory(db: Queryable, articleId: string): Promise<DeliveryAttempt[]> {
  const { rows } = await db.query<DeliveryAttempt>(
    `select a.id, a.delivery_id, a.article_id, a.website_id, a.version_id, v.version_number, a.kind, a.attempt_number,
            a.status, a.outcome_code, a.public_url, a.started_by, u.display_name as started_by_name, a.started_at, a.finished_at
     from blog_delivery_attempts a
     join blog_article_versions v on v.id = a.version_id
     left join staff_users u on u.id = a.started_by
     where a.article_id = $1
     order by a.started_at desc, a.attempt_number desc`,
    [articleId],
  );
  return rows;
}

/** Administrator grant of website-scoped shipping. */
export async function grantWebsitePublisher(db: Queryable, input: { websiteId: string; userId: string }, actorUserId: string): Promise<string> {
  const role = (await db.query<{ platform_role: string }>("select platform_role from staff_users where id = $1", [actorUserId])).rows[0]?.platform_role;
  if (role !== "admin") throw new PermissionDeniedError("Only an administrator can grant website publishing.");
  const { rows: sites } = await db.query<{ client_id: string }>("select client_id from websites where id = $1 and status = 'active'", [input.websiteId]);
  const site = sites[0];
  if (!site) throw new BlogRuleError("That website is not available.", "websiteId");
  const existing = await db.query<{ id: string }>("select id from website_publishers where website_id = $1 and user_id = $2 and revoked_at is null", [input.websiteId, input.userId]);
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows } = await db.query<{ id: string }>(
    "insert into website_publishers (website_id, client_id, user_id, granted_by) values ($1, $2, $3, $4) returning id",
    [input.websiteId, site.client_id, input.userId, actorUserId],
  );
  await recordAudit(db, {
    actorType: "staff", actorUserId, action: "blog.publisher_granted", targetType: "website", targetId: input.websiteId,
    clientId: site.client_id, outcome: "success", metadata: { userId: input.userId },
  });
  return rows[0]!.id;
}

export async function revokeWebsitePublisher(db: Queryable, input: { websiteId: string; userId: string }, actorUserId: string): Promise<boolean> {
  const role = (await db.query<{ platform_role: string }>("select platform_role from staff_users where id = $1", [actorUserId])).rows[0]?.platform_role;
  if (role !== "admin") throw new PermissionDeniedError("Only an administrator can revoke website publishing.");
  const { rows } = await db.query<{ client_id: string }>(
    "update website_publishers set revoked_at = now(), revoked_by = $3 where website_id = $1 and user_id = $2 and revoked_at is null returning client_id",
    [input.websiteId, input.userId, actorUserId],
  );
  if (!rows[0]) return false;
  await recordAudit(db, {
    actorType: "staff", actorUserId, action: "blog.publisher_revoked", targetType: "website", targetId: input.websiteId,
    clientId: rows[0].client_id, outcome: "success", metadata: { userId: input.userId },
  });
  return true;
}
