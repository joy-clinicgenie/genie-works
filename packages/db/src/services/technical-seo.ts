import type { Queryable } from "../client";
import { publicPageUrl } from "../analytics/providers/gsc";
import { AiAccessFetchError, parseRobots, type RobotsGroup, type TextFetcher, type TextFetchResult } from "./ai-access";
import { listPageInventory, parseLiveHead, routeKey } from "./seo-pages";
import { linkFindingIssues } from "./seo-workflow";

/* SEO-04.1 Sitemaps, SEO-04.2 robots.txt, SEO-04.3 Website Checks, SEO-04.4 Redirect Checks (D62). */

async function attempt(fetcher: TextFetcher, url: string): Promise<{ result: TextFetchResult | null; code: string | null }> {
  try {
    return { result: await fetcher(url), code: null };
  } catch (error) {
    return { result: null, code: error instanceof AiAccessFetchError ? error.code : "network" };
  }
}

function sameSiteHost(a: string, b: string): boolean {
  const strip = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return strip(a) === strip(b);
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

/** The website origin from its registry address, or null when it is missing or not http(s). */
export function siteOrigin(websiteUrl: string | null): string | null {
  if (!websiteUrl) return null;
  try {
    const url = new URL(websiteUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// SEO-04.2 robots.txt

export interface RobotsFileGroup extends RobotsGroup {
  /** Disallow rules that block the whole site for these agents. */
  broad: string[];
}

export interface RobotsFile {
  groups: RobotsFileGroup[];
  sitemaps: string[];
}

/** User-agent groups, broad restrictions and sitemap lines (RFC 9309; Sitemap lines belong to no group). */
export function parseRobotsFile(text: string): RobotsFile {
  const groups = parseRobots(text).map((group) => ({
    ...group,
    broad: group.rules.filter((rule) => !rule.allow && (rule.path === "/" || rule.path === "/*")).map((rule) => rule.path),
  }));
  const sitemaps: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(raw.replace(/#.*$/, ""));
    if (match && /^https?:\/\//i.test(match[1]!)) sitemaps.push(match[1]!);
  }
  return { groups, sitemaps };
}

export type RobotsAvailability = "available" | "not_found" | "unavailable";

export interface RobotsReading {
  robotsUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  availability: RobotsAvailability;
  body: string | null;
  truncated: boolean;
  errorCode: string | null;
}

/**
 * Reads /robots.txt. 2xx is available; 4xx other than 429 means no file and no crawl restrictions; 429, 5xx and
 * any failed request are Unavailable. The caller's fetcher follows up to five redirects and reads 500 KiB.
 */
export async function readRobotsFile(fetcher: TextFetcher, origin: string): Promise<RobotsReading> {
  const robotsUrl = `${origin}/robots.txt`;
  const { result, code } = await attempt(fetcher, robotsUrl);
  if (!result) {
    // Too many redirects is treated like a missing file, as Google does.
    const availability: RobotsAvailability = code === "too_many_redirects" ? "not_found" : "unavailable";
    return { robotsUrl, finalUrl: null, httpStatus: null, availability, body: null, truncated: false, errorCode: code };
  }
  const base = { robotsUrl, finalUrl: result.finalUrl ?? robotsUrl, httpStatus: result.status, truncated: Boolean(result.truncated) };
  if (result.status >= 200 && result.status < 300) return { ...base, availability: "available", body: result.body, errorCode: null };
  if (result.status >= 400 && result.status < 500 && result.status !== 429) return { ...base, availability: "not_found", body: null, errorCode: `http_${result.status}` };
  return { ...base, availability: "unavailable", body: null, errorCode: `http_${result.status}` };
}

export async function recordRobotsCheck(db: Queryable, input: { clientId: string; websiteId: string; reading: RobotsReading; actorUserId: string; now?: Date }): Promise<void> {
  const r = input.reading;
  await db.query(
    `insert into seo_robots_checks (client_id, website_id, robots_url, final_url, http_status, availability, body, truncated, safe_error_code, checked_by, checked_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [input.clientId, input.websiteId, r.robotsUrl, r.finalUrl, r.httpStatus, r.availability, r.body, r.truncated, r.errorCode, input.actorUserId, (input.now ?? new Date()).toISOString()],
  );
}

export interface RobotsCheckRow extends RobotsReading {
  checkedAt: Date;
  parsed: RobotsFile | null;
}

export async function readLatestRobots(db: Queryable, websiteId: string): Promise<RobotsCheckRow | null> {
  const { rows } = await db.query<{ robots_url: string; final_url: string | null; http_status: number | null; availability: RobotsAvailability; body: string | null; truncated: boolean; safe_error_code: string | null; checked_at: Date }>(
    `select robots_url, final_url, http_status, availability, body, truncated, safe_error_code, checked_at
     from seo_robots_checks where website_id = $1 order by checked_at desc limit 1`,
    [websiteId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    robotsUrl: row.robots_url,
    finalUrl: row.final_url,
    httpStatus: row.http_status,
    availability: row.availability,
    body: row.body,
    truncated: row.truncated,
    errorCode: row.safe_error_code,
    checkedAt: row.checked_at,
    parsed: row.availability === "available" && row.body !== null ? parseRobotsFile(row.body) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// SEO-04.1 Sitemaps

export const SITEMAP_MAX_ENTRIES = 50_000;
export const SITEMAP_MAX_CHILDREN = 50;

export interface SitemapParse {
  kind: "urlset" | "sitemapindex" | null;
  locs: string[];
  error: string | null;
}

/** A URL list (urlset) or sitemap index (sitemapindex), per sitemaps.org. */
export function parseSitemapXml(body: string): SitemapParse {
  const text = body.replace(/^﻿/, "").replace(/<!--[\s\S]*?-->/g, "");
  const first = /<\s*(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b[^>]*>/.exec(text.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[^>]*>/gi, ""));
  const root = first?.[1];
  if (root !== "urlset" && root !== "sitemapindex") return { kind: null, locs: [], error: "not_sitemap" };
  if (!new RegExp(`<\\/\\s*(?:[A-Za-z_][\\w.-]*:)?${root}\\s*>`).test(text)) return { kind: root, locs: [], error: "invalid_xml" };
  const entry = root === "urlset" ? "url" : "sitemap";
  const blocks = [...text.matchAll(new RegExp(`<\\s*(?:[A-Za-z_][\\w.-]*:)?${entry}\\b[^>]*>([\\s\\S]*?)<\\/\\s*(?:[A-Za-z_][\\w.-]*:)?${entry}\\s*>`, "g"))];
  if (blocks.length > SITEMAP_MAX_ENTRIES) return { kind: root, locs: [], error: "too_many_entries" };
  const locs: string[] = [];
  for (const block of blocks) {
    const loc = /<\s*(?:[A-Za-z_][\w.-]*:)?loc\s*>([\s\S]*?)<\/\s*(?:[A-Za-z_][\w.-]*:)?loc\s*>/.exec(block[1]!);
    if (!loc) return { kind: root, locs: [], error: "missing_loc" };
    locs.push(decodeXml(loc[1]!.trim()));
  }
  return { kind: root, locs, error: null };
}

/** sitemaps.org: an absolute URL with the same protocol and host as the sitemap file. */
export function locProblem(loc: string, fileUrl: string): string | null {
  let url: URL;
  let file: URL;
  try {
    url = new URL(loc);
    file = new URL(fileUrl);
  } catch {
    return "relative_loc";
  }
  if (!/^https?:\/\//i.test(loc) || loc.length > 2048) return "relative_loc";
  if (url.protocol !== file.protocol || url.host.toLowerCase() !== file.host.toLowerCase()) return "other_host";
  return null;
}

export interface SitemapChild {
  url: string;
  result: "read" | "failed" | "skipped";
  reason: string | null;
  httpStatus: number | null;
  urlCount: number;
}

export interface SitemapReading {
  sitemapUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  kind: SitemapParse["kind"];
  urlCount: number;
  result: "passed" | "incomplete" | "failed";
  errorCode: string | null;
  children: SitemapChild[];
}

function isCompressed(url: string, contentType: string | null): boolean {
  return /\.gz($|\?)/i.test(url) || /gzip/i.test(contentType ?? "");
}

async function readUrlList(fetcher: TextFetcher, url: string): Promise<{ status: number | null; finalUrl: string | null; parse: SitemapParse | null; code: string | null }> {
  const { result, code } = await attempt(fetcher, url);
  if (!result) return { status: null, finalUrl: null, parse: null, code };
  const finalUrl = result.finalUrl ?? url;
  if (result.status >= 400) return { status: result.status, finalUrl, parse: null, code: `http_${result.status}` };
  if (result.truncated) return { status: result.status, finalUrl, parse: null, code: "too_large" };
  if (isCompressed(finalUrl, result.contentType)) return { status: result.status, finalUrl, parse: null, code: "compressed" };
  const parse = parseSitemapXml(result.body);
  if (parse.error) return { status: result.status, finalUrl, parse, code: parse.error };
  const problem = parse.locs.map((loc) => locProblem(loc, finalUrl)).find(Boolean);
  return { status: result.status, finalUrl, parse, code: problem ?? null };
}

/**
 * Reads the sitemap and, for an index, up to 50 referenced files four at a time. Only a check where every file
 * was read is a full pass; an unread, compressed, nested or out-of-limit child makes it Incomplete.
 */
export async function checkSitemap(fetcher: TextFetcher, sitemapUrl: string, opts: { maxChildren?: number } = {}): Promise<SitemapReading> {
  const top = await readUrlList(fetcher, sitemapUrl);
  const base = { sitemapUrl, finalUrl: top.finalUrl, httpStatus: top.status, kind: top.parse?.kind ?? null, children: [] as SitemapChild[] };
  if (top.code || !top.parse) return { ...base, urlCount: 0, result: "failed", errorCode: top.code ?? "not_sitemap" };
  if (top.parse.kind === "urlset") return { ...base, urlCount: top.parse.locs.length, result: "passed", errorCode: null };
  const limit = opts.maxChildren ?? SITEMAP_MAX_CHILDREN;
  const children: SitemapChild[] = top.parse.locs.map((url) => ({ url, result: "skipped", reason: "limit", httpStatus: null, urlCount: 0 }));
  const queue = children.slice(0, limit);
  const work = async (child: SitemapChild) => {
    if (isCompressed(child.url, null)) {
      child.reason = "compressed";
      return;
    }
    const read = await readUrlList(fetcher, child.url);
    child.httpStatus = read.status;
    if (read.parse?.kind === "sitemapindex" && !read.code) {
      child.reason = "nested_index";
      return;
    }
    if (read.code || !read.parse) {
      child.result = "failed";
      child.reason = read.code ?? "not_sitemap";
      return;
    }
    child.result = "read";
    child.reason = null;
    child.urlCount = read.parse.locs.length;
  };
  for (let i = 0; i < queue.length; i += 4) await Promise.all(queue.slice(i, i + 4).map(work));
  const complete = children.every((child) => child.result === "read");
  return {
    ...base,
    children,
    urlCount: children.reduce((sum, child) => sum + child.urlCount, 0),
    result: complete ? "passed" : "incomplete",
    errorCode: complete ? null : "children_unread",
  };
}

/** The sitemap to check: the first same-site Sitemap line of robots.txt, otherwise /sitemap.xml. */
export function sitemapTarget(origin: string, robots: RobotsFile | null): { url: string; source: "robots" | "default" } {
  const host = new URL(origin).hostname;
  const declared = robots?.sitemaps.find((value) => {
    try {
      return sameSiteHost(new URL(value).hostname, host);
    } catch {
      return false;
    }
  });
  return declared ? { url: declared, source: "robots" } : { url: `${origin}/sitemap.xml`, source: "default" };
}

export async function recordSitemapCheck(db: Queryable, input: { clientId: string; websiteId: string; source: "robots" | "default"; reading: SitemapReading; actorUserId: string; now?: Date }): Promise<void> {
  const r = input.reading;
  await db.query(
    `insert into seo_sitemap_checks (client_id, website_id, source, sitemap_url, final_url, http_status, kind, url_count, result, safe_error_code, children, checked_by, checked_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [input.clientId, input.websiteId, input.source, r.sitemapUrl, r.finalUrl, r.httpStatus, r.kind, r.urlCount, r.result, r.errorCode, JSON.stringify(r.children), input.actorUserId, (input.now ?? new Date()).toISOString()],
  );
}

export interface SitemapCheckRow extends SitemapReading {
  source: "robots" | "default";
  checkedAt: Date;
}

export interface SitemapStatus {
  latestPass: SitemapCheckRow | null;
  /** A newer attempt that was not a full pass, shown beside the pass. */
  newerAttempt: SitemapCheckRow | null;
}

export async function readSitemapStatus(db: Queryable, websiteId: string): Promise<SitemapStatus> {
  const { rows } = await db.query<{ source: "robots" | "default"; sitemap_url: string; final_url: string | null; http_status: number | null; kind: SitemapParse["kind"]; url_count: number; result: SitemapReading["result"]; safe_error_code: string | null; children: SitemapChild[]; checked_at: Date }>(
    `(select * from seo_sitemap_checks where website_id = $1 and result = 'passed' order by checked_at desc limit 1)
     union all
     (select * from seo_sitemap_checks where website_id = $1 and result <> 'passed' order by checked_at desc limit 1)`,
    [websiteId],
  );
  const toRow = (row: (typeof rows)[number]): SitemapCheckRow => ({
    source: row.source, sitemapUrl: row.sitemap_url, finalUrl: row.final_url, httpStatus: row.http_status, kind: row.kind,
    urlCount: row.url_count, result: row.result, errorCode: row.safe_error_code, children: row.children, checkedAt: row.checked_at,
  });
  const pass = rows.find((row) => row.result === "passed");
  const other = rows.find((row) => row.result !== "passed");
  const latestPass = pass ? toRow(pass) : null;
  return { latestPass, newerAttempt: other && (!pass || other.checked_at.getTime() > pass.checked_at.getTime()) ? toRow(other) : null };
}

// ---------------------------------------------------------------------------------------------------------
// SEO-04.3 Website Checks

export const SITE_CHECK_LIMIT = 50;
export const SITE_CHECK_BUDGET_MS = 60_000;
export type FindingType = "http_error" | "missing_title" | "missing_description";

export interface SiteCheckTarget {
  pagePath: string;
  url: string | null;
}

export interface PageCheckResult {
  pagePath: string;
  url: string | null;
  outcome: "completed" | "failed" | "skipped";
  reason: string | null;
  httpStatus: number | null;
  findings: Array<{ checkType: FindingType; detail: string | null }>;
}

/** The home page and known public pages of the selected website, from the D61 inventory. */
export async function siteCheckTargets(db: Queryable, websiteId: string, websiteUrl: string | null): Promise<SiteCheckTarget[]> {
  const pages = await listPageInventory(db, websiteId);
  return pages.map((page) => ({ pagePath: page.key, url: websiteUrl ? publicPageUrl(websiteUrl, page.path) : null }));
}

export async function checkPublicPage(fetcher: TextFetcher, target: SiteCheckTarget): Promise<PageCheckResult> {
  const base = { pagePath: target.pagePath, url: target.url };
  if (!target.url) return { ...base, outcome: "skipped", reason: "missing_url", httpStatus: null, findings: [] };
  const { result, code } = await attempt(fetcher, target.url);
  if (!result) return { ...base, outcome: "failed", reason: code ?? "network", httpStatus: null, findings: [] };
  if (result.status >= 400) return { ...base, outcome: "completed", reason: null, httpStatus: result.status, findings: [{ checkType: "http_error", detail: `HTTP ${result.status}` }] };
  if (result.contentType && !/html/i.test(result.contentType)) return { ...base, outcome: "completed", reason: null, httpStatus: result.status, findings: [] };
  const head = parseLiveHead(result.body, result.robotsHeader);
  const findings: PageCheckResult["findings"] = [];
  if (!head.title) findings.push({ checkType: "missing_title", detail: null });
  if (!head.description) findings.push({ checkType: "missing_description", detail: null });
  return { ...base, outcome: "completed", reason: null, httpStatus: result.status, findings };
}

/**
 * Checks up to 50 targets, four at a time, within a time budget. A target over the limit or not started before
 * the budget runs out is skipped with its reason; nothing is silently left out.
 */
export async function runSiteChecks(
  fetcher: TextFetcher,
  targets: SiteCheckTarget[],
  opts: { limit?: number; budgetMs?: number; concurrency?: number; clock?: () => number } = {},
): Promise<PageCheckResult[]> {
  const limit = opts.limit ?? SITE_CHECK_LIMIT;
  const clock = opts.clock ?? Date.now;
  const deadline = clock() + (opts.budgetMs ?? SITE_CHECK_BUDGET_MS);
  const results: PageCheckResult[] = targets.map((target, index) => ({
    pagePath: target.pagePath, url: target.url, outcome: "skipped", reason: index < limit ? "time_budget" : "limit", httpStatus: null, findings: [],
  }));
  let next = 0;
  const worker = async () => {
    while (next < Math.min(limit, targets.length)) {
      const index = next++;
      if (clock() >= deadline) return;
      results[index] = await checkPublicPage(fetcher, targets[index]!);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));
  return results;
}

/** Opens a run, or returns null while another run for the website is still running (one at a time). */
export async function startSiteCheckRun(db: Queryable, input: { clientId: string; websiteId: string; actorUserId: string; now?: Date }): Promise<string | null> {
  const now = input.now ?? new Date();
  // A run left open longer than ten minutes stopped without finishing; close it so it cannot block forever.
  await db.query(
    `update seo_site_check_runs set status = 'completed', finished_at = $2
     where website_id = $1 and status = 'running' and started_at < $2::timestamptz - interval '10 minutes'`,
    [input.websiteId, now.toISOString()],
  );
  const { rows } = await db.query<{ id: string }>(
    `insert into seo_site_check_runs (client_id, website_id, started_by, started_at) values ($1, $2, $3, $4)
     on conflict (website_id) where status = 'running' do nothing returning id`,
    [input.clientId, input.websiteId, input.actorUserId, now.toISOString()],
  );
  return rows[0]?.id ?? null;
}

/**
 * Stores every item and keeps findings stable: a repeat finding updates the one open finding for the page and
 * check type; a completed page without it resolves it. Failed or skipped pages leave their findings open.
 */
export async function finishSiteCheckRun(db: Queryable, input: { runId: string; clientId: string; websiteId: string; results: PageCheckResult[]; now?: Date }): Promise<void> {
  const now = (input.now ?? new Date()).toISOString();
  for (const item of input.results) {
    await db.query(
      `insert into seo_site_check_items (run_id, client_id, website_id, page_path, url, outcome, reason, http_status, checked_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [input.runId, input.clientId, input.websiteId, item.pagePath, item.url, item.outcome, item.reason, item.httpStatus, now],
    );
  }
  const completed = input.results.filter((item) => item.outcome === "completed");
  for (const item of completed) {
    for (const finding of item.findings) {
      await db.query(
        `insert into seo_site_findings (client_id, website_id, page_path, check_type, detail, first_seen_run, last_seen_run, first_seen_at, last_seen_at)
         values ($1, $2, $3, $4, $5, $6, $6, $7, $7)
         on conflict (website_id, page_path, check_type) where status = 'open'
         do update set last_seen_run = excluded.last_seen_run, last_seen_at = excluded.last_seen_at, detail = excluded.detail,
                       seen_count = seo_site_findings.seen_count + 1`,
        [input.clientId, input.websiteId, item.pagePath, finding.checkType, finding.detail, input.runId, now],
      );
    }
  }
  await db.query(
    `update seo_site_findings f set status = 'resolved', resolved_run = $2, resolved_at = $3
     from unnest($4::text[]) as done(page_path)
     where f.website_id = $1 and f.status = 'open' and f.page_path = done.page_path and f.last_seen_run <> $2`,
    [input.websiteId, input.runId, now, completed.map((item) => item.pagePath)],
  );
  // Part 6 (D65): every finding seen in this run is linked to one issue, opened or reopened as needed.
  const run = (await db.query<{ started_by: string | null }>("select started_by from seo_site_check_runs where id = $1", [input.runId])).rows[0];
  if (run?.started_by) await linkFindingIssues(db, { clientId: input.clientId, websiteId: input.websiteId, runId: input.runId, actorUserId: run.started_by });
  const count = (outcome: PageCheckResult["outcome"]) => input.results.filter((item) => item.outcome === outcome).length;
  await db.query(
    `update seo_site_check_runs set status = 'completed', finished_at = $2, attempted = $3, completed = $4, failed = $5, skipped = $6
     where id = $1`,
    [input.runId, now, count("completed") + count("failed"), count("completed"), count("failed"), count("skipped")],
  );
}

export interface SiteCheckRun {
  id: string;
  status: "running" | "completed";
  attempted: number;
  completed: number;
  failed: number;
  skipped: number;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface SiteCheckItem {
  pagePath: string;
  url: string | null;
  outcome: PageCheckResult["outcome"];
  reason: string | null;
  httpStatus: number | null;
}

export interface SiteFinding {
  id: string;
  pagePath: string;
  checkType: FindingType;
  detail: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  seenCount: number;
  issueId: string | null;
}

export interface SiteChecksView {
  running: SiteCheckRun | null;
  lastCompleted: SiteCheckRun | null;
  items: SiteCheckItem[];
  openFindings: SiteFinding[];
}

export async function readSiteChecks(db: Queryable, websiteId: string): Promise<SiteChecksView> {
  const runs = await db.query<{ id: string; status: "running" | "completed"; attempted: number; completed: number; failed: number; skipped: number; started_at: Date; finished_at: Date | null }>(
    `(select * from seo_site_check_runs where website_id = $1 and status = 'running' limit 1)
     union all
     (select * from seo_site_check_runs where website_id = $1 and status = 'completed' and finished_at is not null order by finished_at desc limit 1)`,
    [websiteId],
  );
  const toRun = (row: (typeof runs.rows)[number]): SiteCheckRun => ({
    id: row.id, status: row.status, attempted: row.attempted, completed: row.completed, failed: row.failed, skipped: row.skipped, startedAt: row.started_at, finishedAt: row.finished_at,
  });
  const runningRow = runs.rows.find((row) => row.status === "running");
  const lastRow = runs.rows.find((row) => row.status === "completed");
  const items = lastRow
    ? (await db.query<{ page_path: string; url: string | null; outcome: PageCheckResult["outcome"]; reason: string | null; http_status: number | null }>(
      "select page_path, url, outcome, reason, http_status from seo_site_check_items where run_id = $1 order by page_path",
      [lastRow.id],
    )).rows.map((row) => ({ pagePath: row.page_path, url: row.url, outcome: row.outcome, reason: row.reason, httpStatus: row.http_status }))
    : [];
  const findings = await db.query<{ id: string; page_path: string; check_type: FindingType; detail: string | null; first_seen_at: Date; last_seen_at: Date; seen_count: number; issue_id: string | null }>(
    `select id, page_path, check_type, detail, first_seen_at, last_seen_at, seen_count, issue_id
     from seo_site_findings where website_id = $1 and status = 'open' order by page_path, check_type`,
    [websiteId],
  );
  return {
    running: runningRow ? toRun(runningRow) : null,
    lastCompleted: lastRow ? toRun(lastRow) : null,
    items,
    openFindings: findings.rows.map((row) => ({
      id: row.id, pagePath: row.page_path, checkType: row.check_type, detail: row.detail, firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at, seenCount: row.seen_count, issueId: row.issue_id,
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------
// SEO-04.4 Redirect Checks

export const REDIRECT_MAX_HOPS = 10;

/** A site-relative path for a redirect check, or null. The query string is kept; the request stays on the site. */
export function localRequestPath(value: string): string | null {
  const text = value.trim();
  if (!text.startsWith("/") || text.startsWith("//") || /\s|\\/.test(text) || text.length > 500) return null;
  return routeKey(text) ? text : null;
}

export interface RedirectHop {
  url: string;
  status: number | null;
  location: string | null;
  error: string | null;
}

export interface RedirectTrace {
  hops: RedirectHop[];
  stop: "final" | "loop" | "too_many_hops" | "left_site" | "error" | "bad_location";
}

/** Requests the old URL and each Location in turn, without following automatically, up to a bounded number of hops. */
export async function traceRedirects(fetcher: TextFetcher, startUrl: string, maxHops = REDIRECT_MAX_HOPS): Promise<RedirectTrace> {
  const hops: RedirectHop[] = [];
  const seen = new Set<string>();
  const siteHost = new URL(startUrl).hostname;
  let url = startUrl;
  for (;;) {
    seen.add(url);
    const { result, code } = await attempt(fetcher, url);
    if (!result) {
      hops.push({ url, status: null, location: null, error: code });
      return { hops, stop: "error" };
    }
    const redirect = result.status >= 300 && result.status < 400;
    hops.push({ url, status: result.status, location: redirect ? result.location ?? null : null, error: null });
    if (!redirect) return { hops, stop: "final" };
    if (!result.location) return { hops, stop: "bad_location" };
    let next: URL;
    try {
      next = new URL(result.location, url);
    } catch {
      return { hops, stop: "bad_location" };
    }
    if (!sameSiteHost(next.hostname, siteHost) || (next.protocol !== "https:" && next.protocol !== "http:")) return { hops, stop: "left_site" };
    if (seen.has(next.toString())) return { hops, stop: "loop" };
    if (hops.length >= maxHops) return { hops, stop: "too_many_hops" };
    url = next.toString();
  }
}

export interface RedirectEvaluation {
  result: "passed" | "failed";
  failure: "missing_redirect" | "loop" | "wrong_destination" | "left_site" | "too_many_hops" | "final_error" | "unreachable" | "bad_location" | null;
  /** Index of the hop that caused the failure. */
  failingHop: number | null;
  finalUrl: string | null;
  finalStatus: number | null;
  temporaryHops: number;
}

/** A pass needs at least one redirect and a final 2xx response at the expected path on the same website. */
export function evaluateRedirect(trace: RedirectTrace, expectedPath: string): RedirectEvaluation {
  const last = trace.hops.length - 1;
  const lastHop = trace.hops[last]!;
  const temporaryHops = trace.hops.filter((hop) => hop.status === 302 || hop.status === 303 || hop.status === 307).length;
  const fail = (failure: NonNullable<RedirectEvaluation["failure"]>, failingHop: number): RedirectEvaluation => ({
    result: "failed", failure, failingHop, finalUrl: trace.stop === "final" ? lastHop.url : null, finalStatus: trace.stop === "final" ? lastHop.status : null, temporaryHops,
  });
  if (trace.stop === "loop") return fail("loop", last);
  if (trace.stop === "too_many_hops") return fail("too_many_hops", last);
  if (trace.stop === "left_site") return fail("left_site", last);
  if (trace.stop === "bad_location") return fail("bad_location", last);
  if (trace.stop === "error") return fail("unreachable", last);
  if (trace.hops.length === 1) return fail("missing_redirect", 0);
  if ((lastHop.status ?? 0) >= 400) return fail("final_error", last);
  const finalKey = routeKey(new URL(lastHop.url).pathname);
  if (!finalKey || finalKey !== routeKey(expectedPath)) return fail("wrong_destination", last - 1);
  return { result: "passed", failure: null, failingHop: null, finalUrl: lastHop.url, finalStatus: lastHop.status, temporaryHops };
}

export async function recordRedirectCheck(db: Queryable, input: {
  clientId: string; websiteId: string; sourcePath: string; expectedPath: string; trace: RedirectTrace; evaluation: RedirectEvaluation; actorUserId: string; now?: Date;
}): Promise<void> {
  const e = input.evaluation;
  await db.query(
    `insert into seo_redirect_checks (client_id, website_id, source_path, expected_path, result, failure, failing_hop, hops, final_url, final_status, checked_by, checked_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [input.clientId, input.websiteId, input.sourcePath, input.expectedPath, e.result, e.failure, e.failingHop, JSON.stringify(input.trace.hops), e.finalUrl, e.finalStatus, input.actorUserId, (input.now ?? new Date()).toISOString()],
  );
}

export interface RedirectCheckRow {
  sourcePath: string;
  expectedPath: string;
  result: "passed" | "failed";
  failure: RedirectEvaluation["failure"];
  failingHop: number | null;
  hops: RedirectHop[];
  finalUrl: string | null;
  finalStatus: number | null;
  checkedAt: Date;
}

/** The latest check per old path for one website. */
export async function listRedirectChecks(db: Queryable, websiteId: string): Promise<RedirectCheckRow[]> {
  const { rows } = await db.query<{ source_path: string; expected_path: string; result: "passed" | "failed"; failure: RedirectEvaluation["failure"]; failing_hop: number | null; hops: RedirectHop[]; final_url: string | null; final_status: number | null; checked_at: Date }>(
    `select distinct on (source_path) source_path, expected_path, result, failure, failing_hop, hops, final_url, final_status, checked_at
     from seo_redirect_checks where website_id = $1 order by source_path, checked_at desc`,
    [websiteId],
  );
  return rows.map((row) => ({
    sourcePath: row.source_path, expectedPath: row.expected_path, result: row.result, failure: row.failure, failingHop: row.failing_hop,
    hops: row.hops, finalUrl: row.final_url, finalStatus: row.final_status, checkedAt: row.checked_at,
  }));
}
