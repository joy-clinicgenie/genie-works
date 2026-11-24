import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTestDatabase, loadRootEnv, requireEnv, resolveAccess, withContext, type AccessProfile } from "@clinic-genie/db";
import {
  countSupabaseEnquiryStatuses,
  loadSupabaseEnquirySlice,
  readSupabaseEnquiryDetail,
  resetSupabaseEnquiryPool,
  supabaseEnquiryConnection,
  supabaseEnquiryReference,
} from "@/lib/supabase-enquiries";

/**
 * D85. A disposable local database stands in for Supabase: the same `contact_submissions` table and a
 * select-only role, so the reader is exercised end to end without touching the real project.
 */

loadRootEnv();
const FIXTURE_DB = "cg_supabase_contact_fixture";
const READER = "cg_supabase_reader_test";
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
assertTestDatabase(adminUrl);

const ROWS = {
  today: "aaaaaaaa-0000-4000-8000-000000000001",
  earlier: "aaaaaaaa-0000-4000-8000-000000000002",
  previous: "aaaaaaaa-0000-4000-8000-000000000003",
};

function urlFor(database: string, user?: string, password?: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  if (user) url.username = user;
  if (password) url.password = password;
  return url.toString();
}

const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
let slug = "";
let access: AccessProfile;

async function asAdmin<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await admin.connect();
  try {
    return await fn(db);
  } finally {
    db.release();
  }
}

