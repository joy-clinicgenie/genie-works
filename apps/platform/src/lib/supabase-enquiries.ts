import pg from "pg";
import { assertSupabaseEnquiryUrl, getSupabaseEnquiryWebsite, listExternalFollowUpStatuses, type AccessProfile, type SupabaseEnquiryWebsite } from "@clinic-genie/db";
import { staffTx } from "@/lib/db";
import type { EnquiryFilters, EnquiryWindow, SubmissionDetail, SubmissionListItem, SubmissionStatus } from "@/lib/form-submissions";

/**
 * D85. The Clinic Genie website's contact form, read live from Supabase `public.contact_submissions`
 * through a read-only role. Nothing is copied: only follow-up status and read receipts are stored here.
 */

export const SUPABASE_FORM_KEY = "contact";
const MAX_ROWS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ExternalBreakdownSeed {
  clinicId: string;
  clinicName: string;
  websiteKey: string | null;
  formKey: string;
  attributionSource: string;
}

export interface ExternalEnquirySlice {
  configured: boolean;
  failed: boolean;
  notice: string | null;
  current: SubmissionListItem[];
  productionPrevious: ExternalBreakdownSeed[];
}

export const NO_EXTERNAL: ExternalEnquirySlice = { configured: false, failed: false, notice: null, current: [], productionPrevious: [] };

const FAILED_NOTICE = "The website contact form could not be read from Supabase. Other enquiries are unchanged.";
const TRUNCATED_NOTICE = `Only the latest ${MAX_ROWS} website contact-form submissions in this period were read.`;

interface ContactRow {
  id: string;
  name: string;
  clinic_name: string;
  email: string;
  phone: string | null;
  specialty: string;
  message: string;
  created_at: Date;
}

const globalForSupabase = globalThis as unknown as { supabaseEnquiryPool?: pg.Pool; supabaseEnquiryPoolKey?: string };

function closePool(): void {
  void globalForSupabase.supabaseEnquiryPool?.end().catch(() => undefined);
  globalForSupabase.supabaseEnquiryPool = undefined;
  globalForSupabase.supabaseEnquiryPoolKey = undefined;
}

/** Supabase presents its own CA. Set SUPABASE_ENQUIRY_CA_CERT to verify it; otherwise the link is encrypted but unverified. */
function sslFor(host: string): pg.PoolConfig["ssl"] {
  if (host === "local") return false;
  const ca = process.env.SUPABASE_ENQUIRY_CA_CERT?.trim();
  return ca ? { ca: ca.replace(/\\n/g, "\n"), rejectUnauthorized: true } : { rejectUnauthorized: false };
}

function supabasePool(): pg.Pool | null {
  const url = process.env.SUPABASE_ENQUIRY_DATABASE_URL?.trim() ?? "";
  if (!url) {
    closePool();
    return null;
  }
  let host: string;
  try {
    host = assertSupabaseEnquiryUrl(url).host;
  } catch {
    closePool();
    return null;
  }
  if (globalForSupabase.supabaseEnquiryPool && globalForSupabase.supabaseEnquiryPoolKey === url) return globalForSupabase.supabaseEnquiryPool;
  closePool();
  const connection = new URL(url);
  // sslmode in the URL would override the explicit ssl option below.
  connection.searchParams.delete("sslmode");
  const pool = new pg.Pool({
    connectionString: connection.toString(),
    ssl: sslFor(host),
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 8_000,
  });
  pool.on("error", () => undefined);
  globalForSupabase.supabaseEnquiryPool = pool;
  globalForSupabase.supabaseEnquiryPoolKey = url;
  return pool;
}

/** Test seam: drop the cached pool after the environment changes. */
export function resetSupabaseEnquiryPool(): void {
  closePool();
}

async function readContact<T extends pg.QueryResultRow>(query: string, params: unknown[]): Promise<T[] | null> {
  const pool = supabasePool();
  if (!pool) return null;
  const client = await pool.connect().catch(() => null);
  if (!client) return null;
  try {
    // Read-only end to end: the role only has select, and the transaction refuses writes as well.
    await client.query("begin read only");
    const { rows } = await client.query<T>(query, params);
    await client.query("commit");
    return rows;
  } catch {
    await client.query("rollback").catch(() => undefined);
    return null;
  } finally {
    client.release();
  }
}

