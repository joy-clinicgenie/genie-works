import type { Queryable } from "../client";
import { requireWebsiteForClient } from "./registry";

/**
 * D57: read-only AI access check. Reads robots.txt and llms.txt from the website's
 * registry origin. It does not edit the website and is not a crawler log.
 */

export const AI_CRAWLERS = [
  { agent: "GPTBot", operator: "OpenAI", purpose: "Model training" },
  { agent: "OAI-SearchBot", operator: "OpenAI", purpose: "ChatGPT search" },
  { agent: "ChatGPT-User", operator: "OpenAI", purpose: "User-requested visits" },
  { agent: "ClaudeBot", operator: "Anthropic", purpose: "Model training" },
  { agent: "Claude-SearchBot", operator: "Anthropic", purpose: "Claude search" },
  { agent: "Claude-User", operator: "Anthropic", purpose: "User-requested visits" },
  { agent: "PerplexityBot", operator: "Perplexity", purpose: "Perplexity search" },
  { agent: "Perplexity-User", operator: "Perplexity", purpose: "User-requested visits" },
  { agent: "Google-Extended", operator: "Google", purpose: "Gemini use of content" },
  { agent: "Applebot-Extended", operator: "Apple", purpose: "Apple Intelligence use of content" },
  { agent: "CCBot", operator: "Common Crawl", purpose: "Open dataset used for training" },
  { agent: "Bingbot", operator: "Microsoft", purpose: "Bing and Copilot search" },
] as const;

export type CrawlerVerdict = "allowed" | "blocked" | "unknown";
/** named: a group names the crawler. default: the `*` group applies. no_file: robots.txt returned 4xx. none: not evaluated. */
export type CrawlerRule = "named" | "default" | "no_file" | "none";
export type FileStatus = "found" | "missing" | "not_text" | "error";

export interface CrawlerReading {
  agent: string;
  verdict: CrawlerVerdict;
  rule: CrawlerRule;
}

export interface AiAccessReading {
  origin: string;
  robotsStatus: FileStatus;
  robotsHttp: number | null;
  llmsStatus: FileStatus;
  llmsHttp: number | null;
  llmsBytes: number | null;
  crawlers: CrawlerReading[];
  safeErrorCode: string | null;
}

export interface AiAccessCheckRow extends AiAccessReading {
  id: string;
  clientId: string;
  websiteId: string;
  checkedBy: string;
  checkedByName: string | null;
  checkedAt: Date;
}

/** A fetched text file. The fetcher enforces host, size, redirect and time limits. */
export interface TextFetchResult {
  status: number;
  contentType: string | null;
  body: string;
  bytes: number;
}
export type TextFetcher = (url: string) => Promise<TextFetchResult>;

export class AiAccessRuleError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "AiAccessRuleError";
    this.field = field;
  }
}

/** Error thrown by a fetcher with a short code that is safe to store. */
export class AiAccessFetchError extends Error {
  code: string;
  constructor(code: string, message = "The website could not be read.") {
    super(message);
    this.name = "AiAccessFetchError";
    this.code = /^[a-z0-9_]{1,64}$/.test(code) ? code : "fetch_failed";
  }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const LOCAL_SUFFIXES = [".local", ".localhost", ".internal", ".invalid", ".test", ".example", ".lan", ".home", ".corp"];

/** True when a host name is not a public DNS name: an IP literal, a single label or a reserved suffix. */
export function isNonPublicHostName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || IPV4.test(h) || h.includes(":") || h.startsWith("[")) return true;
  if (!h.includes(".")) return true;
  return LOCAL_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

/** The https origin of a registry address, or a rule error. Paths, queries and credentials are dropped or refused. */
export function aiAccessOrigin(url: string | null | undefined): string {
  if (!url || !url.trim()) throw new AiAccessRuleError("This website has no public address in its record.", "url");
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new AiAccessRuleError("The website address in its record could not be read.", "url");
  }
  if (parsed.protocol !== "https:") throw new AiAccessRuleError("The website address must use https.", "url");
  if (parsed.username || parsed.password) throw new AiAccessRuleError("The website address must not contain a user name or password.", "url");
  if (isNonPublicHostName(parsed.hostname)) throw new AiAccessRuleError("The website address is not a public host name.", "url");
  return parsed.origin.toLowerCase();
}

interface RobotsGroup {
  agents: string[];
  rules: Array<{ allow: boolean; path: string }>;
}

