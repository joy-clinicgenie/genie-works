/**
 * Deterministic synthetic fixture for signed-in performance baselines.
 *
 * Every record is fictional and labelled. Clients are `is_synthetic = true`, every contact is under
 * example.invalid, and no production enquiry, patient or client record is read or copied. The fixture
 * only ever runs against an isolated suite database; the caller passes a URL that
 * `e2e-batch08/targets.ts` has already checked.
 *
 * Shape is deterministic and versioned: the same FIXTURE_VERSION always produces the same clients,
 * websites, staff permissions, row counts and identifiers. Analytics **dates** are anchored to the run
 * date, because the pages ask for "last 30 days" relative to today and would otherwise find nothing.
 * The anchor is returned in the summary so a baseline run can record which days it measured.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import pg from "pg";

/** Raise this when the fixture shape changes, so a stale database is detected rather than measured. */
export const FIXTURE_VERSION = "perf-2";

export const FIXTURE_CLIENTS = {
  a: { id: "aaaaaaaa-0000-4000-8000-000000000001", slug: "demo-clinic-a", name: "Demo Clinic A (fictional)", reference: "DEMO-A", shortCode: "DCA" },
  b: { id: "bbbbbbbb-0000-4000-8000-000000000002", slug: "demo-clinic-b", name: "Demo Clinic B (fictional)", reference: "DEMO-B", shortCode: "DCB" },
  empty: { id: "cccccccc-0000-4000-8000-000000000003", slug: "demo-clinic-empty", name: "Demo Clinic C — no data (fictional)", reference: "DEMO-C", shortCode: "DCC" },
} as const;

export const FIXTURE_WEBSITES = {
  aProduction: { id: "a0000000-0000-4000-8000-00000000a001", clientId: FIXTURE_CLIENTS.a.id, name: "Demo Clinic A website", url: "https://demo-clinic-a.example.invalid", platform: "Next.js on Vercel", environment: "production", enquiryKey: "demo-clinic-a-production" },
  aStaging: { id: "a0000000-0000-4000-8000-00000000a002", clientId: FIXTURE_CLIENTS.a.id, name: "Demo Clinic A preview", url: "https://preview.demo-clinic-a.example.invalid", platform: "Next.js on Vercel", environment: "staging", enquiryKey: "demo-clinic-a-staging" },
  bProduction: { id: "b0000000-0000-4000-8000-00000000b001", clientId: FIXTURE_CLIENTS.b.id, name: "Demo Clinic B website", url: "https://demo-clinic-b.example.invalid", platform: "Wix", environment: "production", enquiryKey: "demo-clinic-b-production" },
} as const;

/** The Wix binding the mock provider answers for. The instance and form ids are fictional. */
export const FIXTURE_WIX_BINDING = {
  websiteId: FIXTURE_WEBSITES.bProduction.id,
  instanceId: "dddddddd-0000-4000-8000-00000000d001",
  formId: "eeeeeeee-0000-4000-8000-00000000e001",
  namespace: "wix.form_app.form",
  formKey: "appointment-enquiry",
} as const;

/** Clinic scoping. The admin and manager roles are global and need no membership. */
export const FIXTURE_MEMBERSHIPS = [
  { email: "specialist-a@example.invalid", clientId: FIXTURE_CLIENTS.a.id },
  { email: "reviewer@example.invalid", clientId: FIXTURE_CLIENTS.a.id },
  { email: "specialist-b@example.invalid", clientId: FIXTURE_CLIENTS.b.id },
  { email: "readonly@example.invalid", clientId: FIXTURE_CLIENTS.b.id },
] as const;

/** A second administrator, so administrator actions are attributable separately from the seeded one. */
export const FIXTURE_SECOND_ADMIN = { email: "perf-admin@example.invalid", name: "Demo Performance Admin" } as const;

/**
 * Two draft articles: one with a featured image and an in-body image, one plain. Both are drafts.
 * The fixture does not run the submit/approve/publish workflow, so the published-article path and the
 * public blog API are NOT covered by it.
 *
 * Article ids are assigned by `createArticle`, because `blog_article_versions` is append-only and a
 * fixed id cannot be forced after the fact. The ids a load produced are returned in the summary and
 * written to `e2e-batch08/.run/perf-context.json`, which is where the baseline runner reads them.
 * Media ids are fixed, because the fixture inserts those rows itself.
 */