/** Whether the connection is set, accepted by the guard, and answering. Used by readiness and empty states. */
export async function supabaseEnquiryConnection(): Promise<{ configured: boolean; refused: boolean; reachable: boolean }> {
  const url = process.env.SUPABASE_ENQUIRY_DATABASE_URL?.trim();
  if (!url) return { configured: false, refused: false, reachable: false };
  try {
    assertSupabaseEnquiryUrl(url);
  } catch {
    return { configured: true, refused: true, reachable: false };
  }
  const rows = await readContact<{ ok: number }>("select 1 as ok from public.contact_submissions limit 1", []);
  return { configured: true, refused: false, reachable: rows !== null };
}

export function supabaseEnquiryReference(id: string): string {
  return `WEB-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function validDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

async function queryRange(from: string | null | undefined, to: string | null | undefined): Promise<{ rows: ContactRow[]; truncated: boolean } | null> {
  const bounded = validDate(from) && validDate(to);
  const rows = await readContact<ContactRow>(
    `select id::text as id, name, clinic_name, email, phone, specialty, message, created_at
     from public.contact_submissions
     where ($1::date is null or (created_at at time zone 'Asia/Singapore')::date >= $1::date)
       and ($2::date is null or (created_at at time zone 'Asia/Singapore')::date <= $2::date)
     order by created_at desc
     limit ${MAX_ROWS + 1}`,
    [bounded ? from : null, bounded ? to : null],
  );
  if (!rows) return null;
  return { rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS };
}

async function followUpStatuses(access: AccessProfile, ids: string[]): Promise<Map<string, SubmissionStatus>> {
  if (ids.length === 0) return new Map();
  const rows = await staffTx(access, (db) => listExternalFollowUpStatuses(db, ids));
  return new Map(rows.map((row) => [row.externalId, row.status]));
}

export function toSupabaseListItem(site: SupabaseEnquiryWebsite, row: ContactRow, status: SubmissionStatus, contact: boolean): SubmissionListItem {
  return {
    id: row.id,
    reference: supabaseEnquiryReference(row.id),
    clinicId: site.clientSlug,
    clinicName: site.clientName,
    websiteKey: site.enquiryKey,
    formKey: SUPABASE_FORM_KEY,
    submittedAt: new Date(row.created_at),
    submitterName: row.name,
    status,
    notificationStatus: null,
    notificationDelivery: "unavailable",
    attributionSource: "",
    pagePath: null,
    isSynthetic: false,
    source: "supabase",
    contactNumber: contact ? row.phone : undefined,
    email: contact ? row.email : undefined,
  };
}

export function matchesSupabaseFilters(site: SupabaseEnquiryWebsite, row: ContactRow, status: SubmissionStatus, filters: EnquiryFilters): boolean {
  if (filters.clinicId && site.clientSlug !== filters.clinicId) return false;
  if (filters.websiteKey && site.enquiryKey !== filters.websiteKey) return false;
  if (filters.formKey && filters.formKey !== SUPABASE_FORM_KEY) return false;
  if (filters.status && status !== filters.status) return false;
  if (filters.notification && filters.notification !== "unavailable") return false;
  if (filters.reference) {
    const needle = filters.reference.toLowerCase();
    if (!supabaseEnquiryReference(row.id).toLowerCase().includes(needle) && !row.id.includes(needle)) return false;
  }
  if (filters.person) {
    const needle = filters.person.toLowerCase();
    const haystack = [row.name, row.clinic_name, row.email, row.phone ?? ""].join("\n").toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function seed(site: SupabaseEnquiryWebsite): ExternalBreakdownSeed {
  return { clinicId: site.clientSlug, clinicName: site.clientName, websiteKey: site.enquiryKey, formKey: SUPABASE_FORM_KEY, attributionSource: "" };
}

async function mappedWebsite(access: AccessProfile, scope: string[] | null): Promise<SupabaseEnquiryWebsite | null> {
  if (!process.env.SUPABASE_ENQUIRY_DATABASE_URL?.trim()) return null;
  return staffTx(access, (db) => getSupabaseEnquiryWebsite(db, scope));
}

export async function loadSupabaseEnquirySlice(
  access: AccessProfile,
  scope: string[] | null,
  filters: EnquiryFilters,
  window?: EnquiryWindow,
): Promise<ExternalEnquirySlice> {
  const site = await mappedWebsite(access, scope);
  if (!site) return NO_EXTERNAL;
  if (filters.clinicId && filters.clinicId !== site.clientSlug) return { ...NO_EXTERNAL, configured: true };
  const [current, previous] = await Promise.all([
    queryRange(window?.from ?? filters.from, window?.to ?? filters.to),
    window ? queryRange(window.previousFrom, window.previousTo) : Promise.resolve({ rows: [], truncated: false }),
  ]);
  if (!current || !previous) return { configured: true, failed: true, notice: FAILED_NOTICE, current: [], productionPrevious: [] };
  const statuses = await followUpStatuses(access, [...current.rows, ...previous.rows].map((row) => row.id));
  const status = (id: string) => statuses.get(id) ?? "new";
  return {
    configured: true,
    failed: false,
    notice: current.truncated || previous.truncated ? TRUNCATED_NOTICE : null,
    current: current.rows
      .filter((row) => matchesSupabaseFilters(site, row, status(row.id), filters))
      .map((row) => toSupabaseListItem(site, row, status(row.id), filters.contact === true)),
    productionPrevious: previous.rows
      .filter((row) => matchesSupabaseFilters(site, row, status(row.id), filters))
      .map(() => seed(site)),
  };
}

/** Home-page totals: ids plus follow-up status only. */
export async function countSupabaseEnquiryStatuses(
  access: AccessProfile,
  scope: string[] | null,
  window?: { from?: string | null; to?: string | null; clinicId?: string | null },
): Promise<{ configured: boolean; failed: boolean; notice: string | null; counts: Record<SubmissionStatus, number> }> {
  const counts: Record<SubmissionStatus, number> = { new: 0, acknowledged: 0, closed: 0 };
  const site = await mappedWebsite(access, scope);
  if (!site || (window?.clinicId && window.clinicId !== site.clientSlug)) return { configured: false, failed: false, notice: null, counts };
  const loaded = await queryRange(window?.from, window?.to);
  if (!loaded) return { configured: true, failed: true, notice: FAILED_NOTICE, counts };
  const statuses = await followUpStatuses(access, loaded.rows.map((row) => row.id));
  for (const row of loaded.rows) counts[statuses.get(row.id) ?? "new"] += 1;
  return { configured: true, failed: false, notice: loaded.truncated ? TRUNCATED_NOTICE : null, counts };
}

export async function readSupabaseEnquiryDetail(
  access: AccessProfile,
  scope: string[] | null,
  id: string,
): Promise<{ detail: SubmissionDetail | null; failed: boolean }> {
  const submissionId = id.toLowerCase();
  if (!UUID.test(submissionId)) return { detail: null, failed: false };
  const site = await mappedWebsite(access, scope);
  if (!site) return { detail: null, failed: false };
  const rows = await readContact<ContactRow>(
    `select id::text as id, name, clinic_name, email, phone, specialty, message, created_at
     from public.contact_submissions
     where id = $1::uuid`,
    [submissionId],
  );
  if (!rows) return { detail: null, failed: true };
  const row = rows[0];
  if (!row) return { detail: null, failed: false };
  const status = (await followUpStatuses(access, [row.id])).get(row.id) ?? "new";
  return {
    failed: false,
    detail: {
      ...toSupabaseListItem(site, row, status, true),
      contactNumber: row.phone ?? "",
      email: row.email,
      message: row.message,
      reason: row.specialty,
      organisation: row.clinic_name,
      preferredDate: null,
      preferredTimeWindow: null,
      formVersion: 1,
      notification: null,
    },
  };
}
