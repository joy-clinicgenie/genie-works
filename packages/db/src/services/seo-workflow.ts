import type { Queryable } from "../client";
import { loadWebsiteConnections } from "../analytics/website-connections";
import { listAiAccessChecks } from "./ai-access";
import { listBranches } from "./business-profiles";
import { openIssue, transitionIssue, IssueRuleError } from "./issues";
import { listLatestInspections, listPageInventory, effectivePageSeo } from "./seo-pages";
import { createTask } from "./tasks";
import { readSitemapStatus, type FindingType } from "./technical-seo";

/* SEO-02.1 Setup Checklist, SEO-02.2 Issues, SEO-02.3 Recommendations, SEO-02.4 Completed Tasks (D65). */

export class SeoWorkRuleError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "SeoWorkRuleError";
    this.field = field;
  }
}

function sgtStart(date: string): Date {
  return new Date(`${date}T00:00:00+08:00`);
}

// ---------------------------------------------------------------------------------------------------------
// SEO-02.1 Setup checklist

export type SetupStepKey = "website_details" | "search_console" | "homepage_seo" | "sitemap" | "indexing";
export type ReviewStep = "website_details" | "homepage_seo" | "indexing";

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  rule: string;
  complete: boolean;
  evidenceAt: Date | null;
  evidence: string | null;
  href: string;
  review: boolean;
}

export interface SetupChecklist {
  steps: SetupStep[];
  done: number;
  total: number;
  next: SetupStep | null;
}

export async function recordSetupReview(db: Queryable, input: { clientId: string; websiteId: string; step: ReviewStep; note: string | null; actorUserId: string; now?: Date }): Promise<void> {
  if (!["website_details", "homepage_seo", "indexing"].includes(input.step)) throw new SeoWorkRuleError("That step is not a review step.");
  await db.query(
    "insert into seo_setup_reviews (client_id, website_id, step, note, reviewed_by, reviewed_at) values ($1, $2, $3, $4, $5, $6)",
    [input.clientId, input.websiteId, input.step, input.note?.trim().slice(0, 500) || null, input.actorUserId, (input.now ?? new Date()).toISOString()],
  );
}

/** Five steps, each with its own evidence rule and destination, for one website and environment. */
export async function setupChecklist(db: Queryable, site: { id: string; clientId: string }): Promise<SetupChecklist> {
  const q = (path: string, extra: Record<string, string> = {}) => `${path}?${new URLSearchParams({ website: site.id, ...extra })}`;
  const reviews = (await db.query<{ step: ReviewStep; reviewed_at: Date; note: string | null; name: string | null }>(
    `select distinct on (r.step) r.step, r.reviewed_at, r.note, u.display_name as name
     from seo_setup_reviews r left join staff_users u on u.id = r.reviewed_by
     where r.website_id = $1 order by r.step, r.reviewed_at desc`,
    [site.id],
  )).rows;
  const review = (step: ReviewStep) => reviews.find((row) => row.step === step);
  const connections = await loadWebsiteConnections(db, site.id);
  const search = connections?.cards.search;
  const searchOk = Boolean(search && search.state === "connected" && search.verifiedAt
    && !(search.lastCheck && search.lastCheck.at > search.verifiedAt && ["ownership_required", "no_property_access", "provider_rejected"].includes(search.lastCheck.outcome)));
  const sitemap = await readSitemapStatus(db, site.id);
  const home = (await listPageInventory(db, site.id)).find((page) => page.key === "/");
  const reviewStep = (key: ReviewStep, title: string, rule: string, href: string): SetupStep => {
    const row = review(key);
    return { key, title, rule, complete: Boolean(row), evidenceAt: row?.reviewed_at ?? null, evidence: row ? `Reviewed by ${row.name ?? "a staff member"}${row.note ? `: ${row.note}` : ""}` : null, href, review: true };
  };
  const steps: SetupStep[] = [
    reviewStep("website_details", "Website details", "A staff member reviews the website record: name, public address, platform and environment.", q("/seo/settings", { tab: "defaults" })),
    {
      key: "search_console",
      title: "Search Console connection",
      rule: "The mapped Search Console property is connected with verified access.",
      complete: searchOk,
      evidenceAt: searchOk ? search!.verifiedAt : null,
      evidence: searchOk ? `Access verified for ${search!.property}` : null,
      href: q("/seo/settings", { tab: "connections" }),
      review: false,
    },
    reviewStep("homepage_seo", "Homepage SEO review", "A staff member reviews the home page title, description and indexing preference.", home ? q(`/seo/pages/${home.id}`) : q("/seo/pages", { tab: "pages" })),
    {
      key: "sitemap",
      title: "Sitemap validation",
      rule: "The live sitemap was read in full by a sitemap check.",
      complete: Boolean(sitemap.latestPass),
      evidenceAt: sitemap.latestPass?.checkedAt ?? null,
      evidence: sitemap.latestPass ? `${sitemap.latestPass.urlCount} URL(s) in ${sitemap.latestPass.sitemapUrl}` : null,
      href: q("/seo/site-health", { tab: "crawl" }),
      review: false,
    },
    reviewStep("indexing", "Indexing review", "A staff member reviews Google's reported indexing for the home page and key pages.", home ? q(`/seo/pages/${home.id}/inspection`) : q("/seo/site-health", { tab: "indexing" })),
  ];
  const done = steps.filter((step) => step.complete).length;
  return { steps, done, total: steps.length, next: steps.find((step) => !step.complete) ?? null };
}

