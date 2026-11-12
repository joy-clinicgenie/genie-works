import { addDays, listWixEnquiryBindings, listWixFollowUpStatuses, resolveWixApiBaseUrl, type AccessProfile, type WixEnquiryBinding } from "@clinic-genie/db";
import { staffTx } from "@/lib/db";
import type { EnquiryFilters, EnquiryWindow, SubmissionDetail, SubmissionListItem, SubmissionStatus } from "@/lib/form-submissions";
import {
  canonicalUuid,
  labelsByTarget,
  mapWixAnswers,
  parseWixSubmission,
  parseWixSubmissionList,
  wixCreatedRange,
  wixEnquiryReference,
  type WixSubmissionRecord,
} from "@/lib/wix-form-map";

/** Real provider by default. resolveWixApiBaseUrl only ever allows a local mock, and never in a hosted environment. */
const wixApi = (path: string) => `${resolveWixApiBaseUrl()}${path}`;
const WIX_TOKEN_PATH = "/oauth2/token";
const WIX_QUERY_PATH = "/form-submission-service/v4/submissions/namespace/query";
const PAGE_LIMIT = 100;
const MAX_PAGES = 5;

export interface WixBreakdownSeed {
  clinicId: string;
  clinicName: string;
  websiteKey: string | null;
  formKey: string;
  attributionSource: string;
}

export interface WixEnquirySlice {
  configured: boolean;
  failed: boolean;
  notice: string | null;
  current: SubmissionListItem[];
  productionPrevious: WixBreakdownSeed[];
}

const NO_WIX: WixEnquirySlice = { configured: false, failed: false, notice: null, current: [], productionPrevious: [] };

const tokens = new Map<string, { token: string; expiresAt: number }>();
const tokenRequests = new Map<string, Promise<string | null>>();

export async function loadWixEnquirySlice(
  access: AccessProfile,
  scope: string[] | null,
  filters: EnquiryFilters,
  window?: EnquiryWindow,
): Promise<WixEnquirySlice> {
  if (!wixReadsAllowed()) return NO_WIX;
  const bindings = await staffTx(access, (db) => listWixEnquiryBindings(db, scope));
  if (bindings.length === 0) return NO_WIX;
  if (!process.env.FORMS_WIX_APP_ID || !process.env.FORMS_WIX_APP_SECRET) {
    return { configured: true, failed: true, notice: "A Wix form is connected, but the forms app is not configured on this server.", current: [], productionPrevious: [] };
  }
  const currentRange = rangeFor(window?.from ?? filters.from, window?.to ?? filters.to);
  const loaded = await Promise.all(bindings.map(async (binding) => {
    const [labels, current, previous] = await Promise.all([
      formLabels(binding),
      querySubmissions(binding, currentRange),
      binding.countsInTotals && window
        ? querySubmissions(binding, rangeFor(window.previousFrom, window.previousTo))
        : Promise.resolve(null),
    ]);
    return { binding, labels, current, previous };
  }));
  let failed = false;
  let truncated = false;
  const currentRows: Array<{ binding: WixEnquiryBinding; row: WixSubmissionRecord; labels: Map<string, string> }> = [];
  const previousRows: Array<{ binding: WixEnquiryBinding; row: WixSubmissionRecord }> = [];
  for (const item of loaded) {
    failed = failed || item.current.failed || Boolean(item.previous?.failed);
    truncated = truncated || item.current.truncated;
    for (const row of item.current.rows) currentRows.push({ binding: item.binding, row, labels: item.labels });
    if (!item.previous) continue;
    for (const row of item.previous.rows) previousRows.push({ binding: item.binding, row });
  }
  const statuses = await followUpStatuses(access, [...currentRows, ...previousRows].map((item) => item.row.id));
  const current = currentRows.flatMap((item) => {
    const status = statuses.get(item.row.id) ?? "new";
    const mapped = mapWixAnswers(item.row.answers, item.labels);
    if (!matches(item.binding, item.row, mapped, status, filters, scope, currentRange)) return [];
    return [toListItem(item.binding, item.row, mapped, status, filters.contact === true)];
  });
  const productionPrevious = previousRows.flatMap((item) => {
    if (!item.binding.countsInTotals) return [];
    const status = statuses.get(item.row.id) ?? "new";
    const mapped = mapWixAnswers(item.row.answers);
    const previousFilters = { ...filters, from: window?.previousFrom, to: window?.previousTo };
    if (!matches(item.binding, item.row, mapped, status, previousFilters, scope, rangeFor(window?.previousFrom, window?.previousTo))) return [];
    return [seed(item.binding)];
  });
  return {
    configured: true,
    failed,
    notice: noticeFor(failed, truncated),
    current,
    productionPrevious,
  };
}

