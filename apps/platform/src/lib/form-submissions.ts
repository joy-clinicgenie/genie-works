import { randomBytes } from "node:crypto";
import pg from "pg";
import { canManageRegistry, enquiryStatusCountQuery, formatDateTime, setEnquiryFollowUp, todaySgt, websiteFormConfigPresent, type AccessProfile } from "@clinic-genie/db";
import { customWindow, periodRange } from "@/lib/period-range";

const STATUSES = ["new", "acknowledged", "closed"] as const;
export type SubmissionStatus = (typeof STATUSES)[number];

export const ENQUIRY_PAGE_SIZE = 25;

export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  closed: "Closed",
};

export const SOURCE_LABEL: Record<string, string> = {
  direct: "Direct",
  organic: "Organic",
  referral: "Referral",
  campaign: "Campaign",
};

const NOTIFICATION_FILTERS = ["pending", "sent", "failed", "unconfigured", "none"] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export interface SubmissionListItem {
  id: string;
  reference: string;
  clinicId: string;
  clinicName: string;
  websiteKey: string | null;
  formKey: string;
  submittedAt: Date;
  submitterName: string;
  status: SubmissionStatus;
  notificationStatus: NotificationStatus | null;
  attributionSource: string;
  pagePath: string | null;
  isSynthetic: boolean;
  contactNumber?: string | null;
  email?: string | null;
}

export interface SubmissionDetail extends SubmissionListItem {
  contactNumber: string;
  email: string | null;
  message: string | null;
  reason: string;
  preferredDate: string | null;
  preferredTimeWindow: string | null;
  formVersion: number;
  notification: ClinicNotification | null;
}

export interface SubmissionClinic {
  id: string;
  name: string;
}

export interface EnquiryWindow {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
}

export interface EnquiryBreakdownRow {
  key: string;
  label: string;
  current: number;
  previous: number;
}

export interface EnquiryBoard {
  connected: boolean;
  items: SubmissionListItem[];
  total: number;
  page: number;
  pageSize: number;
  clinics: SubmissionClinic[];
  websites: Array<{ key: string; clinicId: string }>;
  currentTotal: number;
  previousTotal: number;
  breakdowns: {
    client: EnquiryBreakdownRow[];
    website: EnquiryBreakdownRow[];
    form: EnquiryBreakdownRow[];
    source: EnquiryBreakdownRow[];
  };
}

export interface EnquiryFilters {
  clinicId?: string;
  websiteKey?: string;
  formKey?: string;
  status?: SubmissionStatus;
  notification?: NotificationFilter;
  reference?: string;
  person?: string;
  from?: string;
  to?: string;
  page?: number | "all";
  pageSize?: number;
  /** Export path. The working list keeps demonstration rows. */
  productionOnly?: boolean;
  contact?: boolean;
}

const FORM_NAMES: Record<string, string> = {
  "appointment-enquiry": "Appointment enquiry",
  contact: "Contact",
};