beforeAll(async () => {
  const maintenance = new pg.Client({ connectionString: urlFor("postgres") });
  await maintenance.connect();
  await maintenance.query(`drop database if exists ${FIXTURE_DB} with (force)`);
  await maintenance.query(`create database ${FIXTURE_DB}`);
  await maintenance.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = '${READER}') then create role ${READER} login password 'reader'; end if;
  end $$`);
  await maintenance.end();

  const fixture = new pg.Client({ connectionString: urlFor(FIXTURE_DB) });
  await fixture.connect();
  await fixture.query(`create table public.contact_submissions (
    id uuid primary key default gen_random_uuid(),
    name text not null, clinic_name text not null, email text not null, phone text,
    specialty text not null, message text not null, consent boolean not null default true,
    created_at timestamptz not null default now())`);
  // As on the live site: RLS on, no public policies, so the reader needs its own select policy.
  await fixture.query(`alter table public.contact_submissions enable row level security`);
  await fixture.query(`revoke all on public.contact_submissions from public`);
  await fixture.query(`grant usage on schema public to ${READER}`);
  await fixture.query(`grant select on public.contact_submissions to ${READER}`);
  await fixture.query(`create policy contact_submissions_genie_works_read on public.contact_submissions for select to ${READER} using (true)`);
  await fixture.query(
    `insert into public.contact_submissions (id, name, clinic_name, email, phone, specialty, message, created_at) values
     ($1, 'Avery Example', 'Example Dental', 'avery@example.invalid', '+65 0000 0001', 'Dental', 'First message', '2026-11-20 10:00+08'),
     ($2, 'Blake Example', 'Example Skin', 'blake@example.invalid', null, 'Aesthetics', 'Second message', '2026-11-18 23:30+08'),
     ($3, 'Casey Example', 'Example Eye', 'casey@example.invalid', null, 'Ophthalmology', 'Older message', '2026-10-25 09:00+08')`,
    [ROWS.today, ROWS.earlier, ROWS.previous],
  );
  await fixture.end();

  slug = `sbr-${Math.random().toString(16).slice(2, 8)}`;
  await asAdmin(async (db) => {
    await db.query("update websites set enquiry_source = 'database' where enquiry_source = 'supabase'");
    await db.query(
      `with clinic as (
         insert into clients (slug, name, owner_user_id, channels, is_synthetic, created_by, updated_by)
         select $1, 'Supabase reader clinic (fictional)', id, array['website'], true, id, id from staff_users where email = 'admin@example.invalid'
         returning id
       )
       insert into websites (client_id, name, url, platform, environment, enquiry_key, enquiry_source)
       select id, 'Website', 'https://reader.example.invalid', 'Next.js', 'production', $2, 'supabase' from clinic`,
      [slug, `${slug}-production`],
    );
  });
  const adminId = (await admin.query<{ id: string }>("select id from staff_users where email = 'admin@example.invalid'")).rows[0]!.id;
  access = (await withContext({ kind: "staff", userId: adminId, role: "admin" }, (db) => resolveAccess(db, adminId)))!;
  process.env.SUPABASE_ENQUIRY_DATABASE_URL = urlFor(FIXTURE_DB, READER, "reader");
  resetSupabaseEnquiryPool();
});

afterAll(async () => {
  resetSupabaseEnquiryPool();
  delete process.env.SUPABASE_ENQUIRY_DATABASE_URL;
  await admin.query("delete from enquiry_follow_ups where client_id = (select id from clients where slug = $1)", [slug]);
  await admin.query("update websites set enquiry_source = 'database', status = 'archived' where client_id = (select id from clients where slug = $1)", [slug]);
  await admin.query("update clients set status = 'archived' where slug = $1", [slug]);
  const maintenance = new pg.Client({ connectionString: urlFor("postgres") });
  await maintenance.connect();
  await maintenance.query(`drop database if exists ${FIXTURE_DB} with (force)`);
  await maintenance.end();
  await admin.end();
});

const WINDOW = { from: "2026-11-01", to: "2026-11-24", previousFrom: "2026-10-09", previousTo: "2026-10-31" };

describe("Supabase contact-form reader (D85)", () => {
  it("reports the connection as configured and reachable", async () => {
    expect(await supabaseEnquiryConnection()).toEqual({ configured: true, refused: false, reachable: true });
  });

  it("lists the current window, counts the previous one, and maps to the marked website", async () => {
    const slice = await loadSupabaseEnquirySlice(access, null, {}, WINDOW);
    expect(slice.configured).toBe(true);
    expect(slice.failed).toBe(false);
    expect(slice.current.map((item) => item.id)).toEqual([ROWS.today, ROWS.earlier]);
    expect(slice.productionPrevious).toHaveLength(1);
    const first = slice.current[0]!;
    expect(first).toMatchObject({ clinicId: slug, websiteKey: `${slug}-production`, formKey: "contact", status: "new", source: "supabase", isSynthetic: false, submitterName: "Avery Example" });
    expect(first.reference).toBe(supabaseEnquiryReference(ROWS.today));
    // Contact details only when asked for.
    expect(first.email).toBeUndefined();
    expect((await loadSupabaseEnquirySlice(access, null, { contact: true }, WINDOW)).current[0]?.email).toBe("avery@example.invalid");
  });

  it("applies the Singapore day boundary and the list filters", async () => {
    const day = await loadSupabaseEnquirySlice(access, null, { from: "2026-11-18", to: "2026-11-18" });
    expect(day.current.map((item) => item.id)).toEqual([ROWS.earlier]);
    expect((await loadSupabaseEnquirySlice(access, null, { person: "example skin" }, WINDOW)).current.map((item) => item.id)).toEqual([ROWS.earlier]);
    expect((await loadSupabaseEnquirySlice(access, null, { formKey: "appointment-enquiry" }, WINDOW)).current).toEqual([]);
    expect((await loadSupabaseEnquirySlice(access, null, { clinicId: "another-clinic" }, WINDOW)).current).toEqual([]);
    expect((await loadSupabaseEnquirySlice(access, ["another-clinic"], {}, WINDOW)).configured).toBe(false);
  });

  it("reads one enquiry with its message, clinic and specialty, and counts follow-up status", async () => {
    const { detail, failed } = await readSupabaseEnquiryDetail(access, null, ROWS.today.toUpperCase());
    expect(failed).toBe(false);
    expect(detail).toMatchObject({ message: "First message", organisation: "Example Dental", reason: "Dental", contactNumber: "+65 0000 0001", source: "supabase" });
    expect((await readSupabaseEnquiryDetail(access, null, "aaaaaaaa-0000-4000-8000-0000000000ff")).detail).toBeNull();
    expect((await readSupabaseEnquiryDetail(access, null, "not-a-uuid")).detail).toBeNull();

    await admin.query(
      `insert into enquiry_follow_ups (website_id, client_id, external_id, status)
       select w.id, w.client_id, $2, 'closed' from websites w join clients c on c.id = w.client_id where c.slug = $1`,
      [slug, ROWS.today],
    );
    const counts = await countSupabaseEnquiryStatuses(access, null, { from: WINDOW.from, to: WINDOW.to });
    expect(counts).toMatchObject({ configured: true, failed: false, counts: { new: 1, acknowledged: 0, closed: 1 } });
    expect((await loadSupabaseEnquirySlice(access, null, { status: "closed" }, WINDOW)).current.map((item) => item.id)).toEqual([ROWS.today]);
  });

  it("cannot write to Supabase through the reader role", async () => {
    const reader = new pg.Client({ connectionString: urlFor(FIXTURE_DB, READER, "reader") });
    await reader.connect();
    await expect(reader.query("delete from public.contact_submissions")).rejects.toThrow(/permission denied/);
    await reader.end();
  });

  it("reports a failure notice instead of throwing when Supabase cannot be read", async () => {
    process.env.SUPABASE_ENQUIRY_DATABASE_URL = urlFor(FIXTURE_DB, READER, "wrong-password");
    resetSupabaseEnquiryPool();
    try {
      const slice = await loadSupabaseEnquirySlice(access, null, {}, WINDOW);
      expect(slice).toMatchObject({ configured: true, failed: true, current: [] });
      expect(slice.notice).toMatch(/could not be read/);
      expect(await supabaseEnquiryConnection()).toEqual({ configured: true, refused: false, reachable: false });
    } finally {
      process.env.SUPABASE_ENQUIRY_DATABASE_URL = urlFor(FIXTURE_DB, READER, "reader");
      resetSupabaseEnquiryPool();
    }
  });

  it("refuses the owner role before connecting", async () => {
    process.env.SUPABASE_ENQUIRY_DATABASE_URL = urlFor(FIXTURE_DB, "postgres", "x");
    resetSupabaseEnquiryPool();
    try {
      expect(await supabaseEnquiryConnection()).toEqual({ configured: true, refused: true, reachable: false });
      expect((await loadSupabaseEnquirySlice(access, null, {}, WINDOW)).failed).toBe(true);
    } finally {
      process.env.SUPABASE_ENQUIRY_DATABASE_URL = urlFor(FIXTURE_DB, READER, "reader");
      resetSupabaseEnquiryPool();
    }
  });
});