const EMPTY_STATUS_COUNTS = (): Record<SubmissionStatus, number> => ({ new: 0, acknowledged: 0, closed: 0 });

/** Home-page totals. Production Wix forms only, and only ids plus follow-up status. */
export async function countWixEnquiryStatuses(
  access: AccessProfile,
  scope: string[] | null,
  window?: { from?: string | null; to?: string | null; clinicId?: string | null },
): Promise<{ configured: boolean; failed: boolean; notice: string | null; counts: Record<SubmissionStatus, number> }> {
  const counts = EMPTY_STATUS_COUNTS();
  if (!wixReadsAllowed()) return { configured: false, failed: false, notice: null, counts };
  const bindings = (await staffTx(access, (db) => listWixEnquiryBindings(db, scope)))
    .filter((binding) => binding.countsInTotals)
    .filter((binding) => !window?.clinicId || binding.clientSlug === window.clinicId);
  if (bindings.length === 0) return { configured: false, failed: false, notice: null, counts };
  if (!process.env.FORMS_WIX_APP_ID || !process.env.FORMS_WIX_APP_SECRET) {
    return { configured: true, failed: true, notice: "A Wix form is connected, but the forms app is not configured on this server.", counts };
  }
  const range = rangeFor(window?.from ?? undefined, window?.to ?? undefined);
  const loaded = await Promise.all(bindings.map(async (binding) => ({ binding, result: await querySubmissions(binding, range) })));
  const failed = loaded.some((item) => item.result.failed);
  const truncated = loaded.some((item) => item.result.truncated);
  const ids = loaded.flatMap((item) => item.result.rows.flatMap((row) => {
    if (row.formId !== item.binding.formId.toLowerCase()) return [];
    if (row.namespace && row.namespace !== item.binding.namespace) return [];
    return [row.id];
  }));
  const statuses = await followUpStatuses(access, ids);
  for (const id of ids) {
    const status = statuses.get(id) ?? "new";
    counts[status] += 1;
  }
  return { configured: true, failed, notice: noticeFor(failed, truncated), counts };
}

export async function readWixEnquiryDetail(
  access: AccessProfile,
  scope: string[] | null,
  id: string,
): Promise<{ detail: SubmissionDetail | null; failed: boolean }> {
  const submissionId = canonicalUuid(id);
  if (!submissionId || !wixReadsAllowed()) return { detail: null, failed: false };
  const bindings = (await staffTx(access, (db) => listWixEnquiryBindings(db, scope)))
    .filter((binding) => !scope || scope.includes(binding.clientSlug));
  if (bindings.length === 0) return { detail: null, failed: false };
  if (!process.env.FORMS_WIX_APP_ID || !process.env.FORMS_WIX_APP_SECRET) return { detail: null, failed: true };
  let failed = false;
  for (const binding of bindings) {
    const loaded = await getSubmission(binding, submissionId);
    failed = failed || loaded.failed;
    if (!loaded.row || loaded.row.formId !== binding.formId.toLowerCase()) continue;
    if (loaded.row.namespace && loaded.row.namespace !== binding.namespace) continue;
    const labels = await formLabels(binding);
    const mapped = mapWixAnswers(loaded.row.answers, labels);
    const status = (await followUpStatuses(access, [loaded.row.id])).get(loaded.row.id) ?? "new";
    const item = toListItem(binding, loaded.row, mapped, status, true);
    return {
      failed: false,
      detail: {
        ...item,
        contactNumber: mapped.phone ?? "",
        email: mapped.email,
        message: mapped.message,
        reason: mapped.reason,
        preferredDate: null,
        preferredTimeWindow: null,
        formVersion: 1,
        notification: null,
        source: "wix",
        notificationDelivery: "unavailable",
      },
    };
  }
  return { detail: null, failed };
}

