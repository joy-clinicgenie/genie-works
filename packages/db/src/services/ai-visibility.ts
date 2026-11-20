import { createHash, randomBytes } from "node:crypto";
import type { Queryable } from "../client";
import { publishedReport } from "../analytics/read";
import { AiAccessFetchError, type TextFetcher } from "./ai-access";
import { routeKey } from "./seo-pages";

/* SEO-05.2 NLWeb and SEO-05.3 AI Activity (D63). */

// ---------------------------------------------------------------------------------------------------------
// Shared crawler classification. ChatGPT, Gemini and Claude only.

export const AI_PROVIDERS = ["chatgpt", "gemini", "claude"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export type CrawlerPurpose = "search" | "training" | "user" | "ads" | "unspecified";

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = { chatgpt: "ChatGPT", gemini: "Gemini", claude: "Claude" };

/** Documented agents only (OpenAI and Anthropic crawler pages, 20 November 2026). Order does not matter: tokens are matched whole. */
export const DOCUMENTED_AGENTS: ReadonlyArray<{ token: string; provider: Exclude<AiProvider, "gemini">; purpose: CrawlerPurpose }> = [
  { token: "OAI-SearchBot", provider: "chatgpt", purpose: "search" },
  { token: "GPTBot", provider: "chatgpt", purpose: "training" },
  { token: "ChatGPT-User", provider: "chatgpt", purpose: "user" },
  { token: "OAI-AdsBot", provider: "chatgpt", purpose: "ads" },
  { token: "Claude-SearchBot", provider: "claude", purpose: "search" },
  { token: "ClaudeBot", provider: "claude", purpose: "training" },
  { token: "Claude-User", provider: "claude", purpose: "user" },
];

/** The documented Gemini-named fetcher. Counted only from a source that supplies documented Gemini attribution. */
export const GEMINI_FETCHER = "Google-GeminiNotebook";

function hasToken(userAgent: string, token: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9-])${token.replace(/[-]/g, "\\-")}([^A-Za-z0-9-]|$)`, "i").test(userAgent);
}

export interface CrawlerClassification {
  provider: AiProvider;
  agent: string;
  purpose: CrawlerPurpose;
}

/**
 * The one crawler filter for AI Activity, the SEO Overview and the AI Report. Googlebot, Google-Extended (a
 * robots.txt token with no user agent) and every other bot return null. Gemini needs a source with documented
 * Gemini attribution: either the source attributes the event to Gemini, or it is the documented Gemini fetcher.
 */
export function classifyCrawler(event: { userAgent?: string | null; provider?: string | null; purpose?: string | null }, source: { geminiAttribution: boolean }): CrawlerClassification | null {
  const userAgent = event.userAgent ?? "";
  for (const agent of DOCUMENTED_AGENTS) {
    if (hasToken(userAgent, agent.token)) return { provider: agent.provider, agent: agent.token, purpose: agent.purpose };
  }
  if (!source.geminiAttribution) return null;
  if (hasToken(userAgent, GEMINI_FETCHER)) return { provider: "gemini", agent: GEMINI_FETCHER, purpose: "user" };
  if ((event.provider ?? "").toLowerCase() === "gemini") {
    const purpose = (["search", "training", "user"] as const).find((value) => value === event.purpose) ?? "unspecified";
    return { provider: "gemini", agent: "Gemini (source attribution)", purpose };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Crawler sources and ingestion

export class AiVisibilityRuleError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "AiVisibilityRuleError";
    this.field = field;
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Creates a connected source and returns its token once. Service context; the caller authorises an administrator. */
export async function createCrawlerSource(db: Queryable, input: { clientId: string; websiteId: string; kind: "request_log" | "platform_feed"; label: string; geminiAttribution: boolean; actorUserId: string }): Promise<{ id: string; token: string }> {
  const label = input.label.trim();
  if (!label || label.length > 120) throw new AiVisibilityRuleError("Name the source in 1–120 characters.", "label");
  const token = randomBytes(32).toString("base64url");
  const { rows } = await db.query<{ id: string }>(
    `insert into seo_crawler_sources (client_id, website_id, kind, label, gemini_attribution, token_hash, created_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [input.clientId, input.websiteId, input.kind, label, input.geminiAttribution, sha256(token), input.actorUserId],
  );
  return { id: rows[0]!.id, token };
}