// ---------------------------------------------------------------------------------------------------------
// SEO-02.2 Issues from website-check findings

const FINDING_TITLES: Record<FindingType, string> = { http_error: "Page returns an error", missing_title: "Missing title", missing_description: "Missing meta description" };
export const UNRESOLVED_ISSUE_STATUSES = ["open", "investigating", "resolved_pending_verification", "reopened"] as const;

/**
 * Links every finding seen in a run to one issue per website, page and check type (D65). A new defect opens an
 * issue; a defect seen again on an issue that was verified closed or ready to verify reopens it.
 * Runs in the website-check run's transaction (service context), acting as the staff member who started it.
 */
export async function linkFindingIssues(db: Queryable, input: { clientId: string; websiteId: string; runId: string; actorUserId: string }): Promise<{ opened: number; reopened: number }> {
  const seen = (await db.query<{ id: string; page_path: string; check_type: FindingType; detail: string | null; issue_id: string | null }>(
    "select id, page_path, check_type, detail, issue_id from seo_site_findings where website_id = $1 and status = 'open' and last_seen_run = $2",
    [input.websiteId, input.runId],
  )).rows;
  let opened = 0;
  let reopened = 0;
  for (const finding of seen) {
    let issueId = finding.issue_id;
    if (!issueId) {
      issueId = (await db.query<{ issue_id: string }>(
        `select issue_id from seo_site_findings where website_id = $1 and page_path = $2 and check_type = $3 and issue_id is not null
         order by first_seen_at desc limit 1`,
        [input.websiteId, finding.page_path, finding.check_type],
      )).rows[0]?.issue_id ?? null;
      if (!issueId) {
        issueId = await openIssue(db, input.clientId, {
          title: `${FINDING_TITLES[finding.check_type]} · ${finding.page_path}`.slice(0, 200),
          description: `Found by a website check${finding.detail ? `: ${finding.detail}` : ""}.`,
          severity: finding.check_type === "http_error" ? "high" : "medium",
          ownerUserId: input.actorUserId,
          relatedType: "seo_finding",
          relatedId: finding.id,
        }, input.actorUserId);
        opened += 1;
      }
      await db.query("update seo_site_findings set issue_id = $2 where id = $1", [finding.id, issueId]);
    }
    const issue = (await db.query<{ status: string }>("select status from issues where id = $1", [issueId])).rows[0];
    if (issue?.status === "verified_closed" || issue?.status === "resolved_pending_verification") {
      await transitionIssue(db, issueId, {
        status: "reopened",
        note: `A website check found the defect again on ${finding.page_path}.`,
        verificationResult: issue.status === "resolved_pending_verification" ? "failed" : null,
      }, input.actorUserId);
      reopened += 1;
    }
  }
  return { opened, reopened };
}

