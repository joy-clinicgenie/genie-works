"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AiVisibilityRuleError,
  AI_PROVIDERS,
  addDays,
  canEditClient,
  canManageRegistry,
  canPublishClient,
  canWriteConnectionSecrets,
  createCrawlerSource,
  disconnectCrawlerSource,
  enqueueJob,
  nlwebEndpointProblem,
  readNlweb,
  recordAnswerTest,
  recordNlwebTest,
  runNlwebTest,
  saveNlwebEndpoint,
  todaySgt,
  type AccessProfile,
  type AiProvider,
} from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { serviceTx, staffTx } from "@/lib/db";
import { bool, optional, str } from "@/lib/actions";
import { aiAccessFetcher } from "@/lib/ai-access-fetch";
import { isWebsiteId } from "@/lib/seo-scope";
import { loadSeoContextWithDb, type SeoSite } from "@/lib/seo-workspace";

const PAGE = "/seo/ai-visibility";

function back(websiteId: string, tab: string, notice: string, extra: Record<string, string> = {}): never {
  redirect(`${PAGE}?${new URLSearchParams({ website: websiteId, tab, notice, ...extra })}`);
}

/** The selected website, re-resolved on the server for this staff member. */
async function scopedSite(access: AccessProfile, websiteId: string): Promise<SeoSite | null> {
  if (!isWebsiteId(websiteId)) return null;
  const site = await staffTx(access, async (db) => (await loadSeoContextWithDb(db, { website: websiteId })).selected);
  return site && site.id === websiteId ? site : null;
}

/** SEO-05.2: an editor or above stores the website's NLWeb /ask endpoint on its own domain. */
export async function saveNlwebEndpointAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const endpoint = str(formData, "endpointUrl");
  const access = await requireAccess();
  const site = await scopedSite(access, websiteId);
  if (!site || !canPublishClient(access, site.clientId)) back(websiteId, "access", "denied");
  const problem = nlwebEndpointProblem(endpoint, site.url);
  if (problem) back(websiteId, "access", "nlweb_invalid", { reason: problem });
  await serviceTx((db) => saveNlwebEndpoint(db, { clientId: site.clientId, websiteId, endpointUrl: endpoint, actorUserId: access.user.id }));
  revalidatePath(PAGE);
  back(websiteId, "access", "nlweb_saved");
}

/** SEO-05.2: sends one staff question to the stored endpoint and keeps the answer, sources and time. */
export async function runNlwebTestAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const question = str(formData, "question").trim();
  const access = await requireAccess();
  const site = await scopedSite(access, websiteId);
  if (!site || !canEditClient(access, site.clientId)) back(websiteId, "access", "denied");
  if (!question || question.length > 300) back(websiteId, "access", "nlweb_question");
  const { endpointUrl } = await staffTx(access, (db) => readNlweb(db, websiteId));
  // The stored endpoint is re-checked against the registry address before anything is sent.
  if (!endpointUrl) back(websiteId, "access", "nlweb_not_configured");
  if (nlwebEndpointProblem(endpointUrl, site.url)) back(websiteId, "access", "nlweb_invalid", { reason: nlwebEndpointProblem(endpointUrl, site.url)! });
  const fetcher = aiAccessFetcher({ userAgent: "GenieWorks-NLWebTest/1.0", accept: "application/json", maxRedirects: 2 });
  const reading = await runNlwebTest(fetcher, endpointUrl, question);
  await serviceTx((db) => recordNlwebTest(db, { clientId: site.clientId, websiteId, endpointUrl, question, reading, actorUserId: access.user.id }));
  revalidatePath(PAGE);
  back(websiteId, "access", "nlweb_tested");
}

export type CrawlerSourceState = { ok: true; token: string; message: string } | { ok: false; error: string } | null;

/** SEO-05.3: an administrator connects a request-log feed. The token is shown once. */
export async function createCrawlerSourceAction(_prev: CrawlerSourceState, formData: FormData): Promise<CrawlerSourceState> {
  const websiteId = str(formData, "websiteId");
  const access = await requireAccess();
  if (!canWriteConnectionSecrets(access)) return { ok: false, error: "Connecting a crawler log source needs an administrator." };
  const site = await scopedSite(access, websiteId);
  if (!site) return { ok: false, error: "That website is not available." };
  const kind = str(formData, "kind") === "platform_feed" ? "platform_feed" : "request_log";
  try {
    const created = await serviceTx((db) => createCrawlerSource(db, {
      clientId: site.clientId,
      websiteId,
      kind,
      label: str(formData, "label"),
      geminiAttribution: bool(formData, "geminiAttribution"),
      actorUserId: access.user.id,
    }));
    revalidatePath(PAGE);
    return { ok: true, token: created.token, message: "Source connected. Copy this token now; it is not shown again." };
  } catch (error) {
    if (error instanceof AiVisibilityRuleError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function disconnectCrawlerSourceAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const sourceId = str(formData, "sourceId");
  const access = await requireAccess();
  const site = await scopedSite(access, websiteId);
  if (!site || !canWriteConnectionSecrets(access) || !isWebsiteId(sourceId)) back(websiteId, "visibility", "denied");
  await serviceTx((db) => disconnectCrawlerSource(db, { websiteId, sourceId }));
  revalidatePath(PAGE);
  back(websiteId, "visibility", "source_disconnected");
}

/** SEO-05.3 mentions: a staff member saves an external answer test. Editors only. */
export async function recordAnswerTestAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const access = await requireAccess();
  const site = await scopedSite(access, websiteId);
  if (!site || !canEditClient(access, site.clientId)) back(websiteId, "questions", "denied");
  const platform = str(formData, "platform") as AiProvider;
  try {
    await serviceTx((db) => recordAnswerTest(db, {
      clientId: site.clientId,
      websiteId,
      platform: AI_PROVIDERS.includes(platform) ? platform : ("" as AiProvider),
      question: str(formData, "question"),
      testedOn: str(formData, "testedOn"),
      mentioned: str(formData, "mentioned") === "yes",
      citedUrl: optional(formData, "citedUrl"),
      answerExcerpt: optional(formData, "answerExcerpt"),
      actorUserId: access.user.id,
    }));
  } catch (error) {
    if (error instanceof AiVisibilityRuleError) back(websiteId, "questions", "test_invalid", { reason: error.message });
    throw error;
  }
  revalidatePath(PAGE);
  back(websiteId, "questions", "test_saved");
}

/** SEO-05.3 referrals: an administrator or manager prepares the GA4 session-source report for one preset window. */
export async function prepareReferralReportAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const days = Number(str(formData, "days"));
  const access = await requireAccess();
  const site = await scopedSite(access, websiteId);
  if (!site || !canManageRegistry(access) || ![7, 30, 90].includes(days)) back(websiteId, "visibility", "denied");
  const end = addDays(todaySgt(), -1);
  const start = addDays(end, 1 - days);
  const connection = await staffTx(access, async (db) => (await db.query<{ id: string }>(
    "select id from analytics_connections where website_id = $1 and provider = 'ga4' and status = 'connected' and disconnected_at is null limit 1",
    [websiteId],
  )).rows[0]);
  if (!connection) back(websiteId, "visibility", "no_ga4", { range: String(days) });
  await serviceTx((db) => enqueueJob(db, { clientId: site.clientId, websiteId, connectionId: connection.id, templateKey: "ga4.session_source", start, end }));
  revalidatePath(PAGE);
  back(websiteId, "visibility", "referrals_queued", { range: String(days) });
}