export function formName(key: string): string {
  return FORM_NAMES[key] ?? key.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function sourceLabel(key: string | null | undefined): string {
  if (!key) return "Unknown / not captured";
  return SOURCE_LABEL[key] ?? "Unknown / not captured";
}

export function submissionStatus(value: string | undefined): SubmissionStatus | undefined {
  return STATUSES.find((status) => status === value);
}

export function notificationFilter(value: string | undefined): NotificationFilter | undefined {
  return NOTIFICATION_FILTERS.find((status) => status === value);
}

export function submissionFormKey(value: string | undefined): string | undefined {
  return value && /^[a-z0-9-]{1,64}$/.test(value) ? value : undefined;
}

export function submissionWebsiteKey(value: string | undefined): string | undefined {
  return value && /^[a-z0-9-]{1,64}$/.test(value) ? value : undefined;
}

/** Null means every clinic. A list means only those website clinic ids. */
export function submissionClinicScope(access: AccessProfile): string[] | null {
  if (canManageRegistry(access)) return null;
  return access.memberships.map((membership) => membership.client_slug);
}

/** Clinics whose follow-up status this person may change. An empty list means none. */
export function submissionEditScope(access: AccessProfile): string[] | null {
  if (canManageRegistry(access)) return null;
  if (access.user.platform_role === "specialist") return access.memberships.map((membership) => membership.client_slug);
  return [];
}

export function canSearchEnquiryPerson(access: AccessProfile): boolean {
  return access.user.platform_role === "admin" || access.user.platform_role === "manager" || access.user.platform_role === "specialist";
}

/** This month, or a valid custom range, and the equal-length period before it. */
export function enquiryWindow(from?: string, to?: string, today = todaySgt()): EnquiryWindow {
  const chosen = from || to ? customWindow(from, to, today) : null;
  const range = chosen ?? periodRange("month", today);
  return {
    from: range.current.start,
    to: range.current.end,
    previousFrom: range.previous.start,
    previousTo: range.previous.end,
  };
}

/** Numerical change. A zero previous period has no percentage. */
export function enquiryChange(current: number, previous: number): string {
  const delta = current - previous;
  if (delta === 0) return "No change from the previous period";
  const amount = `${Math.abs(delta)} ${delta > 0 ? "more" : "fewer"} than the previous period`;
  if (previous === 0) return amount;
  const pct = Math.round((delta / previous) * 100);
  const signed = `${pct > 0 ? "+" : ""}${pct}%`;
  return `${amount} (${signed})`;
}

export function enquiryPage(page: number | "all", pageSize = ENQUIRY_PAGE_SIZE): { limit: number | null; offset: number; page: number } {
  if (page === "all") return { limit: null, offset: 0, page: 1 };
  const safe = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  return { limit: pageSize, offset: (safe - 1) * pageSize, page: safe };
}

export function notificationLabel(status: NotificationStatus | null): string {
  if (status === "sent") return "Sent";
  if (status === "pending") return "Pending";
  if (status === "failed" || status === "exhausted") return "Failed";
  if (status === "unconfigured") return "Not configured";
  return "No notification recorded";
}

const FAILURE_EXPLANATIONS: Record<string, string> = {
  sink_rejected: "The mail sink rejected the message.",
  mailbox_unconfigured: "No clinic mailbox is configured.",
};

/** Plain-language meaning of a stored error code. The raw provider message is not used. */
export function notificationFailure(code: string | null | undefined): string | null {
  if (!code) return null;
  return FAILURE_EXPLANATIONS[code] ?? "No explanation is recorded for this code.";
}

/** Sender attempts are automatic unless the recorded trigger names a staff or manual retry. */
export function attemptOrigin(triggeredBy: string | null | undefined): "Manual" | "Automatic" | null {
  if (!triggeredBy) return null;
  const value = triggeredBy.toLowerCase();
  if (value.includes("manual") || value.includes("staff")) return "Manual";
  return "Automatic";
}

function likeContains(value: string): string {
  return `%${value.replace(/[%_\\]/g, "\\$&")}%`;
}

const NOTIFICATION_JOIN = `
  left join lateral (
    select o.status
    from notification_outbox o
    where o.enquiry_id = e.id and o.event_type = 'clinic_notification'
    order by o.updated_at desc
    limit 1
  ) n on true
`;

function enquiryWhere(
  scope: string[] | null,
  filters: EnquiryFilters,
  dates?: { from: string; to: string } | { ranges: Array<{ from: string; to: string }> },
  productionOnly = false,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [scope];
  const clauses = ["($1::text[] is null or e.clinic_id = any($1))"];
  if (productionOnly) clauses.push("e.is_synthetic = false");
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.clinicId) clauses.push(`e.clinic_id = ${add(filters.clinicId)}`);
  if (filters.websiteKey) clauses.push(`e.website_key = ${add(filters.websiteKey)}`);
  if (filters.formKey) clauses.push(`e.form_key = ${add(filters.formKey)}`);
  if (filters.status) clauses.push(`e.status = ${add(filters.status)}`);
  if (filters.reference) clauses.push(`e.public_reference ilike ${add(likeContains(filters.reference))} escape '\\'`);
  if (filters.person) {
    const pattern = likeContains(filters.person);
    const name = add(pattern);
    const email = add(pattern);
    const phone = add(pattern);
    clauses.push(`(e.name ilike ${name} escape '\\' or e.email ilike ${email} escape '\\' or e.contact_number ilike ${phone} escape '\\')`);
  }
  if (filters.notification === "none") clauses.push("n.status is null");
  else if (filters.notification === "failed") clauses.push("n.status in ('failed', 'exhausted')");
  else if (filters.notification) clauses.push(`n.status = ${add(filters.notification)}`);
  if (dates && "ranges" in dates) {
    const parts = dates.ranges.map((range) => `(e.created_at at time zone 'Asia/Singapore')::date between ${add(range.from)}::date and ${add(range.to)}::date`);
    clauses.push(`(${parts.join(" or ")})`);
  } else if (dates && dates.from && dates.to) {
    clauses.push(`(e.created_at at time zone 'Asia/Singapore')::date between ${add(dates.from)}::date and ${add(dates.to)}::date`);
  }
  return { sql: clauses.join(" and "), params };
}