export interface SeoIssue {
  id: string;
  title: string;
  status: string;
  severity: string;
  pagePath: string;
  checkType: FindingType;
  source: "Website check";
  firstSeenAt: Date;
  lastSeenAt: Date;
  ownerName: string | null;
  resolvedAt: Date | null;
  verifiedAt: Date | null;
  reopenCount: number;
  /** A later website check that completed the page without the finding, after the issue was marked ready. */
  recheckEvidence: { at: Date } | null;
}

/** SEO issues of one website: issues linked to its website-check findings. */
export async function listSeoIssues(db: Queryable, websiteId: string): Promise<SeoIssue[]> {
  const { rows } = await db.query<{
    id: string; title: string; status: string; severity: string; page_path: string; check_type: FindingType; first_seen_at: Date; last_seen_at: Date;
    owner_name: string | null; resolved_at: Date | null; verified_at: Date | null; reopen_count: number; recheck_at: Date | null;
  }>(
    `select i.id, i.title, i.status, i.severity, f.page_path, f.check_type, f.first_seen_at, f.last_seen_at, u.display_name as owner_name,
            i.resolved_at, i.verified_at, i.reopen_count,
            (select max(g.resolved_at) from seo_site_findings g
              where g.issue_id = i.id and g.status = 'resolved' and i.resolved_at is not null and g.resolved_at > i.resolved_at) as recheck_at
     from issues i
     join lateral (
       select page_path, check_type, min(first_seen_at) as first_seen_at, max(last_seen_at) as last_seen_at
       from seo_site_findings where issue_id = i.id and website_id = $1 group by page_path, check_type
     ) f on true
     left join staff_users u on u.id = i.owner_user_id
     order by case i.status when 'verified_closed' then 1 else 0 end, f.last_seen_at desc`,
    [websiteId],
  );
  return rows.map((row) => ({
    id: row.id, title: row.title, status: row.status, severity: row.severity, pagePath: row.page_path, checkType: row.check_type, source: "Website check",
    firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, ownerName: row.owner_name, resolvedAt: row.resolved_at, verifiedAt: row.verified_at,
    reopenCount: row.reopen_count, recheckEvidence: row.recheck_at ? { at: row.recheck_at } : null,
  }));
}

async function websiteIssue(db: Queryable, websiteId: string, issueId: string): Promise<SeoIssue> {
  const issue = (await listSeoIssues(db, websiteId)).find((row) => row.id === issueId);
  if (!issue) throw new SeoWorkRuleError("That issue is not part of this website.");
  return issue;
}

/** Start work, or mark ready to verify with what was changed. */
export async function moveSeoIssue(db: Queryable, input: { websiteId: string; issueId: string; to: "investigating" | "resolved_pending_verification"; note: string | null; actorUserId: string }): Promise<void> {
  await websiteIssue(db, input.websiteId, input.issueId);
  await transitionIssue(db, input.issueId, { status: input.to, note: input.note }, input.actorUserId);
}