/**
 * One connected Wix form, as the Forms view reports it. Live read, nothing stored.
 * The states are deliberately distinct: a site without the Wix Forms app is not a
 * permission failure, and a readable form with no submissions is not an error.
 */
export type WixFormState = "readable" | "empty" | "missing" | "unsupported" | "permission" | "unconfigured" | "disabled_read";

export interface WixFormProbe {
  state: WixFormState;
  boundSiteUrl: string | null;
  boundSiteName: string | null;
  boundSiteId: string | null;
  formName: string | null;
  active: boolean | null;
  fields: string[];
  submissions: number | null;
  more: boolean;
  checkedAt: Date | null;
}

interface ProbeSignals {
  credentials: boolean;
  token: boolean;
  formsStatus: number;
  namespaceRefused: boolean;
  formFound: boolean;
  submissionsStatus: number;
  submissions: number;
}

/** Pure, so the state table is testable without touching Wix. */
export function classifyWixForm(signals: ProbeSignals): WixFormState {
  if (!signals.credentials) return "unconfigured";
  if (signals.namespaceRefused) return "unsupported";
  if (!signals.token || signals.formsStatus === 401 || signals.formsStatus === 403) return "permission";
  if (signals.formsStatus !== 200) return "permission";
  if (!signals.formFound) return "missing";
  if (signals.submissionsStatus === 401 || signals.submissionsStatus === 403) return "permission";
  if (signals.submissionsStatus !== 200) return "permission";
  return signals.submissions > 0 ? "readable" : "empty";
}

/** True when Wix refused the namespace itself, which means the site has no Wix Forms app. */
function namespaceRefused(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" && message.includes("Permissions for given namespace not found");
}

function formFields(form: unknown): string[] {
  if (!form || typeof form !== "object") return [];
  const fields = (form as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) => {
    if (!field || typeof field !== "object") return [];
    const target = (field as { target?: unknown }).target;
    return typeof target === "string" && target ? [target] : [];
  });
}

export async function probeWixForm(binding: WixEnquiryBinding): Promise<WixFormProbe> {
  const idle: WixFormProbe = { state: "disabled_read", boundSiteUrl: null, boundSiteName: null, boundSiteId: null, formName: null, active: null, fields: [], submissions: null, more: false, checkedAt: null };
  if (!wixReadsAllowed()) return idle;
  const credentials = Boolean(process.env.FORMS_WIX_APP_ID && process.env.FORMS_WIX_APP_SECRET);
  if (!credentials) return { ...idle, state: "unconfigured" };
  const formId = canonicalUuid(binding.formId);
  const token = formId ? await accessToken(binding.instanceId) : null;
  const instance = token ? await wixFetch(wixApi("/apps/v1/instance"), token) : { ok: false, status: 0, body: null };
  const site = instance.ok && instance.body && typeof instance.body === "object"
    ? (instance.body as { site?: { url?: unknown; siteDisplayName?: unknown; siteId?: unknown } }).site
    : undefined;
  const forms = token
    ? await wixFetch(wixApi("/form-schema-service/v4/forms/query"), token, {
        query: { filter: { namespace: binding.namespace }, cursorPaging: { limit: PAGE_LIMIT } },
      })
    : { ok: false, status: 0, body: null };
  const refused = namespaceRefused(forms.body);
  const list = forms.ok && forms.body && typeof forms.body === "object" ? (forms.body as { forms?: unknown }).forms : null;
  const match = Array.isArray(list)
    ? list.find((form) => form && typeof form === "object" && String((form as { id?: unknown }).id ?? "").toLowerCase() === formId)
    : undefined;
  const properties = match && typeof match === "object" ? (match as { properties?: { name?: unknown; disabled?: unknown } }).properties : undefined;
  const submissions = match && token
    ? await wixFetch(wixApi(WIX_QUERY_PATH), token, {
        query: {
          filter: { $and: [{ namespace: binding.namespace }, { formId: binding.formId }] },
          sort: [{ fieldName: "createdDate", order: "DESC" }],
          cursorPaging: { limit: PAGE_LIMIT },
        },
      })
    : { ok: false, status: 0, body: null };
  const parsed = submissions.ok ? parseWixSubmissionList(submissions.body) : null;
  const state = classifyWixForm({
    credentials,
    token: Boolean(token),
    formsStatus: forms.status,
    namespaceRefused: refused,
    formFound: Boolean(match),
    submissionsStatus: submissions.status,
    submissions: parsed?.submissions.length ?? 0,
  });
  const read = state === "readable" || state === "empty";
  return {
    state,
    boundSiteUrl: typeof site?.url === "string" ? site.url : null,
    boundSiteName: typeof site?.siteDisplayName === "string" ? site.siteDisplayName : null,
    boundSiteId: typeof site?.siteId === "string" ? site.siteId : null,
    formName: typeof properties?.name === "string" ? properties.name : null,
    active: typeof properties?.disabled === "boolean" ? !properties.disabled : null,
    fields: formFields(match),
    submissions: read ? parsed?.submissions.length ?? 0 : null,
    more: Boolean(parsed?.next),
    checkedAt: read ? new Date() : null,
  };
}