const globalForEnquiry = globalThis as unknown as { enquiryPool?: pg.Pool };

export async function enquiryConnection(): Promise<{ configured: boolean; reachable: boolean }> {
  const pool = enquiryPool();
  if (!pool) return { configured: false, reachable: false };
  try {
    await pool.query("select 1");
    return { configured: true, reachable: true };
  } catch {
    return { configured: true, reachable: false };
  }
}

function enquiryPool(): pg.Pool | null {
  const url = process.env.ENQUIRY_DATABASE_URL?.trim();
  if (!url) return null;
  if (!globalForEnquiry.enquiryPool) {
    globalForEnquiry.enquiryPool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 2000 });
  }
  return globalForEnquiry.enquiryPool;
}

async function readEnquiry<T>(query: string, params: unknown[]): Promise<T[] | null> {
  const pool = enquiryPool();
  if (!pool) return null;
  try {
    const result = await pool.query(query, params);
    return result.rows as T[];
  } catch {
    return null;
  }
}

interface ListRow {
  id: string;
  public_reference: string;
  clinic_id: string;
  clinic_name: string;
  website_key: string | null;
  form_key: string;
  created_at: Date;
  name: string;
  status: SubmissionStatus;
  notification_status: NotificationStatus | null;
  attribution_source: string | null;
  page_path: string | null;
  is_synthetic: boolean;
  contact_number?: string | null;
  email?: string | null;
}

interface DetailRow extends ListRow {
  form_version: number;
  contact_number: string;
  email: string | null;
  message: string | null;
  reason: string;
  preferred_date: string | null;
  preferred_time_window: string | null;
}

function toListItem(row: ListRow): SubmissionListItem {
  return {
    id: row.id,
    reference: row.public_reference,
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
    websiteKey: row.website_key,
    formKey: row.form_key,
    submittedAt: row.created_at,
    submitterName: row.name,
    status: row.status,
    notificationStatus: row.notification_status,
    attributionSource: row.attribution_source ?? "",
    pagePath: row.page_path,
    isSynthetic: row.is_synthetic,
    contactNumber: row.contact_number,
    email: row.email,
  };
}

const LIST_COLUMNS = `e.id, e.public_reference, e.clinic_id, c.display_name as clinic_name, e.website_key, e.form_key,
  e.created_at, e.name, e.status, n.status as notification_status, e.attribution_source, e.page_path, e.is_synthetic`;

export async function submissionStatusCounts(
  scope: string[] | null,
  window?: { from?: string | null; to?: string | null; clinicId?: string | null },
): Promise<{ connected: true; counts: Record<SubmissionStatus, number> } | { connected: false }> {
  const query = enquiryStatusCountQuery(scope, window);
  const rows = await readEnquiry<{ status: SubmissionStatus; count: number }>(query.sql, query.params);
  if (!rows) return { connected: false };
  const counts: Record<SubmissionStatus, number> = { new: 0, acknowledged: 0, closed: 0 };
  for (const row of rows) if (row.status in counts) counts[row.status] = Number(row.count);
  return { connected: true, counts };
}