/** Verifies a fix with evidence: a later website check without the finding, or a staff verification note. */
export async function verifySeoIssue(db: Queryable, input: { websiteId: string; issueId: string; evidence: "recheck" | "recorded"; note: string | null; actorUserId: string }): Promise<void> {
  const issue = await websiteIssue(db, input.websiteId, input.issueId);
  if (issue.status !== "resolved_pending_verification") throw new SeoWorkRuleError("Only an issue that is ready to verify can be verified.");
  let note: string;
  if (input.evidence === "recheck") {
    if (!issue.recheckEvidence) throw new SeoWorkRuleError("No website check has completed this page without the finding since it was marked ready. Run a website check or record a verification.");
    note = `Recheck evidence: a website check on ${issue.recheckEvidence.at.toISOString()} completed ${issue.pagePath} without the finding.`;
  } else {
    const text = input.note?.trim();
    if (!text) throw new SeoWorkRuleError("Record what you checked and what you saw.", "note");
    note = `Recorded verification: ${text}`;
  }
  try {
    await transitionIssue(db, input.issueId, { status: "verified_closed", note, verificationResult: "passed" }, input.actorUserId);
  } catch (error) {
    if (error instanceof IssueRuleError) throw new SeoWorkRuleError(error.message);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------
// SEO-02.3 Recommendations

export type RecommendationKind = "missing_description" | "google_excluded" | "sitemap_incomplete" | "llms_missing" | "branch_unmapped";

interface Suggestion {
  key: string;
  kind: RecommendationKind;
  title: string;
  affected: string;
  affectedHref: string | null;
  evidence: string;
  proposedAction: string;
}

/** Rule-based suggestions from stored evidence. Each key is stable, so a decision is never asked again. */
export async function suggestRecommendations(db: Queryable, site: { id: string; clientId: string }): Promise<Suggestion[]> {
  const q = (path: string, extra: Record<string, string> = {}) => `${path}?${new URLSearchParams({ website: site.id, ...extra })}`;
  const out: Suggestion[] = [];
  const pages = await listPageInventory(db, site.id);
  const google = await listLatestInspections(db, site.id);
  const live = (await db.query<{ page_path: string; observed_description: string | null; safe_error_code: string | null; checked_at: Date }>(
    `select distinct on (page_path) page_path, observed_description, safe_error_code, checked_at
     from seo_page_live_checks where website_id = $1 order by page_path, checked_at desc`,
    [site.id],
  )).rows;
  for (const page of pages) {
    const check = live.find((row) => row.page_path === page.path);
    if (check && !check.safe_error_code && !check.observed_description && effectivePageSeo(page).description.source === "website_default") {
      out.push({
        key: `missing_description:${page.key}`, kind: "missing_description", title: `Add a meta description to ${page.path}`, affected: page.path,
        affectedHref: q(`/seo/pages/${page.id}`), evidence: `The live page served no meta description when checked on ${check.checked_at.toISOString().slice(0, 10)}.`,
        proposedAction: "Write a page-level meta description and save it as an override.",
      });
    }
    const result = google.get(page.path);
    if (result && (result.verdict === "NEUTRAL" || result.verdict === "FAIL")) {
      out.push({
        key: `google_excluded:${page.key}`, kind: "google_excluded", title: `Review why Google does not index ${page.path}`, affected: page.path,
        affectedHref: q(`/seo/pages/${page.id}/inspection`), evidence: `URL Inspection on ${result.checkedAt.toISOString().slice(0, 10)}: ${result.coverage ?? result.verdict}.`,
        proposedAction: "Check the coverage reason and fix the page or its indexing preference.",
      });
    }
  }
  const sitemap = await readSitemapStatus(db, site.id);
  if (sitemap.newerAttempt) {
    out.push({
      key: `sitemap_incomplete:${sitemap.newerAttempt.sitemapUrl}`, kind: "sitemap_incomplete", title: "Fix the sitemap so every file can be read", affected: sitemap.newerAttempt.sitemapUrl,
      affectedHref: q("/seo/site-health", { tab: "crawl" }), evidence: `The sitemap check on ${sitemap.newerAttempt.checkedAt.toISOString().slice(0, 10)} was ${sitemap.newerAttempt.result}.`,
      proposedAction: "Correct the unreadable sitemap files on the website, then check the sitemap again.",
    });
  }
  const access = (await listAiAccessChecks(db, site.id, 1))[0];
  if (access && access.llmsStatus === "missing") {
    out.push({
      key: "llms_missing", kind: "llms_missing", title: "Publish an llms.txt guide", affected: `${access.origin}/llms.txt`,
      affectedHref: q("/seo/ai-visibility", { tab: "access" }), evidence: `The AI access check on ${access.checkedAt.toISOString().slice(0, 10)} found no llms.txt (HTTP ${access.llmsHttp ?? "no response"}).`,
      proposedAction: "Publish an llms.txt on the website that links its key pages.",
    });
  }
  for (const branch of await listBranches(db, site.clientId)) {
    if (branch.mapping === "unmapped") {
      out.push({
        key: `branch_unmapped:${branch.id}`, kind: "branch_unmapped", title: `Map ${branch.branch_name} to its Google listing`, affected: branch.branch_name,
        affectedHref: q(`/seo/business-profile/${branch.id}`), evidence: "The branch has no Google location ID or public listing link.",
        proposedAction: "Add the public listing link or Google location ID to the branch.",
      });
    }
  }
  return out;
}

/** Stores suggestions not seen before. Existing rows keep their state and decision. */
export async function refreshRecommendations(db: Queryable, site: { id: string; clientId: string }): Promise<number> {
  let added = 0;
  for (const s of await suggestRecommendations(db, site)) {
    const result = await db.query(
      `insert into seo_recommendations (client_id, website_id, rec_key, kind, title, affected, affected_href, evidence, proposed_action)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (website_id, rec_key) do nothing`,
      [site.clientId, site.id, s.key.slice(0, 300), s.kind, s.title.slice(0, 200), s.affected.slice(0, 300), s.affectedHref, s.evidence.slice(0, 500), s.proposedAction],
    );
    added += result.rowCount ?? 0;
  }
  return added;
}

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  title: string;
  affected: string;
  affectedHref: string | null;
  evidence: string;
  proposedAction: string;
  status: "new" | "task_created" | "dismissed";
  taskId: string | null;
  taskStatus: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  dismissReason: string | null;
  createdAt: Date;
}

export async function listRecommendations(db: Queryable, websiteId: string): Promise<Recommendation[]> {
  const { rows } = await db.query<{ id: string; kind: RecommendationKind; title: string; affected: string; affected_href: string | null; evidence: string; proposed_action: string; status: Recommendation["status"]; task_id: string | null; task_status: string | null; decided_by_name: string | null; decided_at: Date | null; dismiss_reason: string | null; created_at: Date }>(
    `select r.id, r.kind, r.title, r.affected, r.affected_href, r.evidence, r.proposed_action, r.status, r.task_id, t.status as task_status,
            u.display_name as decided_by_name, r.decided_at, r.dismiss_reason, r.created_at
     from seo_recommendations r left join tasks t on t.id = r.task_id left join staff_users u on u.id = r.decided_by
     where r.website_id = $1 order by case r.status when 'new' then 0 else 1 end, r.created_at desc`,
    [websiteId],
  );
  return rows.map((row) => ({
    id: row.id, kind: row.kind, title: row.title, affected: row.affected, affectedHref: row.affected_href, evidence: row.evidence, proposedAction: row.proposed_action,
    status: row.status, taskId: row.task_id, taskStatus: row.task_status, decidedByName: row.decided_by_name, decidedAt: row.decided_at, dismissReason: row.dismiss_reason, createdAt: row.created_at,
  }));
}

/**
 * Accepts a suggestion and links one task. The row is locked first, so a repeated or concurrent accept returns
 * the task the first accept created.
 */
export async function acceptRecommendation(db: Queryable, input: { websiteId: string; recommendationId: string; ownerUserId: string; actorUserId: string }): Promise<{ taskId: string; created: boolean }> {
  const row = (await db.query<{ id: string; client_id: string; status: Recommendation["status"]; task_id: string | null; title: string; proposed_action: string; evidence: string }>(
    "select id, client_id, status, task_id, title, proposed_action, evidence from seo_recommendations where id = $1 and website_id = $2 for update",
    [input.recommendationId, input.websiteId],
  )).rows[0];
  if (!row) throw new SeoWorkRuleError("That recommendation is not part of this website.");
  if (row.status === "task_created" && row.task_id) return { taskId: row.task_id, created: false };
  if (row.status === "dismissed") throw new SeoWorkRuleError("This recommendation was dismissed.");
  const taskId = await createTask(db, {
    clientId: row.client_id,
    title: row.title,
    description: `${row.proposed_action}\n\nEvidence: ${row.evidence}`,
    ownerUserId: input.ownerUserId,
    priority: "medium",
    dueDate: null,
    relatedType: "seo_recommendation",
    relatedId: row.id,
  }, input.actorUserId);
  await db.query(
    "update seo_recommendations set status = 'task_created', task_id = $2, decided_by = $3, decided_at = now() where id = $1",
    [row.id, taskId, input.actorUserId],
  );
  return { taskId, created: true };
}

export async function dismissRecommendation(db: Queryable, input: { websiteId: string; recommendationId: string; reason: string | null; actorUserId: string }): Promise<void> {
  const { rowCount } = await db.query(
    `update seo_recommendations set status = 'dismissed', decided_by = $3, decided_at = now(), dismiss_reason = $4
     where id = $1 and website_id = $2 and status = 'new'`,
    [input.recommendationId, input.websiteId, input.actorUserId, input.reason?.trim().slice(0, 300) || null],
  );
  if (!rowCount) throw new SeoWorkRuleError("Only a new recommendation can be dismissed.");
}

// ---------------------------------------------------------------------------------------------------------
// SEO-02.4 Completed tasks

export interface CompletedTask {
  id: string;
  title: string;
  status: string;
  completedAt: Date;
  ownerName: string | null;
  linkedType: string;
  linkedLabel: string;
  linkedHref: string;
}

const COMPLETED_SQL = `
  select t.id, t.title, t.status, t.completed_at, u.display_name as owner_name, t.related_type,
         coalesce(p.page_path, f.page_path, r.title) as linked_label,
         coalesce(p.website_id, f.website_id, r.website_id) as website_id
  from tasks t
  left join staff_users u on u.id = t.owner_user_id
  left join seo_pages p on t.related_type = 'seo_page' and p.id = t.related_id
  left join seo_site_findings f on t.related_type = 'seo_finding' and f.id = t.related_id
  left join seo_recommendations r on t.related_type = 'seo_recommendation' and r.id = t.related_id
  where t.status = 'completed' and t.completed_at >= $2 and t.completed_at < $3
    and coalesce(p.website_id, f.website_id, r.website_id) = $1`;

/** Tasks completed in the window for the selected website, newest first. A reopened task has no completion time. */
export async function listCompletedTasks(db: Queryable, input: { websiteId: string; start: string; end: string }): Promise<CompletedTask[]> {
  const { rows } = await db.query<{ id: string; title: string; status: string; completed_at: Date; owner_name: string | null; related_type: string; linked_label: string; website_id: string }>(
    `${COMPLETED_SQL} order by t.completed_at desc limit 200`,
    [input.websiteId, sgtStart(input.start).toISOString(), new Date(sgtStart(input.end).getTime() + 86_400_000).toISOString()],
  );
  return rows.map((row) => ({
    id: row.id, title: row.title, status: row.status, completedAt: row.completed_at, ownerName: row.owner_name, linkedType: row.related_type, linkedLabel: row.linked_label,
    linkedHref: row.related_type === "seo_recommendation" ? `/seo/tasks?tab=recommendations&website=${row.website_id}` : `/tasks/${row.id}`,
  }));
}

export interface SeoWorkCounts {
  setupDone: number;
  setupTotal: number;
  unresolvedIssues: number;
  newRecommendations: number;
  completedTasks: number;
}

/** The one source of checklist and task counts for the SEO Overview. */
export async function seoWorkCounts(db: Queryable, input: { websiteId: string; clientId: string; start: string; end: string }): Promise<SeoWorkCounts> {
  const checklist = await setupChecklist(db, { id: input.websiteId, clientId: input.clientId });
  const issues = await listSeoIssues(db, input.websiteId);
  const recommendations = await db.query<{ n: number }>("select count(*)::int as n from seo_recommendations where website_id = $1 and status = 'new'", [input.websiteId]);
  const completed = await db.query<{ n: number }>(
    `select count(*)::int as n from (${COMPLETED_SQL}) done`,
    [input.websiteId, sgtStart(input.start).toISOString(), new Date(sgtStart(input.end).getTime() + 86_400_000).toISOString()],
  );
  return {
    setupDone: checklist.done,
    setupTotal: checklist.total,
    unresolvedIssues: issues.filter((issue) => (UNRESOLVED_ISSUE_STATUSES as readonly string[]).includes(issue.status)).length,
    newRecommendations: recommendations.rows[0]?.n ?? 0,
    completedTasks: completed.rows[0]?.n ?? 0,
  };
}