function wixReadsAllowed(): boolean {
  return !process.env.VITEST && process.env.ANALYTICS_FIXTURE_MODE !== "1";
}

function rangeFor(from?: string, to?: string): { start: string; end: string } | null {
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  return wixCreatedRange(from, addDays(to, 1));
}

function noticeFor(failed: boolean, truncated: boolean): string | null {
  if (failed) return "A Wix form could not be read. Other websites are unchanged. Nothing was copied.";
  if (truncated) return "Only the latest 500 submissions in this period were read from Wix.";
  return null;
}

function seed(binding: WixEnquiryBinding): WixBreakdownSeed {
  return {
    clinicId: binding.clientSlug,
    clinicName: binding.clientName,
    websiteKey: binding.enquiryKey,
    formKey: binding.formKey,
    attributionSource: "",
  };
}

function toListItem(
  binding: WixEnquiryBinding,
  row: WixSubmissionRecord,
  mapped: ReturnType<typeof mapWixAnswers>,
  status: SubmissionStatus,
  contact: boolean,
): SubmissionListItem {
  return {
    id: row.id,
    reference: wixEnquiryReference(row.id),
    clinicId: binding.clientSlug,
    clinicName: binding.clientName,
    websiteKey: binding.enquiryKey,
    formKey: binding.formKey,
    submittedAt: new Date(row.createdDate),
    submitterName: mapped.name,
    status,
    notificationStatus: null,
    notificationDelivery: "unavailable",
    attributionSource: "",
    pagePath: null,
    isSynthetic: !binding.countsInTotals,
    source: "wix",
    contactNumber: contact ? mapped.phone : undefined,
    email: contact ? mapped.email : undefined,
  };
}