export async function notificationAttention(scope: string[] | null, clinicId?: string | null): Promise<{ connected: true; pending: number; failed: number; unconfigured: number } | { connected: false }> {
  const rows = await readEnquiry<{ status: string; count: number }>(
    `select status, count(*)::int as count from notification_outbox
     where event_type = 'clinic_notification'
       and ($1::text[] is null or clinic_id = any($1))
       and ($2::text is null or clinic_id = $2)
     group by status`,
    [scope, clinicId || null],
  );
  if (!rows) return { connected: false };
  const count = (status: string) => Number(rows.find((row) => row.status === status)?.count ?? 0);
  return { connected: true, pending: count("pending"), failed: count("failed") + count("exhausted"), unconfigured: count("unconfigured") };
}

export async function listSubmissionForms(scope: string[] | null): Promise<Array<{ key: string; name: string }>> {
  const rows = await readEnquiry<{ form_key: string }>(
    `select distinct form_key from enquiries
     where ($1::text[] is null or clinic_id = any($1))
     order by form_key`,
    [scope],
  );
  return (rows ?? []).map((row) => ({ key: row.form_key, name: formName(row.form_key) }));
}

export async function listDiscoveredForms(scope: string[] | null): Promise<Array<{ clinicId: string; websiteKey: string | null; formKey: string; pagePath: string | null }>> {
  const rows = await readEnquiry<{ clinic_id: string; website_key: string | null; form_key: string; page_path: string | null }>(
    `select e.clinic_id, e.website_key, e.form_key,
            (array_agg(e.page_path order by e.created_at desc) filter (where e.page_path is not null))[1] as page_path
     from enquiries e
     where ($1::text[] is null or e.clinic_id = any($1))
     group by e.clinic_id, e.website_key, e.form_key
     order by e.clinic_id, e.form_key`,
    [scope],
  );
  return (rows ?? []).map((row) => ({ clinicId: row.clinic_id, websiteKey: row.website_key, formKey: row.form_key, pagePath: row.page_path }));
}

function rollup(rows: Array<{ period: string; key: string; label: string; count: number }>, keyName: "client" | "website" | "form" | "source"): EnquiryBreakdownRow[] {
  const map = new Map<string, EnquiryBreakdownRow>();
  for (const row of rows) {
    const current = map.get(row.key) ?? { key: row.key, label: row.label, current: 0, previous: 0 };
    if (row.period === "current") current.current += Number(row.count);
    else current.previous += Number(row.count);
    if (!current.label) current.label = row.label;
    map.set(row.key, current);
  }
  return [...map.values()]
    .filter((row) => row.current > 0 || row.previous > 0)
    .sort((a, b) => b.current - a.current || a.label.localeCompare(b.label))
    .map((row) => ({ ...row, label: keyName === "form" ? formName(row.label) : keyName === "source" ? sourceLabel(row.label) : row.label || "Not recorded" }));
}