export async function disconnectCrawlerSource(db: Queryable, input: { websiteId: string; sourceId: string }): Promise<boolean> {
  const { rowCount } = await db.query(
    "update seo_crawler_sources set status = 'disconnected', disconnected_at = now() where id = $1 and website_id = $2 and status = 'connected'",
    [input.sourceId, input.websiteId],
  );
  return (rowCount ?? 0) > 0;
}

export interface IncomingCrawlerEvent {
  id: string;
  timestamp: string;
  userAgent?: string | null;
  provider?: string | null;
  purpose?: string | null;
  path?: string | null;
  status?: number | null;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  ignored: number;
}

export const CRAWLER_BATCH_LIMIT = 5000;

/** A public path with no query string, fragment or credentials, or null. */
export function sanitisePath(value: string | null | undefined): string | null {
  if (!value) return null;
  let path = value.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  const key = routeKey(path.split(/[?#]/, 1)[0] ?? "");
  return key && key.length <= 500 ? key : null;
}

/**
 * Stores one batch from a connected source with the window it covers. Only ChatGPT, Gemini and Claude events
 * are stored, each once per source and event ID; every other event is counted as ignored and discarded.
 * Service context; the caller has verified the source token.
 */
export async function ingestCrawlerBatch(db: Queryable, input: { tokenHash: string; websiteId: string; windowStart: string; windowEnd: string; events: IncomingCrawlerEvent[]; now?: Date }): Promise<IngestResult | "unknown_source" | "invalid_window" | "too_many_events"> {
  const source = (await db.query<{ id: string; client_id: string; gemini_attribution: boolean }>(
    "select id, client_id, gemini_attribution from seo_crawler_sources where token_hash = $1 and website_id = $2 and status = 'connected'",
    [input.tokenHash, input.websiteId],
  )).rows[0];
  if (!source) return "unknown_source";
  const start = new Date(input.windowStart);
  const end = new Date(input.windowEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end || end.getTime() - start.getTime() > 31 * 86_400_000) return "invalid_window";
  if (input.events.length > CRAWLER_BATCH_LIMIT) return "too_many_events";
  const result: IngestResult = { accepted: 0, duplicates: 0, ignored: 0 };
  for (const event of input.events) {
    const at = new Date(event.timestamp);
    const key = typeof event.id === "string" ? event.id.trim() : "";
    const kind = classifyCrawler(event, { geminiAttribution: source.gemini_attribution });
    if (!kind || !key || key.length > 200 || Number.isNaN(at.getTime()) || at < start || at >= end) {
      result.ignored += 1;
      continue;
    }
    const status = typeof event.status === "number" && event.status >= 100 && event.status <= 599 ? event.status : null;
    const inserted = await db.query(
      `insert into seo_crawler_events (source_id, client_id, website_id, event_key, occurred_at, provider, agent, purpose, page_path, http_status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (source_id, event_key) do nothing`,
      [source.id, source.client_id, input.websiteId, key, at.toISOString(), kind.provider, kind.agent, kind.purpose, sanitisePath(event.path), status],
    );
    if ((inserted.rowCount ?? 0) > 0) result.accepted += 1;
    else result.duplicates += 1;
  }
  const now = (input.now ?? new Date()).toISOString();
  await db.query(
    `insert into seo_crawler_batches (source_id, client_id, website_id, window_start, window_end, accepted, duplicates, ignored, received_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [source.id, source.client_id, input.websiteId, start.toISOString(), end.toISOString(), result.accepted, result.duplicates, result.ignored, now],
  );
  await db.query("update seo_crawler_sources set last_success_at = $2 where id = $1", [source.id, now]);
  return result;
}

export function crawlerTokenHash(token: string): string {
  return sha256(token);
}

// ---------------------------------------------------------------------------------------------------------
// Saved external answer tests (mentions)

export async function recordAnswerTest(db: Queryable, input: { clientId: string; websiteId: string; platform: AiProvider; question: string; testedOn: string; mentioned: boolean; citedUrl: string | null; answerExcerpt: string | null; actorUserId: string }): Promise<void> {
  const question = input.question.trim();
  if (!question || question.length > 300) throw new AiVisibilityRuleError("Enter the question asked, up to 300 characters.", "question");
  if (!AI_PROVIDERS.includes(input.platform)) throw new AiVisibilityRuleError("Choose ChatGPT, Gemini or Claude.", "platform");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.testedOn)) throw new AiVisibilityRuleError("Enter the date of the test.", "testedOn");
  const cited = input.citedUrl?.trim() || null;
  if (cited && !/^https?:\/\/\S+$/.test(cited)) throw new AiVisibilityRuleError("The cited source must be a full web address.", "citedUrl");
  await db.query(
    `insert into seo_answer_tests (client_id, website_id, platform, question, tested_on, mentioned, cited_url, answer_excerpt, recorded_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [input.clientId, input.websiteId, input.platform, question, input.testedOn, input.mentioned, cited, input.answerExcerpt?.trim().slice(0, 1000) || null, input.actorUserId],
  );
}

// ---------------------------------------------------------------------------------------------------------
// AI Activity

/** Referral hosts per provider (sessionSource values). */
export const AI_REFERRAL_SOURCES: Record<AiProvider, string[]> = {
  chatgpt: ["chatgpt.com", "chat.openai.com"],
  gemini: ["gemini.google.com"],
  claude: ["claude.ai"],
};

export function referralProvider(source: string): AiProvider | null {
  const host = source.trim().toLowerCase().replace(/^www\./, "");
  return AI_PROVIDERS.find((provider) => AI_REFERRAL_SOURCES[provider].includes(host)) ?? null;
}

export type Availability = "available" | "unavailable";

export interface CrawlerActivity {
  status: "no_source" | "disconnected" | "not_covered" | "covered";
  lastSuccessAt: Date | null;
  providers: Record<AiProvider, { availability: Availability; count: number | null; byPurpose: Partial<Record<CrawlerPurpose, number>> }>;
  /** Sum over available providers only. */
  total: number | null;
  unavailableProviders: AiProvider[];
}

export interface ReferralActivity {
  status: "not_connected" | "wix_only" | "not_prepared" | "preparing" | "available";
  sessions: number | null;
  byProvider: Record<AiProvider, number> | null;
  fetchedAt: Date | null;
}

export interface MentionActivity {
  tests: number;
  mentions: number | null;
  byProvider: Record<AiProvider, number>;
  recent: Array<{ platform: AiProvider; question: string; testedOn: string; mentioned: boolean; citedUrl: string | null }>;
}

export interface AiActivity {
  range: { start: string; end: string };
  crawlers: CrawlerActivity;
  referrals: ReferralActivity;
  mentions: MentionActivity;
}

/** Start of a Singapore day as an instant. */
function sgtStart(date: string): Date {
  return new Date(`${date}T00:00:00+08:00`);
}

function mergedCover(windows: Array<{ start: Date; end: Date }>, from: Date, to: Date): boolean {
  let reach = from.getTime();
  for (const window of [...windows].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    if (window.start.getTime() > reach) break;
    reach = Math.max(reach, window.end.getTime());
    if (reach >= to.getTime()) return true;
  }
  return reach >= to.getTime();
}

const emptyProviders = (): Record<AiProvider, number> => ({ chatgpt: 0, gemini: 0, claude: 0 });

/**
 * One read of AI Activity for a website and date range (Asia/Singapore days), shared by AI Activity, the SEO
 * Overview and the AI Report. Crawlers, referrals and mentions are separate measures.
 */
export async function loadAiActivity(db: Queryable, input: { clientId: string; websiteId: string; start: string; end: string }): Promise<AiActivity> {
  const from = sgtStart(input.start);
  const to = new Date(sgtStart(input.end).getTime() + 86_400_000);

  // Crawlers: only connected sources, and only when their declared windows cover the whole range.
  const sources = (await db.query<{ id: string; status: string; gemini_attribution: boolean; last_success_at: Date | null }>(
    "select id, status, gemini_attribution, last_success_at from seo_crawler_sources where website_id = $1",
    [input.websiteId],
  )).rows;
  const connected = sources.filter((source) => source.status === "connected");
  const windows = connected.length
    ? (await db.query<{ source_id: string; window_start: Date; window_end: Date }>(
      "select source_id, window_start, window_end from seo_crawler_batches where source_id = any($1::uuid[]) and window_end > $2 and window_start < $3",
      [connected.map((source) => source.id), from.toISOString(), to.toISOString()],
    )).rows
    : [];
  const covering = connected.filter((source) => mergedCover(windows.filter((w) => w.source_id === source.id).map((w) => ({ start: w.window_start, end: w.window_end })), from, to));
  const status: CrawlerActivity["status"] = sources.length === 0 ? "no_source" : connected.length === 0 ? "disconnected" : covering.length === 0 ? "not_covered" : "covered";
  const counts = covering.length
    ? (await db.query<{ provider: AiProvider; purpose: CrawlerPurpose; n: number }>(
      `select provider, purpose, count(*)::int as n from seo_crawler_events
       where source_id = any($1::uuid[]) and occurred_at >= $2 and occurred_at < $3 group by provider, purpose`,
      [covering.map((source) => source.id), from.toISOString(), to.toISOString()],
    )).rows
    : [];
  const geminiCovered = covering.some((source) => source.gemini_attribution);
  const providers = Object.fromEntries(AI_PROVIDERS.map((provider) => {
    const available = covering.length > 0 && (provider !== "gemini" || geminiCovered);
    const rows = counts.filter((row) => row.provider === provider);
    return [provider, {
      availability: available ? "available" : "unavailable",
      count: available ? rows.reduce((sum, row) => sum + row.n, 0) : null,
      byPurpose: available ? Object.fromEntries(rows.map((row) => [row.purpose, row.n])) : {},
    }];
  })) as CrawlerActivity["providers"];
  const unavailableProviders = AI_PROVIDERS.filter((provider) => providers[provider].availability === "unavailable");
  const crawlers: CrawlerActivity = {
    status,
    lastSuccessAt: connected.reduce<Date | null>((latest, source) => (source.last_success_at && (!latest || source.last_success_at > latest) ? source.last_success_at : latest), null),
    providers,
    total: covering.length ? AI_PROVIDERS.reduce((sum, provider) => sum + (providers[provider].count ?? 0), 0) : null,
    unavailableProviders,
  };

  // Referrals: the connected GA4 property's session-source report for this exact window.
  const traffic = (await db.query<{ id: string; provider: string }>(
    `select id, provider from analytics_connections
     where website_id = $1 and provider in ('ga4', 'wix') and disconnected_at is null and status = 'connected'
     order by created_at desc limit 1`,
    [input.websiteId],
  )).rows[0];
  let referrals: ReferralActivity = { status: "not_connected", sessions: null, byProvider: null, fetchedAt: null };
  if (traffic?.provider === "wix") referrals = { ...referrals, status: "wix_only" };
  if (traffic?.provider === "ga4") {
    const report = await publishedReport(db, { clientId: input.clientId, websiteId: input.websiteId, templateKey: "ga4.session_source", start: input.start, end: input.end });
    if (report) {
      const byProvider = emptyProviders();
      for (const row of report.rows) {
        const provider = referralProvider(row.dimensions.sessionSource ?? "");
        const value = row.metrics.find((metric) => metric.key === "sessions" && metric.state === "available")?.value;
        if (provider && typeof value === "number") byProvider[provider] += value;
      }
      referrals = { status: "available", sessions: byProvider.chatgpt + byProvider.gemini + byProvider.claude, byProvider, fetchedAt: report.fetchedAt ? new Date(report.fetchedAt) : null };
    } else {
      const queued = await db.query(
        `select 1 from analytics_jobs where connection_id = $1 and template_key = 'ga4.session_source'
           and start_date = $2 and end_date = $3 and state in ('queued', 'leased') limit 1`,
        [traffic.id, input.start, input.end],
      );
      referrals = { ...referrals, status: queued.rows.length ? "preparing" : "not_prepared" };
    }
  }

  // Mentions: positive saved external answer tests in the range.
  const tests = (await db.query<{ platform: AiProvider; question: string; tested_on: string; mentioned: boolean; cited_url: string | null }>(
    `select platform, question, tested_on::text, mentioned, cited_url from seo_answer_tests
     where website_id = $1 and tested_on between $2 and $3 order by tested_on desc, recorded_at desc`,
    [input.websiteId, input.start, input.end],
  )).rows;
  const byProvider = emptyProviders();
  for (const test of tests) if (test.mentioned) byProvider[test.platform] += 1;
  const mentions: MentionActivity = {
    tests: tests.length,
    mentions: tests.length ? byProvider.chatgpt + byProvider.gemini + byProvider.claude : null,
    byProvider,
    recent: tests.slice(0, 20).map((test) => ({ platform: test.platform, question: test.question, testedOn: test.tested_on, mentioned: test.mentioned, citedUrl: test.cited_url })),
  };

  return { range: { start: input.start, end: input.end }, crawlers, referrals, mentions };
}

export interface CrawlerEventRow {
  occurredAt: Date;
  provider: AiProvider;
  agent: string;
  purpose: CrawlerPurpose;
  pagePath: string | null;
  httpStatus: number | null;
}

/** Drill-down: eligible events from connected sources in the range, newest first, optionally for one provider. */
export async function listCrawlerEvents(db: Queryable, input: { websiteId: string; start: string; end: string; provider?: AiProvider; limit?: number }): Promise<CrawlerEventRow[]> {
  const { rows } = await db.query<{ occurred_at: Date; provider: AiProvider; agent: string; purpose: CrawlerPurpose; page_path: string | null; http_status: number | null }>(
    `select e.occurred_at, e.provider, e.agent, e.purpose, e.page_path, e.http_status
     from seo_crawler_events e join seo_crawler_sources s on s.id = e.source_id and s.status = 'connected'
     where e.website_id = $1 and e.occurred_at >= $2 and e.occurred_at < $3 and ($4::text is null or e.provider = $4)
     order by e.occurred_at desc limit $5`,
    [input.websiteId, sgtStart(input.start).toISOString(), new Date(sgtStart(input.end).getTime() + 86_400_000).toISOString(), input.provider ?? null, Math.min(input.limit ?? 100, 500)],
  );
  return rows.map((row) => ({ occurredAt: row.occurred_at, provider: row.provider, agent: row.agent, purpose: row.purpose, pagePath: row.page_path, httpStatus: row.http_status }));
}

export interface CrawlerSourceRow {
  id: string;
  kind: "request_log" | "platform_feed";
  label: string;
  geminiAttribution: boolean;
  status: "connected" | "disconnected";
  lastSuccessAt: Date | null;
  createdAt: Date;
}

export async function listCrawlerSources(db: Queryable, websiteId: string): Promise<CrawlerSourceRow[]> {
  const { rows } = await db.query<{ id: string; kind: CrawlerSourceRow["kind"]; label: string; gemini_attribution: boolean; status: CrawlerSourceRow["status"]; last_success_at: Date | null; created_at: Date }>(
    "select id, kind, label, gemini_attribution, status, last_success_at, created_at from seo_crawler_sources where website_id = $1 order by created_at desc",
    [websiteId],
  );
  return rows.map((row) => ({ id: row.id, kind: row.kind, label: row.label, geminiAttribution: row.gemini_attribution, status: row.status, lastSuccessAt: row.last_success_at, createdAt: row.created_at }));
}

// ---------------------------------------------------------------------------------------------------------
// SEO-05.2 NLWeb

function sameSiteHost(a: string, b: string): boolean {
  const strip = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return strip(a) === strip(b) || strip(a).endsWith(`.${strip(b)}`);
}

/** An approved endpoint: HTTPS on the website's own host or one of its subdomains, no credentials. */
export function nlwebEndpointProblem(endpoint: string, websiteUrl: string | null): string | null {
  let url: URL;
  let site: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return "Enter the full HTTPS address of the NLWeb /ask endpoint.";
  }
  if (!websiteUrl) return "This website has no public address, so an endpoint cannot be approved.";
  try {
    site = new URL(websiteUrl);
  } catch {
    return "This website has no usable public address.";
  }
  if (url.protocol !== "https:" || url.username || url.password) return "The endpoint must use HTTPS without credentials.";
  if (!sameSiteHost(url.hostname, site.hostname)) return "The endpoint must be on this website's own domain.";
  if (url.search || url.hash) return "Enter the endpoint without a query string.";
  return null;
}

export async function saveNlwebEndpoint(db: Queryable, input: { clientId: string; websiteId: string; endpointUrl: string; actorUserId: string }): Promise<void> {
  await db.query(
    `insert into seo_nlweb_endpoints (website_id, client_id, endpoint_url, updated_by) values ($1, $2, $3, $4)
     on conflict (website_id) do update set endpoint_url = excluded.endpoint_url, updated_by = excluded.updated_by, updated_at = now()`,
    [input.websiteId, input.clientId, input.endpointUrl.trim(), input.actorUserId],
  );
}

export interface NlwebReading {
  outcome: "answered" | "empty" | "timeout" | "error";
  httpStatus: number | null;
  answer: string | null;
  sources: Array<{ url: string; name: string | null }>;
  errorCode: string | null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** Reads a non-streaming NLWeb response defensively: the REST documentation does not name the results key. */
export function parseNlwebResponse(body: unknown): Pick<NlwebReading, "answer" | "sources"> {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const list = [record.results, record.content, (record.itemListElement as unknown)].find(Array.isArray) as unknown[] | undefined;
  const sources: NlwebReading["sources"] = [];
  const descriptions: string[] = [];
  for (const raw of list ?? []) {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const inner = item.item && typeof item.item === "object" ? item.item as Record<string, unknown> : item;
    const url = text(inner.url, 2048);
    if (url && /^https?:\/\//.test(url) && sources.length < 20) sources.push({ url, name: text(inner.name, 200) });
    const description = text(inner.description, 1000);
    if (description) descriptions.push(description);
  }
  const answer = text(record.summary, 4000) ?? text(record.answer, 4000) ?? text(record.message, 4000) ?? text(record.text, 4000) ?? (descriptions.length ? descriptions.join("\n\n").slice(0, 4000) : null);
  return { answer, sources };
}

/** Sends one question to the endpoint's /ask interface without streaming. */
export async function runNlwebTest(fetcher: TextFetcher, endpointUrl: string, question: string): Promise<NlwebReading> {
  const url = new URL(endpointUrl);
  url.searchParams.set("query", question);
  url.searchParams.set("mode", "summarize");
  url.searchParams.set("streaming", "false");
  let result;
  try {
    result = await fetcher(url.toString());
  } catch (error) {
    const code = error instanceof AiAccessFetchError ? error.code : "network";
    return { outcome: code === "timeout" ? "timeout" : "error", httpStatus: null, answer: null, sources: [], errorCode: code };
  }
  if (result.status >= 400) return { outcome: "error", httpStatus: result.status, answer: null, sources: [], errorCode: `http_${result.status}` };
  let body: unknown;
  try {
    body = JSON.parse(result.body);
  } catch {
    return { outcome: "error", httpStatus: result.status, answer: null, sources: [], errorCode: "not_json" };
  }
  const parsed = parseNlwebResponse(body);
  return { outcome: parsed.answer || parsed.sources.length ? "answered" : "empty", httpStatus: result.status, ...parsed, errorCode: null };
}

export async function recordNlwebTest(db: Queryable, input: { clientId: string; websiteId: string; endpointUrl: string; question: string; reading: NlwebReading; actorUserId: string; now?: Date }): Promise<void> {
  const r = input.reading;
  await db.query(
    `insert into seo_nlweb_tests (client_id, website_id, endpoint_url, question, outcome, http_status, answer, sources, safe_error_code, tested_by, tested_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [input.clientId, input.websiteId, input.endpointUrl, input.question, r.outcome, r.httpStatus, r.answer, JSON.stringify(r.sources), r.errorCode, input.actorUserId, (input.now ?? new Date()).toISOString()],
  );
}

export interface NlwebState {
  endpointUrl: string | null;
  tests: Array<NlwebReading & { question: string; testedAt: Date; endpointUrl: string }>;
}

export async function readNlweb(db: Queryable, websiteId: string): Promise<NlwebState> {
  const endpoint = (await db.query<{ endpoint_url: string }>("select endpoint_url from seo_nlweb_endpoints where website_id = $1", [websiteId])).rows[0];
  const { rows } = await db.query<{ question: string; outcome: NlwebReading["outcome"]; http_status: number | null; answer: string | null; sources: NlwebReading["sources"]; safe_error_code: string | null; tested_at: Date; endpoint_url: string }>(
    "select question, outcome, http_status, answer, sources, safe_error_code, tested_at, endpoint_url from seo_nlweb_tests where website_id = $1 order by tested_at desc limit 10",
    [websiteId],
  );
  return {
    endpointUrl: endpoint?.endpoint_url ?? null,
    tests: rows.map((row) => ({ question: row.question, outcome: row.outcome, httpStatus: row.http_status, answer: row.answer, sources: row.sources, errorCode: row.safe_error_code, testedAt: row.tested_at, endpointUrl: row.endpoint_url })),
  };
}