export const FIXTURE_BLOG = {
  withMedia: { slug: "fictional-service-explained", title: "A fictional service explained" },
  plain: { slug: "fictional-service-draft", title: "A fictional service, in draft" },
  featuredMedia: { id: "ac000000-0000-4000-8000-0000000ac001" },
  bodyMedia: { id: "ac000000-0000-4000-8000-0000000ac002" },
} as const;

export interface FixtureBlogIds {
  withMediaArticleId: string;
  plainArticleId: string;
  featuredMediaId: string;
  bodyMediaId: string;
}

export const FIXTURE_TASKS = { a: 80, b: 40 } as const;
export const FIXTURE_SEO_PAGES = { a: 40, b: 12 } as const;

export interface PerfFixtureSummary {
  version: string;
  database: string;
  anchorDate: string;
  counts: Record<string, number>;
  windows: Record<string, { start: string; end: string }>;
  blog: FixtureBlogIds;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The same windows apps/platform/src/lib/period-options.ts computes for its presets. */
export function fixtureWindows(anchor: string): Record<string, { start: string; end: string }> {
  const span = (days: number) => ({ start: addDays(anchor, -(days - 1)), end: anchor });
  const before = (w: { start: string; end: string }, days: number) => ({ start: addDays(w.start, -days), end: addDays(w.start, -1) });
  const last7 = span(7);
  const last30 = span(30);
  const last90 = span(90);
  return {
    last7,
    last7Previous: before(last7, 7),
    last30,
    last30Previous: before(last30, 30),
    last90,
    last90Previous: before(last90, 90),
  };
}

export function anchorDateSgt(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Replaces the fixture in the given isolated database. The caller is responsible for having checked
 * the URL against the isolated suite list first.
 */
export async function loadPerfFixture(adminConnectionString: string, now: Date = new Date(), uploadsDir = ".data/uploads-perf"): Promise<PerfFixtureSummary> {
  const database = new URL(adminConnectionString).pathname.replace(/^\//, "");
  if (!database.includes("perf")) throw new Error("Refusing the performance fixture: the database name does not contain perf.");
  const anchor = anchorDateSgt(now);
  const windows = fixtureWindows(anchor);
  const pool = new pg.Pool({ connectionString: adminConnectionString, max: 2 });
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('app.context', 'service', true)");
    await clearFixture(db);
    const actor = await ensureSecondAdmin(db);
    await insertClients(db, actor);
    await insertMemberships(db, actor);
    await insertWebsitesAndForms(db, actor);
    await insertTasks(db, actor);
    await insertSeo(db, actor);
    await insertSnapshots(db, actor);
    await insertAnalytics(db, actor, windows);
    await insertSavedReports(db, actor, windows);
    const blog = await insertBlog(db, actor, uploadsDir);
    await db.query(
      `insert into audit_events (actor_type, actor_user_id, action, target_type, outcome, metadata)
       values ('system', $1, 'seed.run', 'database', 'success', $2)`,
      [actor, JSON.stringify({ synthetic: true, fixture: "perf", version: FIXTURE_VERSION, anchorDate: anchor })],
    );
    await db.query("commit");
    await db.query("analyze");
    const counts = await countRows(db);
    return { version: FIXTURE_VERSION, database, anchorDate: anchor, counts, windows, blog };
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    db.release();
    await pool.end();
  }
}

/** Reads the fixture version recorded in the database, or null when no fixture is loaded. */
export async function readPerfFixtureVersion(adminConnectionString: string): Promise<{ version: string; anchorDate: string } | null> {
  const pool = new pg.Pool({ connectionString: adminConnectionString, max: 1 });
  try {
    const { rows } = await pool.query<{ metadata: { version?: string; anchorDate?: string } }>(
      `select metadata from audit_events
       where action = 'seed.run' and metadata->>'fixture' = 'perf'
       order by created_at desc limit 1`,
    );
    const found = rows[0]?.metadata;
    if (!found?.version || !found.anchorDate) return null;
    return { version: found.version, anchorDate: found.anchorDate };
  } finally {
    await pool.end();
  }
}

const FIXTURE_SLUGS = [FIXTURE_CLIENTS.a.slug, FIXTURE_CLIENTS.b.slug, FIXTURE_CLIENTS.empty.slug];

/** Removes a previous load of this fixture only. Other rows in the isolated database are left alone. */
async function clearFixture(db: pg.PoolClient): Promise<void> {
  const ids = [FIXTURE_CLIENTS.a.id, FIXTURE_CLIENTS.b.id, FIXTURE_CLIENTS.empty.id];
  // Children before parents. audit_events and timeline_events are append-only by trigger, so they are
  // deleted with the owner connection only, which is what this fixture uses.
  const ordered = [
    "analytics_metric_values", "analytics_report_rows", "analytics_report_partitions", "analytics_coverage",
    "analytics_secrets", "analytics_jobs", "analytics_sync_runs", "analytics_connections",
    "saved_report_downloads", "saved_report_versions", "saved_reports",
    "seo_changes", "seo_page_settings", "seo_redirects", "seo_site_tokens", "seo_index_checks", "seo_speed_checks", "seo_pages",
    "blog_activity", "blog_approvals", "blog_publications", "blog_preview_tokens",
    "blog_media", "blog_article_versions", "blog_articles",
    "task_notes", "task_history", "tasks",
    "website_forms", "websites",
    "report_snapshots", "timeline_events", "audit_events", "memberships",
  ];
  for (const table of ordered) {
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = $1 and column_name = 'client_id'",
      [table],
    );
    if (columns.rowCount === 0) continue;
    await db.query(`delete from ${table} where client_id = any($1::uuid[])`, [ids]);
  }
  await db.query("delete from clients where slug = any($1::text[])", [FIXTURE_SLUGS]);
}

async function ensureSecondAdmin(db: pg.PoolClient): Promise<string> {
  await db.query(
    `insert into staff_users (email, display_name, platform_role)
     values ($1, $2, 'admin') on conflict (email) do nothing`,
    [FIXTURE_SECOND_ADMIN.email, FIXTURE_SECOND_ADMIN.name],
  );
  const { rows } = await db.query<{ id: string }>("select id from staff_users where email = 'admin@example.invalid' and active limit 1");
  const actor = rows[0]?.id;
  if (!actor) throw new Error("The seeded administrator is missing. Run the platform seed first.");
  return actor;
}

async function insertClients(db: pg.PoolClient, actor: string): Promise<void> {
  for (const client of [FIXTURE_CLIENTS.a, FIXTURE_CLIENTS.b, FIXTURE_CLIENTS.empty]) {
    await db.query(
      `insert into clients (id, slug, name, status, owner_user_id, channels, is_synthetic, notes, reference_number, short_code, specialty, legal_name, public_name, enquiry_owner_user_id, notification_owner_user_id, administration_owner_user_id)
       values ($1, $2, $3, 'active', $4, array['website','seo','google_ads'], true, 'Synthetic performance fixture. Not a client result.', $5, $6, 'Fictional specialty', $3, $3, $4, $4, $4)`,
      [client.id, client.slug, client.name, actor, client.reference, client.shortCode],
    );
  }
}

async function insertMemberships(db: pg.PoolClient, actor: string): Promise<void> {
  for (const membership of FIXTURE_MEMBERSHIPS) {
    await db.query(
      `insert into memberships (user_id, client_id, granted_by)
       select u.id, $1, $2 from staff_users u where u.email = $3`,
      [membership.clientId, actor, membership.email],
    );
  }
}

async function insertWebsitesAndForms(db: pg.PoolClient, actor: string): Promise<void> {
  for (const site of [FIXTURE_WEBSITES.aProduction, FIXTURE_WEBSITES.aStaging, FIXTURE_WEBSITES.bProduction]) {
    await db.query(
      `insert into websites (id, client_id, name, url, platform, environment, status, notes, enquiry_key)
       values ($1, $2, $3, $4, $5, $6, 'active', 'Synthetic performance fixture.', $7)`,
      [site.id, site.clientId, site.name, site.url, site.platform, site.environment, site.enquiryKey],
    );
  }
  // enquiry_source must move to 'wix' in the same statement: websites_wix_binding_shape requires the
  // whole binding to be present together.
  await db.query(
    `update websites
     set enquiry_source = 'wix', wix_instance_id = $2, wix_form_id = $3, wix_form_namespace = $4,
         wix_form_key = $5, wix_counts_in_totals = true
     where id = $1`,
    [FIXTURE_WIX_BINDING.websiteId, FIXTURE_WIX_BINDING.instanceId, FIXTURE_WIX_BINDING.formId, FIXTURE_WIX_BINDING.namespace, FIXTURE_WIX_BINDING.formKey],
  );
  // Two active forms and one proposed-inactive form on Clinic A, one on Clinic B.
  const forms: Array<[string, string, string, string, boolean, string]> = [
    [FIXTURE_WEBSITES.aProduction.id, FIXTURE_CLIENTS.a.id, "appointment-enquiry", "Appointment enquiry", true, "applied"],
    [FIXTURE_WEBSITES.aProduction.id, FIXTURE_CLIENTS.a.id, "contact", "Contact form", true, "applied"],
    [FIXTURE_WEBSITES.aStaging.id, FIXTURE_CLIENTS.a.id, "callback", "Callback request", false, "pending_website_update"],
    [FIXTURE_WEBSITES.bProduction.id, FIXTURE_CLIENTS.b.id, "appointment-enquiry", "Appointment enquiry", true, "unable_to_verify"],
  ];
  for (const [websiteId, clientId, key, name, active, status] of forms) {
    await db.query(
      `insert into website_forms (website_id, client_id, form_key, display_name, page_path, proposed_active, application_status, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [websiteId, clientId, key, name, `/${key}`, active, status, actor],
    );
  }
}

async function insertTasks(db: pg.PoolClient, actor: string): Promise<void> {
  for (const [clientId, count] of [[FIXTURE_CLIENTS.a.id, FIXTURE_TASKS.a], [FIXTURE_CLIENTS.b.id, FIXTURE_TASKS.b]] as const) {
    await db.query(
      `insert into tasks (client_id, title, description, owner_user_id, priority, status, due_date, waiting_on, follow_up_date, created_by, created_at, completed_at)
       select $1, format('Demo task %s', g), 'Synthetic performance fixture task.', $2,
              (array['low','medium','high','critical'])[1 + g % 4],
              (array['open','in_progress','waiting','completed','cancelled','open'])[1 + g % 6],
              current_date - 30 + (g % 60),
              case when g % 6 = 2 then 'Clinic contact (fictional)' else null end,
              case when g % 6 = 2 then current_date + (g % 10) else null end,
              $2, now() - (g || ' hours')::interval,
              case when g % 6 = 3 then now() - (g || ' minutes')::interval else null end
       from generate_series(1, $3) g`,
      [clientId, actor, count],
    );
  }
  await db.query(
    `insert into task_history (task_id, client_id, from_status, to_status, actor_user_id, note, created_at)
     select id, client_id, null, 'open', created_by, 'Task created', created_at from tasks where title like 'Demo task %'`,
  );
}

async function insertSeo(db: pg.PoolClient, actor: string): Promise<void> {
  for (const [clientId, websiteId, count] of [
    [FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, FIXTURE_SEO_PAGES.a],
    [FIXTURE_CLIENTS.b.id, FIXTURE_WEBSITES.bProduction.id, FIXTURE_SEO_PAGES.b],
  ] as const) {
    await db.query(
      `insert into seo_pages (client_id, website_id, page_path, page_title, primary_keyword, search_intent, content_status, mapping_flag, flag_note, next_review_on, created_by)
       select $1, $2, format('/service-%s', g), format('Fictional service %s', g), format('fictional service %s', g), 'commercial',
              (array['planned','published','needs_update','in_review'])[1 + g % 4],
              (array['none','none','none','duplicate_target'])[1 + g % 4],
              case when g % 4 = 3 then 'Synthetic flag' else null end,
              current_date - 10 + (g % 40), $4
       from generate_series(1, $3) g`,
      [clientId, websiteId, count, actor],
    );
  }
  await db.query(
    `insert into seo_changes (client_id, seo_page_id, change_type, before_value, after_value, reason, changed_by, changed_on)
     select client_id, id, 'title', 'before', 'after', 'Synthetic change', created_by, current_date - (id::text ~ '^[0-4]')::int * 5 - 1
     from seo_pages where page_path like '/service-%'`,
  );
  await db.query(
    `insert into seo_redirects (client_id, website_id, source_path, destination_path, active, created_by, updated_by)
     select $1, $2, format('/old-%s', g), format('/service-%s', g), g % 4 <> 0, $3, $3 from generate_series(1, 8) g`,
    [FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, actor],
  );
}

async function insertSnapshots(db: pg.PoolClient, actor: string): Promise<void> {
  await db.query(
    `insert into report_snapshots (client_id, source, channel, metric, dimension, period_start, period_end, value, unit, note, entered_by)
     select c.id, 'clinic_records', 'all', m.metric, '',
            (date_trunc('month', current_date) - (p || ' months')::interval)::date,
            (date_trunc('month', current_date) - ((p - 1) || ' months')::interval - interval '1 day')::date,
            case when m.metric = 'patients' and p % 5 = 0 then null else (80 + (p * 11 + length(m.metric)) % 120)::numeric end,
            'count',
            case when m.metric = 'patients' and p % 5 = 0 then 'Synthetic unavailable value' else null end,
            $2
     from clients c
     cross join generate_series(1, 12) p
     cross join (values ('clicks'),('sessions'),('enquiries'),('confirmed_appointments'),('patients')) m(metric)
     where c.id = any($1::uuid[])`,
    [[FIXTURE_CLIENTS.a.id, FIXTURE_CLIENTS.b.id], actor],
  );
}

const GA4_TEMPLATES = ["ga4.traffic_range", "ga4.acquisition", "ga4.landing", "ga4.device", "ga4.country"] as const;
const GSC_TEMPLATES = ["gsc.totals", "gsc.queries", "gsc.pages"] as const;

/**
 * Clinic A: GA4 and Search Console connected, with published partitions for the preset windows the
 * analytics pages ask for. Clinic B: Wix connected. Clinic C: nothing, so unavailable states show.
 */
async function insertAnalytics(db: pg.PoolClient, actor: string, windows: Record<string, { start: string; end: string }>): Promise<void> {
  const connection = async (clientId: string, websiteId: string, provider: string, property: string, status: string) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into analytics_connections (client_id, website_id, provider, external_property_id, status, provider_timezone, verified_at, created_by)
       values ($1, $2, $3, $4, $5, 'Asia/Singapore', now(), $6) returning id`,
      [clientId, websiteId, provider, property, status, actor],
    );
    return rows[0]!.id;
  };
  const ga4 = await connection(FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, "ga4", "properties/900000001", "connected");
  const gsc = await connection(FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, "gsc", "sc-domain:demo-clinic-a.example.invalid", "connected");
  // A website whose provider needs reconnecting, so the reconnect state is exercised too.
  await connection(FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aStaging.id, "ga4", "properties/900000002", "reconnect_required");
  const wix = await connection(FIXTURE_CLIENTS.b.id, FIXTURE_WEBSITES.bProduction.id, "wix", "wix-site-demo-b", "connected");

  const periods = ["last7", "last7Previous", "last30", "last30Previous", "last90", "last90Previous"] as const;

  const partition = async (connectionId: string, clientId: string, websiteId: string, templateKey: string, window: { start: string; end: string }, hash: string) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into analytics_report_partitions
         (client_id, website_id, connection_id, template_key, query_hash, start_date, end_date, source_timezone, provenance, completeness, generation, published, measured_through)
       values ($1, $2, $3, $4, $5, $6, $7, 'Asia/Singapore', 'demo', 'complete', 1, true, $7) returning id`,
      [clientId, websiteId, connectionId, templateKey, hash, window.start, window.end],
    );
    return rows[0]!.id;
  };
  const hashFor = (seed: string) => {
    // A 64-character hexadecimal string, required by the column check. Deterministic for a given seed.
    let text = "";
    for (let i = 0; text.length < 64; i += 1) {
      text += Array.from(`${seed}:${i}`).reduce((acc, ch) => acc + ch.charCodeAt(0).toString(16), "");
    }
    return text.slice(0, 64);
  };
  const row = async (partitionId: string, clientId: string, websiteId: string, dimensionKey: string, dimensions: Record<string, string>, metrics: Array<[string, number | null]>) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into analytics_report_rows (partition_id, client_id, website_id, dimension_key, dimensions)
       values ($1, $2, $3, $4, $5) returning id`,
      [partitionId, clientId, websiteId, dimensionKey, JSON.stringify(dimensions)],
    );
    const rowId = rows[0]!.id;
    for (const [key, value] of metrics) {
      await db.query(
        `insert into analytics_metric_values (report_row_id, client_id, website_id, metric_key, value_numeric, value_state)
         values ($1, $2, $3, $4, $5, $6)`,
        [rowId, clientId, websiteId, key, value, value === null ? "unavailable" : "available"],
      );
    }
  };
  const dayCount = (window: { start: string; end: string }) =>
    Math.round((Date.parse(`${window.end}T00:00:00Z`) - Date.parse(`${window.start}T00:00:00Z`)) / 86_400_000) + 1;

  for (const name of periods) {
    const window = windows[name]!;
    const days = dayCount(window);
    const scale = name.includes("Previous") ? 0.8 : 1;

    // Daily series plus coverage, which is what the sessions chart and period totals read.
    const daily = await partition(ga4, FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, "ga4.traffic_daily", window, hashFor(`ga4.traffic_daily:${name}`));
    for (let i = 0; i < days; i += 1) {
      const date = addDays(window.start, i);
      await row(daily, FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, date, { date }, [["sessions", Math.round((40 + ((i * 7) % 35)) * scale)]]);
      await db.query(
        `insert into analytics_coverage (client_id, website_id, connection_id, template_key, source_date, state, tracking_active, measured_through)
         values ($1, $2, $3, 'ga4.traffic_daily', $4, 'complete', true, $4)
         on conflict (connection_id, template_key, source_date) do nothing`,
        [FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, ga4, date],
      );
    }

    for (const templateKey of GA4_TEMPLATES) {
      const id = await partition(ga4, FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, templateKey, window, hashFor(`${templateKey}:${name}`));
      if (templateKey === "ga4.traffic_range") {
        await row(id, FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, "property", { property: "all" }, [
          ["totalUsers", Math.round(900 * scale * (days / 30))],
          ["sessions", Math.round(1200 * scale * (days / 30))],
          ["engagementRate", 54],
        ]);
        continue;
      }
      const buckets = templateKey === "ga4.acquisition"
        ? ["Organic Search", "Direct", "Referral", "Paid Search", "Organic Social"]
        : templateKey === "ga4.landing"
          ? ["/", "/services", "/contact", "/about", "/service-1"]
          : templateKey === "ga4.device"
            ? ["mobile", "desktop", "tablet"]
            : ["Singapore", "Malaysia", "Indonesia"];
      for (const [index, bucket] of buckets.entries()) {
        await row(id, FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, bucket, { label: bucket }, [
          ["sessions", Math.round((320 - index * 60) * scale * (days / 30))],
          ["totalUsers", Math.round((240 - index * 45) * scale * (days / 30))],
        ]);
      }
    }

    for (const templateKey of GSC_TEMPLATES) {
      const id = await partition(gsc, FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, templateKey, window, hashFor(`${templateKey}:${name}`));
      if (templateKey === "gsc.totals") {
        await row(id, FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, "property", { property: "all" }, [
          ["clicks", Math.round(450 * scale * (days / 30))],
          ["impressions", Math.round(14000 * scale * (days / 30))],
          ["ctr", 3],
          ["position", 18],
        ]);
        continue;
      }
      const labels = templateKey === "gsc.queries"
        ? ["fictional service singapore", "demo clinic a", "fictional treatment cost", "clinic near me", "fictional service review"]
        : ["/", "/service-1", "/service-2", "/contact", "/about"];
      for (const [index, label] of labels.entries()) {
        await row(id, FIXTURE_CLIENTS.a.id, FIXTURE_WEBSITES.aProduction.id, label, { label }, [
          ["clicks", Math.round((120 - index * 20) * scale * (days / 30))],
          ["impressions", Math.round((3000 - index * 400) * scale * (days / 30))],
          ["ctr", 4 - index * 0.4],
          ["position", 12 + index * 3],
        ]);
      }
    }

    // Clinic B keeps a Wix daily series only, so its analytics screens differ from Clinic A's.
    const wixDaily = await partition(wix, FIXTURE_CLIENTS.b.id, FIXTURE_WEBSITES.bProduction.id, "wix.data_daily", window, hashFor(`wix.data_daily:${name}`));
    for (let i = 0; i < days; i += 1) {
      const date = addDays(window.start, i);
      await row(wixDaily, FIXTURE_CLIENTS.b.id, FIXTURE_WEBSITES.bProduction.id, date, { date }, [["total_sessions", Math.round((18 + ((i * 5) % 20)) * scale)]]);
      await db.query(
        `insert into analytics_coverage (client_id, website_id, connection_id, template_key, source_date, state, tracking_active, measured_through)
         values ($1, $2, $3, 'wix.data_daily', $4, 'complete', true, $4)
         on conflict (connection_id, template_key, source_date) do nothing`,
        [FIXTURE_CLIENTS.b.id, FIXTURE_WEBSITES.bProduction.id, wix, date],
      );
    }
  }
}