export async function listEnquiryBoard(scope: string[] | null, filters: EnquiryFilters, window?: EnquiryWindow): Promise<EnquiryBoard> {
  const paging = enquiryPage(filters.page ?? 1, filters.pageSize ?? ENQUIRY_PAGE_SIZE);
  const currentDates = window ? { from: window.from, to: window.to } : undefined;
  const listProduction = filters.productionOnly === true;
  const listWhere = enquiryWhere(scope, filters, currentDates, listProduction);
  const limitSql = paging.limit === null ? "" : ` limit $${listWhere.params.length + 1} offset $${listWhere.params.length + 2}`;
  const listParams = paging.limit === null ? listWhere.params : [...listWhere.params, paging.limit, paging.offset];
  const contactColumns = filters.contact ? ", e.contact_number, e.email" : "";
  const rows = await readEnquiry<ListRow>(
    `select ${LIST_COLUMNS}${contactColumns}
     from enquiries e
     join clinics c on c.id = e.clinic_id
     ${NOTIFICATION_JOIN}
     where ${listWhere.sql}
     order by e.created_at desc
     ${limitSql}`,
    listParams,
  );
  if (!rows) {
    return { connected: false, items: [], total: 0, page: 1, pageSize: paging.limit ?? ENQUIRY_PAGE_SIZE, clinics: [], websites: [], currentTotal: 0, previousTotal: 0, breakdowns: { client: [], website: [], form: [], source: [] } };
  }
  const countWhere = enquiryWhere(scope, filters, currentDates, listProduction);
  const countRows = await readEnquiry<{ count: number }>(
    `select count(*)::int as count
     from enquiries e
     join clinics c on c.id = e.clinic_id
     ${NOTIFICATION_JOIN}
     where ${countWhere.sql}`,
    countWhere.params,
  );
  const clinics = await readEnquiry<{ id: string; display_name: string }>(
    `select c.id, c.display_name
     from clinics c
     where exists (select 1 from enquiries e where e.clinic_id = c.id)
       and ($1::text[] is null or c.id = any($1))
     order by c.display_name`,
    [scope],
  );
  const websites = await readEnquiry<{ clinic_id: string; website_key: string }>(
    `select distinct clinic_id, website_key
     from enquiries
     where website_key is not null
       and ($1::text[] is null or clinic_id = any($1))
     order by website_key`,
    [scope],
  );
  let currentTotal = Number(countRows?.[0]?.count ?? 0);
  let previousTotal = 0;
  let breakdowns: EnquiryBoard["breakdowns"] = { client: [], website: [], form: [], source: [] };
  if (window) {
    const productionWhere = enquiryWhere(scope, filters, currentDates, true);
    const productionRows = await readEnquiry<{ count: number }>(
      `select count(*)::int as count
       from enquiries e
       join clinics c on c.id = e.clinic_id
       ${NOTIFICATION_JOIN}
       where ${productionWhere.sql}`,
      productionWhere.params,
    );
    if (productionRows) currentTotal = Number(productionRows[0]?.count ?? 0);
    const both = enquiryWhere(scope, filters, { ranges: [{ from: window.from, to: window.to }, { from: window.previousFrom, to: window.previousTo }] }, true);
    const fromRef = `$${both.params.length + 1}`;
    const toRef = `$${both.params.length + 2}`;
    const grouped = await readEnquiry<{ period: string; clinic_id: string; clinic_name: string; website_key: string | null; form_key: string; attribution_source: string | null; count: number }>(
      `select case when (e.created_at at time zone 'Asia/Singapore')::date between ${fromRef}::date and ${toRef}::date then 'current' else 'previous' end as period,
              e.clinic_id, c.display_name as clinic_name, e.website_key, e.form_key, e.attribution_source, count(*)::int as count
       from enquiries e
       join clinics c on c.id = e.clinic_id
       ${NOTIFICATION_JOIN}
       where ${both.sql}
       group by 1, e.clinic_id, c.display_name, e.website_key, e.form_key, e.attribution_source`,
      [...both.params, window.from, window.to],
    );
    if (grouped) {
      previousTotal = grouped.filter((row) => row.period === "previous").reduce((sum, row) => sum + Number(row.count), 0);
    }
    const tuples = grouped ?? [];
    breakdowns = {
      client: rollup(tuples.map((row) => ({ period: row.period, key: row.clinic_id, label: row.clinic_name, count: row.count })), "client"),
      website: rollup(tuples.map((row) => ({ period: row.period, key: row.website_key || "none", label: row.website_key || "Not recorded", count: row.count })), "website"),
      form: rollup(tuples.map((row) => ({ period: row.period, key: row.form_key, label: row.form_key, count: row.count })), "form"),
      source: rollup(tuples.map((row) => {
        const known = sourceLabel(row.attribution_source) !== "Unknown / not captured";
        return { period: row.period, key: known ? row.attribution_source || "unknown" : "unknown", label: known ? row.attribution_source || "" : "", count: row.count };
      }), "source"),
    };
  }
  return {
    connected: true,
    items: rows.map(toListItem),
    total: Number(countRows?.[0]?.count ?? rows.length),
    page: paging.page,
    pageSize: paging.limit ?? ENQUIRY_PAGE_SIZE,
    clinics: (clinics ?? []).map((clinic) => ({ id: clinic.id, name: clinic.display_name })),
    websites: (websites ?? []).map((site) => ({ key: site.website_key, clinicId: site.clinic_id })),
    currentTotal,
    previousTotal,
    breakdowns,
  };
}

export async function listFormSubmissions(scope: string[] | null, filters: EnquiryFilters = {}): Promise<EnquiryBoard> {
  return listEnquiryBoard(scope, filters);
}

