import type { Queryable } from "../client";
import { addDays } from "./dates";
import { compareLive, listPageInventory, routeKey, type LiveCheckRow } from "./seo-pages";
import { setupChecklist, seoWorkCounts, type SeoWorkCounts, type SetupStep } from "./seo-workflow";

/* SEO Overview (SEO-01.2 and SEO-01.6, D67). The Google and AI cards read the Part 7 loaders directly. */

// ---------------------------------------------------------------------------------------------------------
// SEO-01.2 Checklist & Health

export interface ChecklistHealth {
  counts: SeoWorkCounts;
  /** Whole percent of completed applicable setup steps, or null when no step applies. */
  setupPercent: number | null;
  next: SetupStep | null;
  /** The window the completed-task count uses: the Checklist & Tasks default of 30 Asia/Singapore days. */
  completedWindow: { start: string; end: string; days: number };
  lastCheck: { finishedAt: Date; completed: number; failed: number; skipped: number } | null;
  /**
   * The newest time any figure on the panel could have changed: setup evidence, a website check, an issue, a
   * recommendation or a completed task of this website. Null when none of them has a recorded time.
   */
  lastUpdated: Date | null;
}

export async function loadChecklistHealth(db: Queryable, input: { websiteId: string; clientId: string; today: string }): Promise<ChecklistHealth> {
  const completedWindow = { start: addDays(input.today, -29), end: input.today, days: 30 };
  const counts = await seoWorkCounts(db, { websiteId: input.websiteId, clientId: input.clientId, start: completedWindow.start, end: completedWindow.end });
  const checklist = await setupChecklist(db, { id: input.websiteId, clientId: input.clientId });
  const run = (await db.query<{ finished_at: Date; completed: number; failed: number; skipped: number }>(
    "select finished_at, completed, failed, skipped from seo_site_check_runs where website_id = $1 and status = 'completed' and finished_at is not null order by finished_at desc limit 1",
    [input.websiteId],
  )).rows[0];
  const activity = (await db.query<{ at: Date | null }>(
    `select greatest(
       (select max(greatest(created_at, coalesce(decided_at, created_at))) from seo_recommendations where website_id = $1),
       (select max(i.updated_at) from issues i
         where i.related_type = 'seo_finding' and exists (select 1 from seo_site_findings f where f.issue_id = i.id and f.website_id = $1)),
       (select max(t.completed_at) from tasks t
         left join seo_pages p on t.related_type = 'seo_page' and p.id = t.related_id
         left join seo_site_findings f on t.related_type = 'seo_finding' and f.id = t.related_id
         left join seo_recommendations r on t.related_type = 'seo_recommendation' and r.id = t.related_id
         where t.status = 'completed' and coalesce(p.website_id, f.website_id, r.website_id) = $1)
     ) as at`,
    [input.websiteId],
  )).rows[0]?.at ?? null;
  const times = [activity, run?.finished_at ?? null, ...checklist.steps.map((step) => step.evidenceAt)]
    .filter((at): at is Date => at instanceof Date);
  return {
    counts,
    setupPercent: counts.setupTotal > 0 ? Math.round((counts.setupDone / counts.setupTotal) * 100) : null,
    next: checklist.next,
    completedWindow,
    lastCheck: run ? { finishedAt: run.finished_at, completed: run.completed, failed: run.failed, skipped: run.skipped } : null,
    lastUpdated: times.length ? new Date(Math.max(...times.map((at) => at.getTime()))) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// SEO-01.6 Recent changes

export type PublishedEvidence =
  | { state: "published"; at: Date }
  | { state: "waiting"; lastFetch: Date | null }
  | { state: "no_credential" }
  | { state: "superseded"; at: Date }
  | { state: "not_applicable" };

export type LiveEvidence =
  | { state: "pending" }
  | { state: "checked"; at: Date; result: "matches" | "differs" | "failed" | "observed" | "staff_verified" }
  | { state: "superseded"; at: Date }
  | { state: "not_applicable" };

export interface RecentChange {
  id: string;
  kind: "page_settings" | "content_change";
  pagePath: string;
  summary: string;
  actor: string | null;
  saved: Date;
  published: PublishedEvidence;
  live: LiveEvidence;
  /** The page's settings or detail screen in the selected website, when the page is in the inventory. */
  pageId: string | null;
}

/** The page-settings summary used by the SEO Work report and Recent Changes. */
export function pageSettingsSummary(action: string, metadata: { title?: boolean; description?: boolean; indexable?: boolean | null } | null): string {
  if (action === "seo.page_settings.clear") return "Page SEO overrides cleared";
  const parts = [
    metadata?.title ? "title" : null,
    metadata?.description ? "description" : null,
    metadata?.indexable === false ? "set to noindex" : metadata?.indexable === true ? "set to index" : null,
  ].filter((item): item is string => Boolean(item));
  return `Page SEO settings saved${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

const SETTINGS_ACTIONS = ["seo.page_settings.publish", "seo.page_settings.clear"];

/**
 * The newest page edits of one website, newest first (ties broken by record ID, descending). Each page-settings
 * save carries its own evidence: published when the website fetched the settings API after the save and before
 * the next save of that page; live checked by the first live check of the page in the same interval. A later
 * save of the same page supersedes evidence that arrived after it.
 */
export async function loadRecentChanges(db: Queryable, websiteId: string, limit = 5): Promise<RecentChange[]> {
  const settings = (await db.query<{ id: string; at: Date; action: string; metadata: { pagePath?: string; title?: boolean; description?: boolean; indexable?: boolean | null } | null; actor: string | null }>(
    `select a.id::text, a.occurred_at as at, a.action, a.metadata, u.display_name as actor
     from audit_events a left join staff_users u on u.id = a.actor_user_id
     where a.target_type = 'website' and a.target_id = $1 and a.action = any($2::text[]) and a.outcome = 'success'
     order by a.occurred_at desc, a.id desc limit $3`,
    [websiteId, SETTINGS_ACTIONS, limit],
  )).rows;
  const content = (await db.query<{ id: string; at: Date; page_path: string; seo_page_id: string; change_type: string; reason: string; actor: string | null; verification_on: string | null }>(
    `select c.id::text, c.created_at as at, p.page_path, p.id as seo_page_id, c.change_type, c.reason, u.display_name as actor, c.verification_on
     from seo_changes c join seo_pages p on p.id = c.seo_page_id left join staff_users u on u.id = c.changed_by
     where p.website_id = $1 order by c.created_at desc, c.id desc limit $2`,
    [websiteId, limit],
  )).rows;
  type Row = { id: string; at: Date; source: "settings"; row: (typeof settings)[number] } | { id: string; at: Date; source: "content"; row: (typeof content)[number] };
  const merged: Row[] = [
    ...settings.map((row): Row => ({ id: row.id, at: row.at, source: "settings", row })),
    ...content.map((row): Row => ({ id: row.id, at: row.at, source: "content", row })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, limit);
  if (!merged.length) return [];

  const inventory = await listPageInventory(db, websiteId);
  const pageFor = (path: string) => inventory.find((page) => page.key === routeKey(path)) ?? null;
  const token = (await db.query("select 1 from seo_site_tokens where website_id = $1 and revoked_at is null limit 1", [websiteId])).rows.length > 0;
  const lastFetch = (await db.query<{ last_served_at: Date }>("select last_served_at from seo_settings_deliveries where website_id = $1", [websiteId])).rows[0]?.last_served_at ?? null;

  const out: RecentChange[] = [];
  for (const item of merged) {
    if (item.source === "content") {
      const row = item.row;
      out.push({
        id: row.id, kind: "content_change", pagePath: row.page_path, summary: `${row.change_type.replaceAll("_", " ")} change: ${row.reason}`, actor: row.actor, saved: row.at,
        published: { state: "not_applicable" },
        live: row.verification_on ? { state: "checked", at: new Date(`${row.verification_on}T00:00:00+08:00`), result: "staff_verified" } : { state: "pending" },
        pageId: pageFor(row.page_path)?.id ?? row.seo_page_id,
      });
      continue;
    }
    const row = item.row;
    const path = row.metadata?.pagePath ?? "/";
    // Compared in SQL against the stored row: timestamps keep microseconds there but not in JavaScript.
    const nextRow = (await db.query<{ id: string; at: Date }>(
      `select n.id::text, n.occurred_at as at from audit_events n, audit_events cur
       where cur.id = $4::uuid and n.target_type = 'website' and n.target_id = $1 and n.action = any($2::text[]) and n.outcome = 'success'
         and n.metadata->>'pagePath' = $3 and (n.occurred_at, n.id::text) > (cur.occurred_at, cur.id::text)
       order by n.occurred_at, n.id limit 1`,
      [websiteId, SETTINGS_ACTIONS, path, row.id],
    )).rows[0] ?? null;
    const next = nextRow?.at ?? null;
    const cleared = row.action === "seo.page_settings.clear";
    let published: PublishedEvidence;
    if (cleared) published = { state: "not_applicable" };
    else if (!token) published = { state: "no_credential" };
    else {
      const fetch = (await db.query<{ after_save: boolean; after_next: boolean }>(
        `select d.last_served_at >= (select occurred_at from audit_events where id = $2::uuid) as after_save,
                ($3::uuid is not null and d.last_served_at >= (select occurred_at from audit_events where id = $3::uuid)) as after_next
         from seo_settings_deliveries d where d.website_id = $1`,
        [websiteId, row.id, nextRow?.id ?? null],
      )).rows[0];
      if (lastFetch && fetch?.after_next && next) published = { state: "superseded", at: next };
      else if (lastFetch && fetch?.after_save) published = { state: "published", at: lastFetch };
      else published = { state: "waiting", lastFetch };
    }
    const check = (await db.query<{ checked_at: Date; http_status: number | null; observed_title: string | null; observed_description: string | null; observed_robots: string | null; safe_error_code: string | null }>(
      `select checked_at, http_status, observed_title, observed_description, observed_robots, safe_error_code
       from seo_page_live_checks
       where website_id = $1 and page_path = $2 and checked_at >= (select occurred_at from audit_events where id = $3::uuid)
         and ($4::uuid is null or checked_at < (select occurred_at from audit_events where id = $4::uuid))
       order by checked_at limit 1`,
      [websiteId, path, row.id, nextRow?.id ?? null],
    )).rows[0];
    let live: LiveEvidence;
    if (check) {
      const page = pageFor(path);
      const observed: LiveCheckRow = { checkedAt: check.checked_at, httpStatus: check.http_status, title: check.observed_title, description: check.observed_description, robots: check.observed_robots, errorCode: check.safe_error_code };
      // Only the page's current override can be compared; an older edit's values are not stored.
      const compared = !next && !cleared ? compareLive(page?.setting ?? null, observed) : null;
      const result = check.safe_error_code ? "failed" : compared && (compared.state === "matches" || compared.state === "differs") ? compared.state : "observed";
      live = { state: "checked", at: check.checked_at, result };
    } else if (next) {
      live = { state: "superseded", at: next };
    } else {
      live = { state: "pending" };
    }
    out.push({ id: row.id, kind: "page_settings", pagePath: path, summary: pageSettingsSummary(row.action, row.metadata), actor: row.actor, saved: row.at, published, live, pageId: pageFor(path)?.id ?? null });
  }
  return out;
}