async function insertSavedReports(db: pg.PoolClient, actor: string, windows: Record<string, { start: string; end: string }>): Promise<void> {
  // Group keys, which is what saved_reports.sections accepts (see saved_reports_sections).
  const sections = ["executive", "website", "organic", "leads"];
  const reports: Array<{ id: string; clientId: string; websiteId: string; name: string; window: { start: string; end: string }; comparison: { start: string; end: string } | null; versions: number; status: string; reportType: string }> = [
    { id: "f1f1f1f1-0000-4000-8000-00000000f001", clientId: FIXTURE_CLIENTS.a.id, websiteId: FIXTURE_WEBSITES.aProduction.id, name: "Demo Clinic A monthly report (fictional)", window: windows.last30!, comparison: windows.last30Previous!, versions: 3, status: "saved", reportType: "monthly" },
    { id: "f1f1f1f1-0000-4000-8000-00000000f002", clientId: FIXTURE_CLIENTS.a.id, websiteId: FIXTURE_WEBSITES.aProduction.id, name: "Demo Clinic A quarterly report (fictional)", window: windows.last90!, comparison: null, versions: 1, status: "draft", reportType: "quarterly" },
    { id: "f1f1f1f1-0000-4000-8000-00000000f003", clientId: FIXTURE_CLIENTS.b.id, websiteId: FIXTURE_WEBSITES.bProduction.id, name: "Demo Clinic B monthly report (fictional)", window: windows.last30!, comparison: null, versions: 2, status: "draft", reportType: "monthly" },
  ];
  for (const report of reports) {
    await db.query(
      `insert into saved_reports (id, client_id, name, period_start, period_end, comparison_start, comparison_end, sections, summary, status, report_type, website_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'Synthetic performance fixture report. Not a client result.', $9, $10, $11, $12)`,
      [report.id, report.clientId, report.name, report.window.start, report.window.end, report.comparison?.start ?? null, report.comparison?.end ?? null, sections, report.status, report.reportType, report.websiteId, actor],
    );
    for (let version = 1; version <= report.versions; version += 1) {
      await db.query(
        `insert into saved_report_versions (report_id, client_id, version_number, name, period_start, period_end, comparison_start, comparison_end, sections, summary, figures, for_review, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          report.id, report.clientId, version, report.name, report.window.start, report.window.end,
          report.comparison?.start ?? null, report.comparison?.end ?? null, sections,
          `Synthetic version ${version}.`, JSON.stringify({ blocks: [], synthetic: true, version }), version < report.versions, actor,
        ],
      );
    }
  }
}

/**
 * A published article with a featured image and an in-body image, plus a draft.
 *
 * The media bytes are a 1x1 PNG written under the suite's own uploads directory, because
 * apps/platform/src/lib/storage.ts reads media from the filesystem. `storeBlogImage` names files
 * `blog/<clientId>/<sha>-<timestamp>.<ext>`; these use a fixed name so the fixture stays deterministic.
 */
async function insertBlog(db: pg.PoolClient, actor: string, uploadsDir: string): Promise<FixtureBlogIds> {
  const { createArticle } = await import("../services/blog");
  const clientId = FIXTURE_CLIENTS.a.id;
  const websiteId = FIXTURE_WEBSITES.aProduction.id;
  const { rows: reviewers } = await db.query<{ id: string }>("select id from staff_users where email = 'reviewer@example.invalid' limit 1");
  const reviewerUserId = reviewers[0]?.id ?? null;

  const body = (withImage: boolean) => ({
    layout: "clinic-article-v1" as const,
    blocks: [
      { type: "paragraph" as const, text: "Synthetic fixture article. Nothing here is clinical advice or a client result." },
      { type: "heading" as const, level: 2 as const, text: "What this fixture covers" },
      { type: "paragraph" as const, text: "It exists so the blog editor and the media route can be measured on isolated infrastructure." },
      ...(withImage ? [{ type: "image" as const, mediaId: FIXTURE_BLOG.bodyMedia.id, alt: "Synthetic placeholder image" }] : []),
      { type: "list" as const, ordered: false, items: ["Fictional point one", "Fictional point two"] },
    ],
  });

  // createArticle is used rather than hand-written SQL so the rows satisfy blog_articles_guard and
  // carry a current_version_id, exactly as an article created in the application does.
  const ids: string[] = [];
  for (const article of [
    { slug: FIXTURE_BLOG.withMedia.slug, title: FIXTURE_BLOG.withMedia.title, withImage: true },
    { slug: FIXTURE_BLOG.plain.slug, title: FIXTURE_BLOG.plain.title, withImage: false },
  ]) {
    const created = await createArticle(db, {
      clientId,
      websiteId,
      title: article.title,
      slug: article.slug,
      excerpt: "Synthetic fixture excerpt.",
      category: "Fictional category",
      authorUserId: actor,
      reviewerUserId,
      seoTitle: article.title,
      seoDescription: "Synthetic fixture description for performance measurement only.",
      canonicalPath: null,
      indexable: true,
      body: body(article.withImage),
    }, actor);
    ids.push(created);
  }
  const [withMediaArticleId, plainArticleId] = ids as [string, string];

  // A 1x1 transparent PNG. Small on purpose: the measurement is the route, not the image.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const root = resolve(uploadsDir);
  for (const media of [
    { id: FIXTURE_BLOG.featuredMedia.id, key: `blog/${clientId}/fixture-featured.png`, alt: "Synthetic featured placeholder" },
    { id: FIXTURE_BLOG.bodyMedia.id, key: `blog/${clientId}/fixture-body.png`, alt: "Synthetic placeholder image" },
  ]) {
    const path = join(root, media.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, png);
    await db.query(
      `insert into blog_media (id, article_id, client_id, storage_key, alt_text, content_type, byte_size, created_by)
       values ($1, $2, $3, $4, $5, 'image/png', $6, $7)`,
      [media.id, withMediaArticleId, clientId, media.key, media.alt, png.byteLength, actor],
    );
  }
  await db.query("select set_config('app.blog_transition', 'save', true)");
  await db.query("update blog_articles set featured_media_id = $2 where id = $1", [withMediaArticleId, FIXTURE_BLOG.featuredMedia.id]);
  await db.query("select set_config('app.blog_transition', '', true)");

  return {
    withMediaArticleId,
    plainArticleId,
    featuredMediaId: FIXTURE_BLOG.featuredMedia.id,
    bodyMediaId: FIXTURE_BLOG.bodyMedia.id,
  };
}

async function countRows(db: pg.PoolClient): Promise<Record<string, number>> {
  const ids = [FIXTURE_CLIENTS.a.id, FIXTURE_CLIENTS.b.id, FIXTURE_CLIENTS.empty.id];
  const counts: Record<string, number> = {};
  const tables = [
    "clients", "websites", "website_forms", "memberships", "tasks", "seo_pages", "seo_changes", "seo_redirects",
    "report_snapshots", "analytics_connections", "analytics_report_partitions", "analytics_report_rows",
    "analytics_metric_values", "analytics_coverage", "saved_reports", "saved_report_versions",
    "blog_articles", "blog_article_versions", "blog_media",
  ];
  for (const table of tables) {
    const column = table === "clients" ? "id" : "client_id";
    const { rows } = await db.query<{ n: string }>(`select count(*) as n from ${table} where ${column} = any($1::uuid[])`, [ids]);
    counts[table] = Number(rows[0]!.n);
  }
  counts.staff_users = Number((await db.query<{ n: string }>("select count(*) as n from staff_users where active")).rows[0]!.n);
  return counts;
}