export async function getFormSubmission(scope: string[] | null, id: string): Promise<SubmissionDetail | null | "unavailable"> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const rows = await readEnquiry<DetailRow>(
    `select ${LIST_COLUMNS}, e.form_version, e.contact_number, e.email, e.message, e.reason,
            e.preferred_date::text as preferred_date, e.preferred_time_window
     from enquiries e
     join clinics c on c.id = e.clinic_id
     ${NOTIFICATION_JOIN}
     where e.id = $1
       and ($2::text[] is null or e.clinic_id = any($2))`,
    [id, scope],
  );
  if (!rows) return "unavailable";
  const row = rows[0];
  if (!row) return null;
  return {
    ...toListItem(row),
    formVersion: row.form_version,
    contactNumber: row.contact_number,
    email: row.email,
    message: row.message,
    reason: row.reason,
    preferredDate: row.preferred_date,
    preferredTimeWindow: row.preferred_time_window,
    notification: await readClinicNotification(row.id),
  };
}

/** Writes follow-up status on the clinic-website enquiry. Does not copy the enquiry body. */
export async function updateEnquiryStatus(
  scope: string[] | null,
  id: string,
  fromStatus: SubmissionStatus,
  toStatus: SubmissionStatus,
): Promise<{ id: string; clinicId: string; websiteKey: string | null; reference: string } | null | "unavailable"> {
  const pool = enquiryPool();
  if (!pool) return "unavailable";
  try {
    return await setEnquiryFollowUp(pool, { id, fromStatus, toStatus, scope });
  } catch {
    return "unavailable";
  }
}

export async function probeWebsiteFormConfig(): Promise<"missing" | "present" | "unavailable"> {
  const pool = enquiryPool();
  if (!pool) return "unavailable";
  const present = await websiteFormConfigPresent(pool);
  if (present === null) return "unavailable";
  return present ? "present" : "missing";
}

const NOTIFICATION_STATUSES = ["pending", "sent", "failed", "exhausted", "unconfigured"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export interface SenderAttempt {
  id: string;
  attemptedAt: Date;
  outcome: string;
  origin: "Manual" | "Automatic";
  errorCode: string | null;
}

export interface ClinicNotification {
  id: string;
  status: NotificationStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  errorCode: string | null;
  senderAttempts: SenderAttempt[];
}

export interface NotificationRow {
  id: string;
  enquiryId: string;
  clinicId: string;
  clinicName: string;
  websiteKey: string | null;
  reference: string;
  submittedAt: Date;
  status: NotificationStatus;
  attempts: number;
  errorCode: string | null;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  latestOrigin: "Manual" | "Automatic" | null;
  updatedAt: Date;
}

export interface NotificationList {
  connected: true;
  items: NotificationRow[];
  total: number;
  page: number;
  pageSize: number;
  clinics: Array<{ id: string; name: string }>;
  websites: Array<{ key: string; clinicId: string }>;
}

interface NotificationQueryRow {
  id: string;
  enquiry_id: string;
  clinic_id: string;
  clinic_name: string;
  website_key: string | null;
  public_reference: string;
  submitted_at: Date;
  status: NotificationStatus;
  attempts: number;
  last_error_code: string | null;
  last_attempt_at: Date | null;
  next_attempt_at: Date | null;
  updated_at: Date;
  triggered_by?: string | null;
}

async function readClinicNotification(enquiryId: string): Promise<ClinicNotification | null> {
  const rows = await readEnquiry<{
    id: string;
    status: NotificationStatus;
    attempts: number;
    last_attempt_at: Date | null;
    next_attempt_at: Date | null;
    last_error_code: string | null;
  }>(
    `select id, status, attempts, coalesce(last_attempt_at, sent_at) as last_attempt_at, next_attempt_at, last_error_code
     from notification_outbox
     where enquiry_id = $1 and event_type = 'clinic_notification'
     order by updated_at desc
     limit 1`,
    [enquiryId],
  );
  const row = rows?.[0];
  if (!row) return null;
  const attempts = await readEnquiry<{ id: string; attempted_at: Date; outcome: string; triggered_by: string; error_code: string | null }>(
    `select id, attempted_at, outcome, triggered_by, error_code
     from notification_attempts
     where outbox_id = $1
     order by attempted_at desc`,
    [row.id],
  );
  return {
    id: row.id,
    status: row.status,
    attempts: Number(row.attempts),
    lastAttemptAt: row.last_attempt_at,
    nextAttemptAt: row.next_attempt_at,
    errorCode: row.last_error_code,
    senderAttempts: (attempts ?? []).flatMap((attempt) => {
      const origin = attemptOrigin(attempt.triggered_by);
      if (!origin) return [];
      return [{ id: attempt.id, attemptedAt: attempt.attempted_at, outcome: attempt.outcome, origin, errorCode: attempt.error_code }];
    }),
  };
}

export interface NotificationFilters {
  clinicId?: string;
  websiteKey?: string;
  status?: NotificationFilter;
  from?: string;
  to?: string;
  page?: number;
}

function notificationWhere(scope: string[] | null, filters: NotificationFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [scope];
  const clauses = ["o.event_type = 'clinic_notification'", "($1::text[] is null or o.clinic_id = any($1))"];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.clinicId) clauses.push(`o.clinic_id = ${add(filters.clinicId)}`);
  if (filters.websiteKey) clauses.push(`e.website_key = ${add(filters.websiteKey)}`);
  if (filters.status === "failed") clauses.push("o.status in ('failed', 'exhausted')");
  else if (filters.status && filters.status !== "none") clauses.push(`o.status = ${add(filters.status)}`);
  if (filters.from && filters.to) {
    clauses.push(`(e.created_at at time zone 'Asia/Singapore')::date between ${add(filters.from)}::date and ${add(filters.to)}::date`);
  }
  return { sql: clauses.join(" and "), params };
}