function matches(
  binding: WixEnquiryBinding,
  row: WixSubmissionRecord,
  mapped: ReturnType<typeof mapWixAnswers>,
  status: SubmissionStatus,
  filters: EnquiryFilters,
  scope: string[] | null,
  range: { start: string; end: string } | null,
): boolean {
  if (scope && !scope.includes(binding.clientSlug)) return false;
  if (row.formId !== binding.formId.toLowerCase()) return false;
  if (row.namespace && row.namespace !== binding.namespace) return false;
  if (filters.productionOnly && !binding.countsInTotals) return false;
  if (filters.clinicId && binding.clientSlug !== filters.clinicId) return false;
  if (filters.websiteKey && binding.enquiryKey !== filters.websiteKey) return false;
  if (filters.formKey && binding.formKey !== filters.formKey) return false;
  if (filters.status && status !== filters.status) return false;
  if (filters.notification && filters.notification !== "unavailable") return false;
  if (filters.reference) {
    const needle = filters.reference.toLowerCase();
    const reference = wixEnquiryReference(row.id).toLowerCase();
    if (!reference.includes(needle) && !row.id.includes(needle)) return false;
  }
  if (filters.person) {
    const needle = filters.person.toLowerCase();
    const haystack = [mapped.name, mapped.email ?? "", mapped.phone ?? ""].join("\n").toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (range) {
    const created = Date.parse(row.createdDate);
    if (Number.isNaN(created) || created < Date.parse(range.start) || created >= Date.parse(range.end)) return false;
  }
  return true;
}

async function followUpStatuses(access: AccessProfile, ids: string[]): Promise<Map<string, SubmissionStatus>> {
  const rows = await staffTx(access, (db) => listWixFollowUpStatuses(db, ids));
  return new Map(rows.map((row) => [row.externalId, row.status]));
}

async function formLabels(binding: WixEnquiryBinding): Promise<Map<string, string>> {
  const formId = canonicalUuid(binding.formId);
  if (!formId) return new Map();
  const token = await accessToken(binding.instanceId);
  if (!token) return new Map();
  const response = await wixFetch(wixApi(`/form-schema-service/v4/forms/${formId}`), token);
  if (!response.ok) return new Map();
  return labelsByTarget(response.body);
}

async function querySubmissions(
  binding: WixEnquiryBinding,
  range: { start: string; end: string } | null,
): Promise<{ rows: WixSubmissionRecord[]; failed: boolean; truncated: boolean }> {
  const token = await accessToken(binding.instanceId);
  if (!token) return { rows: [], failed: true, truncated: false };
  const rows: WixSubmissionRecord[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = cursor
      ? { query: { cursorPaging: { limit: PAGE_LIMIT, cursor } } }
      : {
          query: {
            filter: {
              $and: [
                { namespace: binding.namespace },
                { formId: binding.formId },
                ...(range ? [{ createdDate: { $gte: range.start } }, { createdDate: { $lt: range.end } }] : []),
              ],
            },
            sort: [{ fieldName: "createdDate", order: "DESC" }],
            cursorPaging: { limit: PAGE_LIMIT },
          },
        };
    const response = await wixFetch(wixApi(WIX_QUERY_PATH), token, body);
    if (!response.ok) return { rows, failed: response.status !== 404, truncated: false };
    const parsed = parseWixSubmissionList(response.body);
    rows.push(...parsed.submissions);
    if (!parsed.next || parsed.next === cursor) return { rows, failed: false, truncated: false };
    cursor = parsed.next;
  }
  return { rows, failed: false, truncated: true };
}

async function getSubmission(
  binding: WixEnquiryBinding,
  id: string,
): Promise<{ row: WixSubmissionRecord | null; failed: boolean }> {
  const token = await accessToken(binding.instanceId);
  if (!token) return { row: null, failed: true };
  const response = await wixFetch(wixApi(`/form-submission-service/v4/submissions/${id}`), token);
  if (response.status === 404) return { row: null, failed: false };
  if (!response.ok) return { row: null, failed: true };
  return { row: parseWixSubmission(response.body), failed: false };
}

async function accessToken(instanceId: string): Promise<string | null> {
  const instance = canonicalUuid(instanceId);
  const clientId = process.env.FORMS_WIX_APP_ID;
  const clientSecret = process.env.FORMS_WIX_APP_SECRET;
  if (!instance || !clientId || !clientSecret) return null;
  const cached = tokens.get(instance);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const pending = tokenRequests.get(instance);
  if (pending) return pending;
  const request = requestAccessToken(instance, clientId, clientSecret);
  tokenRequests.set(instance, request);
  try {
    return await request;
  } finally {
    tokenRequests.delete(instance);
  }
}

async function requestAccessToken(instance: string, clientId: string, clientSecret: string): Promise<string | null> {
  const response = await wixFetch(wixApi(WIX_TOKEN_PATH), null, {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    instance_id: instance,
  });
  if (!response.ok || !response.body || typeof response.body !== "object") return null;
  const record = response.body as Record<string, unknown>;
  const token = typeof record.access_token === "string" ? record.access_token : typeof record.accessToken === "string" ? record.accessToken : null;
  if (!token) return null;
  const expires = typeof record.expires_in === "number" ? record.expires_in : 300;
  const ttl = Math.min(4 * 60 * 60, Math.max(30, expires - 60));
  tokens.set(instance, { token, expiresAt: Date.now() + ttl * 1000 });
  return token;
}

async function wixFetch(url: string, token: string | null, body?: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = null;
      }
    }
    return { ok: response.ok, status: response.status, body: parsed };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}