/** Groups per RFC 9309. Consecutive user-agent lines share one group; unknown lines are ignored. */
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue;
      // An empty Disallow allows everything and adds no rule.
      if (value === "") continue;
      current.rules.push({ allow: key === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

/** Whether `path` is allowed for `agent`. Longest matching rule wins; Allow wins a tie. */
export function robotsVerdict(groups: RobotsGroup[], agent: string, path = "/"): { verdict: "allowed" | "blocked"; rule: "named" | "default" } {
  const token = agent.toLowerCase();
  let matched = groups.filter((group) => group.agents.includes(token));
  let rule: "named" | "default" = "named";
  if (matched.length === 0) {
    matched = groups.filter((group) => group.agents.includes("*"));
    rule = "default";
  }
  let best: { allow: boolean; length: number } | null = null;
  for (const entry of matched.flatMap((group) => group.rules)) {
    if (!patternMatches(entry.path, path)) continue;
    const length = entry.path.length;
    if (!best || length > best.length || (length === best.length && entry.allow && !best.allow)) best = { allow: entry.allow, length };
  }
  return { verdict: !best || best.allow ? "allowed" : "blocked", rule };
}

function isPlainText(contentType: string | null): boolean {
  if (!contentType) return true;
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  return type === "text/plain" || type === "text/markdown" || type === "text/x-markdown";
}

function fileStatus(result: TextFetchResult): FileStatus {
  if (result.status >= 200 && result.status < 300) return isPlainText(result.contentType) ? "found" : "not_text";
  if (result.status >= 400 && result.status < 500) return "missing";
  return "error";
}

async function safeFetch(fetcher: TextFetcher, url: string): Promise<{ result: TextFetchResult | null; code: string | null }> {
  try {
    return { result: await fetcher(url), code: null };
  } catch (err) {
    return { result: null, code: err instanceof AiAccessFetchError ? err.code : "fetch_failed" };
  }
}

/** Reads both files and evaluates every listed crawler. Never throws for an unreachable site. */
export async function readAiAccess(fetcher: TextFetcher, origin: string): Promise<AiAccessReading> {
  const robots = await safeFetch(fetcher, `${origin}/robots.txt`);
  const llms = await safeFetch(fetcher, `${origin}/llms.txt`);

  const robotsStatus: FileStatus = robots.result ? fileStatus(robots.result) : "error";
  let crawlers: CrawlerReading[];
  if (robotsStatus === "found") {
    const groups = parseRobots(robots.result!.body);
    crawlers = AI_CRAWLERS.map(({ agent }) => ({ agent, ...robotsVerdict(groups, agent) }));
  } else if (robotsStatus === "missing") {
    crawlers = AI_CRAWLERS.map(({ agent }) => ({ agent, verdict: "allowed" as const, rule: "no_file" as const }));
  } else {
    crawlers = AI_CRAWLERS.map(({ agent }) => ({ agent, verdict: "unknown" as const, rule: "none" as const }));
  }

  const llmsStatus: FileStatus = llms.result ? fileStatus(llms.result) : "error";
  return {
    origin,
    robotsStatus,
    robotsHttp: robots.result?.status ?? null,
    llmsStatus,
    llmsHttp: llms.result?.status ?? null,
    llmsBytes: llms.result && llmsStatus === "found" ? llms.result.bytes : null,
    crawlers,
    safeErrorCode: robots.code ?? llms.code,
  };
}

/** The registry origin for a website the caller can see. The stored client owns the website. */
export async function aiAccessTarget(db: Queryable, input: { clientId: string; websiteId: string }): Promise<{ clientId: string; websiteId: string; origin: string }> {
  const site = await requireWebsiteForClient(db, input.websiteId, input.clientId);
  return { clientId: site.client_id, websiteId: site.id, origin: aiAccessOrigin(site.url) };
}

/** Stores one reading. RLS allows admin, manager and specialist members, as the acting user only. */
export async function recordAiAccessCheck(
  db: Queryable,
  input: { clientId: string; websiteId: string; userId: string; reading: AiAccessReading },
): Promise<string> {
  const r = input.reading;
  const { rows } = await db.query<{ id: string }>(
    `insert into seo_ai_access_checks
       (client_id, website_id, origin, robots_status, robots_http, llms_status, llms_http, llms_bytes, crawlers, safe_error_code, checked_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
     returning id`,
    [input.clientId, input.websiteId, r.origin, r.robotsStatus, r.robotsHttp, r.llmsStatus, r.llmsHttp, r.llmsBytes, JSON.stringify(r.crawlers), r.safeErrorCode, input.userId],
  );
  return rows[0]!.id;
}

interface CheckDbRow {
  id: string;
  client_id: string;
  website_id: string;
  origin: string;
  robots_status: FileStatus;
  robots_http: number | null;
  llms_status: FileStatus;
  llms_http: number | null;
  llms_bytes: number | null;
  crawlers: CrawlerReading[];
  safe_error_code: string | null;
  checked_by: string;
  checked_by_name: string | null;
  checked_at: Date;
}

/** Newest first. Rows for a client the caller cannot see are filtered by RLS. */
export async function listAiAccessChecks(db: Queryable, websiteId: string, limit = 10): Promise<AiAccessCheckRow[]> {
  const { rows } = await db.query<CheckDbRow>(
    `select c.*, u.display_name as checked_by_name
     from seo_ai_access_checks c
     left join staff_users u on u.id = c.checked_by
     where c.website_id = $1
     order by c.checked_at desc, c.id
     limit $2`,
    [websiteId, Math.max(1, Math.min(limit, 50))],
  );
  return rows.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    websiteId: row.website_id,
    origin: row.origin,
    robotsStatus: row.robots_status,
    robotsHttp: row.robots_http,
    llmsStatus: row.llms_status,
    llmsHttp: row.llms_http,
    llmsBytes: row.llms_bytes,
    crawlers: row.crawlers,
    safeErrorCode: row.safe_error_code,
    checkedBy: row.checked_by,
    checkedByName: row.checked_by_name,
    checkedAt: row.checked_at,
  }));
}