function toNotificationRow(row: NotificationQueryRow): NotificationRow {
  return {
    id: row.id,
    enquiryId: row.enquiry_id,
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
    websiteKey: row.website_key,
    reference: row.public_reference,
    submittedAt: row.submitted_at,
    status: row.status,
    attempts: Number(row.attempts),
    errorCode: row.last_error_code,
    lastAttemptAt: row.last_attempt_at,
    nextAttemptAt: row.next_attempt_at,
    latestOrigin: attemptOrigin(row.triggered_by),
    updatedAt: row.updated_at,
  };
}

export function canRetryNotifications(access: AccessProfile): boolean {
  return access.user.platform_role === "admin" || access.user.platform_role === "manager" || access.user.platform_role === "specialist";
}

export async function listNotifications(scope: string[] | null, filters: NotificationFilters = {}): Promise<NotificationList | { connected: false }> {
  const paging = enquiryPage(filters.page ?? 1, ENQUIRY_PAGE_SIZE);
  const where = notificationWhere(scope, filters);
  const limit = where.params.length + 1;
  const offset = where.params.length + 2;
  const select = `o.id, o.enquiry_id, o.clinic_id, c.display_name as clinic_name, e.website_key, e.public_reference,
     e.created_at as submitted_at, o.status, o.attempts, o.last_error_code,
     coalesce(o.last_attempt_at, o.sent_at) as last_attempt_at, o.next_attempt_at, o.updated_at`;
  const from = `from notification_outbox o
     join clinics c on c.id = o.clinic_id
     join enquiries e on e.id = o.enquiry_id`;
  const rich = await readEnquiry<NotificationQueryRow>(
    `select ${select}, a.triggered_by
     ${from}
     left join lateral (
       select triggered_by from notification_attempts na
       where na.outbox_id = o.id
       order by na.attempted_at desc
       limit 1
     ) a on true
     where ${where.sql}
     order by o.updated_at desc
     limit $${limit} offset $${offset}`,
    [...where.params, paging.limit, paging.offset],
  );
  const rows = rich ?? await readEnquiry<NotificationQueryRow>(
    `select ${select}
     ${from}
     where ${where.sql}
     order by o.updated_at desc
     limit $${limit} offset $${offset}`,
    [...where.params, paging.limit, paging.offset],
  );
  if (!rows) return { connected: false };
  const count = await readEnquiry<{ count: number }>(
    `select count(*)::int as count
     ${from}
     where ${where.sql}`,
    where.params,
  );
  const clinics = await readEnquiry<{ id: string; display_name: string }>(
    `select distinct c.id, c.display_name
     from notification_outbox o
     join clinics c on c.id = o.clinic_id
     where o.event_type = 'clinic_notification'
       and ($1::text[] is null or o.clinic_id = any($1))
     order by c.display_name`,
    [scope],
  );
  const websites = await readEnquiry<{ clinic_id: string; website_key: string }>(
    `select distinct e.clinic_id, e.website_key
     from notification_outbox o
     join enquiries e on e.id = o.enquiry_id
     where o.event_type = 'clinic_notification'
       and e.website_key is not null
       and ($1::text[] is null or o.clinic_id = any($1))
     order by e.website_key`,
    [scope],
  );
  return {
    connected: true,
    total: Number(count?.[0]?.count ?? rows.length),
    page: paging.page,
    pageSize: ENQUIRY_PAGE_SIZE,
    items: rows.map(toNotificationRow),
    clinics: (clinics ?? []).map((clinic) => ({ id: clinic.id, name: clinic.display_name })),
    websites: (websites ?? []).map((site) => ({ key: site.website_key, clinicId: site.clinic_id })),
  };
}

