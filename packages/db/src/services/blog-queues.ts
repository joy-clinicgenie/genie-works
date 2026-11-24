/**
 * D87. One SQL definition per Blog queue and per website publication status, used by the Overview
 * counts, the filtered Posts list and the article status labels, so they can never disagree.
 * Every fragment refers to the article as `a`.
 */

export const BLOG_QUEUES = ["changes_requested", "awaiting_review", "ready_to_publish", "publishing_issues"] as const;
export type BlogQueue = (typeof BLOG_QUEUES)[number];

export const BLOG_QUEUE_LABEL: Record<BlogQueue, string> = {
  changes_requested: "Changes requested",
  awaiting_review: "Awaiting review",
  ready_to_publish: "Ready to publish",
  publishing_issues: "Publishing issues",
};

export function isBlogQueue(value: string | null | undefined): value is BlogQueue {
  return BLOG_QUEUES.some((queue) => queue === value);
}

/** The latest review decision on any revision of the article. */
export const LATEST_DECISION_SQL = `(
  select ap.decision from blog_approvals ap
  where ap.article_id = a.id
  order by ap.decided_at desc, ap.ctid desc
  limit 1
)`;

/** The delivery of the released revision to the article's own website. */
const RELEASED_DELIVERY = `
  from blog_deliveries d
  where d.website_id = a.website_id and d.article_id = a.id and d.version_id = a.live_version_id`;

/**
 * not_published | verified | delivery_pending | delivery_failed | awaiting_verification | unverified.
 * "unverified" is a release with no delivery (internal publication before D87): never inferred as verified.
 */
export const WEBSITE_STATUS_SQL = `(case
  when a.live_version_id is null then 'not_published'
  when exists (
    select 1 from blog_verified_revisions r
    where r.article_id = a.id and r.website_id = a.website_id and r.version_id = a.live_version_id
  ) then 'verified'
  else coalesce((select d.state ${RELEASED_DELIVERY}), 'unverified')
end)`;

export const QUEUE_SQL: Record<BlogQueue, string> = {
  // Returned by the reviewer and not yet resubmitted.
  changes_requested: `((a.status = 'draft' or (a.status = 'published' and a.working_status = 'draft')) and ${LATEST_DECISION_SQL} = 'returned')`,
  awaiting_review: `(a.status = 'in_review' or a.working_status = 'in_review')`,
  // The current revision is approved and not yet released.
  ready_to_publish: `(a.status = 'approved' or a.working_status = 'approved')`,
  // The released revision's delivery failed, or its verification failed and is waiting for a retry.
  publishing_issues: `(a.live_version_id is not null and exists (
    select 1 ${RELEASED_DELIVERY}
      and (d.state = 'delivery_failed' or (d.state = 'awaiting_verification' and d.failure_code is not null))
  ) and not exists (
    select 1 from blog_verified_revisions r
    where r.article_id = a.id and r.website_id = a.website_id and r.version_id = a.live_version_id
  ))`,
};