/** Puts an existing failed notification back to pending. Does not create an enquiry. */
export async function retryNotification(scope: string[] | null, id: string): Promise<{ id: string; clinicId: string; enquiryId: string } | null | "unavailable"> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const pool = enquiryPool();
  if (!pool) return "unavailable";
  try {
    const result = await pool.query<{ id: string; clinic_id: string; enquiry_id: string }>(
      `update notification_outbox
       set status = 'pending', next_attempt_at = now(), leased_until = null, updated_at = now()
       where id = $1
         and event_type = 'clinic_notification'
         and status in ('failed', 'exhausted')
         and ($2::text[] is null or clinic_id = any($2))
       returning id, clinic_id, enquiry_id`,
      [id, scope],
    );
    const row = result.rows[0];
    return row ? { id: row.id, clinicId: row.clinic_id, enquiryId: row.enquiry_id } : null;
  } catch {
    return "unavailable";
  }
}

/** Stores one labelled synthetic enquiry. Returns the new id and reference, or why it was not stored. */
export async function createTestSubmission(clinicId: string): Promise<{ id: string; reference: string } | "not_connected" | "rejected"> {
  const pool = enquiryPool();
  if (!pool) return "not_connected";
  if (!/^[a-z0-9-]{1,64}$/.test(clinicId)) return "rejected";
  const reference = `TEST-${randomBytes(5).toString("hex").toUpperCase()}`;
  const idempotencyKey = `test-${randomBytes(12).toString("hex")}`;
  try {
    const result = await pool.query<{ id: string }>(
      `insert into enquiries (
         public_reference, clinic_id, form_key, form_version, idempotency_key, payload_digest,
         name, contact_number, reason, notice_version, consent_acknowledged_at, is_synthetic
       ) values ($1, $2, 'appointment-enquiry', 1, $3, 'test', 'Test submission', '00000000', 'Test submission', 'test', now(), true)
       returning id`,
      [reference, clinicId, idempotencyKey],
    );
    const id = result.rows[0]?.id;
    return id ? { id, reference } : "rejected";
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "23503" || code === "23514" || code === "23505") return "rejected";
    return "not_connected";
  }
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/** Production export. Contact details are optional. Message and other free text are never included. */
export function enquiryCsv(rows: SubmissionListItem[], websiteNames: Map<string, string> = new Map(), options: { contact?: boolean } = {}): string {
  const contact = options.contact === true;
  const header = ["Received", "Reference", "Client", "Website", "Form"];
  if (contact) header.push("Name", "Telephone", "Email");
  header.push("Follow-up status", "Notification");
  const lines = rows.filter((row) => !row.isSynthetic).map((row) => {
    const cells = [
      formatDateTime(row.submittedAt),
      row.reference,
      row.clinicName,
      row.websiteKey ? websiteNames.get(row.websiteKey) ?? row.websiteKey : "Not recorded",
      formName(row.formKey),
    ];
    if (contact) cells.push(row.submitterName, row.contactNumber ?? "", row.email ?? "");
    cells.push(STATUS_LABEL[row.status], notificationLabel(row.notificationStatus));
    return cells.map(csvCell).join(",");
  });
  return [header.join(","), ...lines].join("\n");
}
