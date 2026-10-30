/**
 * Idempotent demonstration seed: three fictional clinics with overdue tasks, waiting follow-ups, decisions,
 * SEO and Ads changes, issues, sources and comparable performance periods. Every record is labelled synthetic.
 * Runs in one transaction and is a no-op when the demonstration clients already exist.
 */
import type pg from "pg";
import { addDays, todaySgt } from "./services/dates";
import { archiveClient, createClient, createWebsite, createAccountReference, createClientContact, createStaff, grantMembership } from "./services/registry";
import { createTask, transitionTask, addTaskNote } from "./services/tasks";
import { createApproval, decideApproval } from "./services/approvals";
import { createSeoPage, recordSeoChange, verifySeoChange } from "./services/seo";
import { createAdsAudit, addAdsFinding, recordAdsChange, verifyAdsChange, closeAdsAudit } from "./services/ads";
import { openIssue, transitionIssue, addEvidenceLink } from "./services/issues";
import { createClaim, addSource, assignReview, decideReview, addWording } from "./services/medical";
import { ensureYearAnalytics } from "./preview-year";
import { addSnapshot, addReportNote } from "./services/reports";

export interface SeedSummary {
  seeded: boolean;
  staff: number;
  clients: number;
  tasks: number;
}

export const DEMO_STAFF = [
  { email: "admin@example.invalid", name: "Demo Admin", role: "admin" },
  { email: "manager@example.invalid", name: "Demo Manager", role: "manager" },
  { email: "specialist-a@example.invalid", name: "Demo Specialist A", role: "specialist" },
  { email: "specialist-b@example.invalid", name: "Demo Specialist B", role: "specialist" },
  { email: "reviewer@example.invalid", name: "Demo Reviewer", role: "reviewer" },
  { email: "readonly@example.invalid", name: "Demo Read-only", role: "read_only" },
] as const;

const PREVIEW_NOTE = "Synthetic demonstration figures for local preview. Not a live export.";

type PreviewRow = { source: string; channel: string; metric: string; previous: number; current: number };

const PREVIEW_CLINICS: Array<{ code: string; rows: PreviewRow[] }> = [
  {
    code: "CFAC",
    rows: [
      { source: "ga4_export", channel: "organic_search", metric: "sessions", previous: 612, current: 684 },
      { source: "ga4_export", channel: "paid_search", metric: "sessions", previous: 248, current: 221 },
      { source: "ga4_export", channel: "direct", metric: "sessions", previous: 190, current: 204 },
      { source: "search_console_export", channel: "organic_search", metric: "impressions", previous: 14220, current: 15840 },
      { source: "search_console_export", channel: "organic_search", metric: "clicks", previous: 488, current: 531 },
      { source: "clinic_records", channel: "all", metric: "enquiries", previous: 11, current: 14 },
      { source: "manual", channel: "all", metric: "unique_visitors", previous: 905, current: 972 },
      { source: "manual", channel: "all", metric: "page_views", previous: 2140, current: 2388 },
      { source: "manual", channel: "all", metric: "post_views", previous: 266, current: 241 },
      { source: "manual", channel: "all", metric: "contact_clicks", previous: 36, current: 41 },
      { source: "manual", channel: "all", metric: "form_submissions", previous: 9, current: 13 },
    ],
  },
  {
    code: "CEDAR",
    rows: [
      { source: "ga4_export", channel: "organic_search", metric: "sessions", previous: 880, current: 940 },
      { source: "ga4_export", channel: "paid_search", metric: "sessions", previous: 120, current: 154 },
      { source: "ga4_export", channel: "direct", metric: "sessions", previous: 360, current: 332 },
      { source: "search_console_export", channel: "organic_search", metric: "impressions", previous: 22100, current: 20940 },
      { source: "search_console_export", channel: "organic_search", metric: "clicks", previous: 802, current: 764 },
      { source: "clinic_records", channel: "all", metric: "enquiries", previous: 18, current: 16 },
      { source: "manual", channel: "all", metric: "unique_visitors", previous: 1104, current: 1088 },
      { source: "manual", channel: "all", metric: "page_views", previous: 3610, current: 3490 },
      { source: "manual", channel: "all", metric: "post_views", previous: 540, current: 612 },
      { source: "manual", channel: "all", metric: "contact_clicks", previous: 48, current: 44 },
      { source: "manual", channel: "all", metric: "form_submissions", previous: 17, current: 15 },
    ],
  },
  {
    code: "SUNRISE",
    rows: [
      { source: "ga4_export", channel: "organic_search", metric: "sessions", previous: 390, current: 468 },
      { source: "ga4_export", channel: "paid_search", metric: "sessions", previous: 70, current: 82 },
      { source: "ga4_export", channel: "direct", metric: "sessions", previous: 55, current: 61 },
      { source: "search_console_export", channel: "organic_search", metric: "impressions", previous: 8640, current: 9920 },
      { source: "search_console_export", channel: "organic_search", metric: "clicks", previous: 210, current: 248 },
      { source: "clinic_records", channel: "all", metric: "enquiries", previous: 6, current: 8 },
      { source: "manual", channel: "all", metric: "unique_visitors", previous: 372, current: 441 },
      { source: "manual", channel: "all", metric: "page_views", previous: 1288, current: 1510 },
      { source: "manual", channel: "all", metric: "post_views", previous: 74, current: 96 },
      { source: "manual", channel: "all", metric: "contact_clicks", previous: 15, current: 22 },
      { source: "manual", channel: "all", metric: "form_submissions", previous: 4, current: 7 },
    ],
  },
];

/** New/returning visitors and device sessions. Each group sums to that clinic's visitor or session total. */
const TRAFFIC_SPLITS: Array<{ code: string; rows: PreviewRow[] }> = [
  {
    code: "CFAC",
    rows: [
      { source: "manual", channel: "all", metric: "new_visitors", previous: 760, current: 826 },
      { source: "manual", channel: "all", metric: "returning_visitors", previous: 145, current: 146 },
      { source: "manual", channel: "mobile", metric: "device_sessions", previous: 735, current: 776 },
      { source: "manual", channel: "desktop", metric: "device_sessions", previous: 294, current: 311 },
      { source: "manual", channel: "tablet", metric: "device_sessions", previous: 21, current: 22 },
    ],
  },
  {
    code: "CEDAR",
    rows: [
      { source: "manual", channel: "all", metric: "new_visitors", previous: 928, current: 914 },
      { source: "manual", channel: "all", metric: "returning_visitors", previous: 176, current: 174 },
      { source: "manual", channel: "mobile", metric: "device_sessions", previous: 925, current: 970 },
      { source: "manual", channel: "desktop", metric: "device_sessions", previous: 394, current: 413 },
      { source: "manual", channel: "tablet", metric: "device_sessions", previous: 41, current: 43 },
    ],
  },
  {
    code: "SUNRISE",
    rows: [
      { source: "manual", channel: "all", metric: "new_visitors", previous: 318, current: 379 },
      { source: "manual", channel: "all", metric: "returning_visitors", previous: 54, current: 62 },
      { source: "manual", channel: "mobile", metric: "device_sessions", previous: 360, current: 428 },
      { source: "manual", channel: "desktop", metric: "device_sessions", previous: 140, current: 165 },
      { source: "manual", channel: "tablet", metric: "device_sessions", previous: 15, current: 18 },
    ],
  },
];

/** Two matching 28-day periods for CFAC, CEDAR and SUNRISE. Skips a clinic that already has session rows. */
async function ensurePreviewSnapshots(db: pg.PoolClient): Promise<string[]> {
  const admin = await db.query<{ id: string }>("select id from staff_users where email = 'admin@example.invalid' and active limit 1");
  const actor = admin.rows[0]?.id;
  if (!actor) return [];
  const today = todaySgt();
  const periods = [
    { start: addDays(today, -59), end: addDays(today, -30), key: "previous" as const },
    { start: addDays(today, -29), end: today, key: "current" as const },
  ];
  const added: string[] = [];
  for (const clinic of PREVIEW_CLINICS) {
    const found = await db.query<{ id: string }>("select id from clients where short_code = $1 and status = 'active'", [clinic.code]);
    const clientId = found.rows[0]?.id;
    if (!clientId) continue;
    const currentPeriod = periods[1]!;
    const already = await db.query("select 1 from report_snapshots where client_id = $1 and source = 'ga4_export' and metric = 'sessions' and period_start = $2 and period_end = $3 and superseded_by_id is null limit 1", [clientId, currentPeriod.start, currentPeriod.end]);
    if (already.rows.length) continue;
    for (const row of clinic.rows) {
      for (const period of periods) {
        await db.query(
          `insert into report_snapshots (client_id, source, channel, metric, period_start, period_end, value, unit, note, entered_by)
           values ($1, $2, $3, $4, $5, $6, $7, 'count', $8, $9)`,
          [clientId, row.source, row.channel, row.metric, period.start, period.end, row[period.key], PREVIEW_NOTE, actor],
        );
      }
    }
    added.push(clinic.code);
  }
  for (const clinic of TRAFFIC_SPLITS) {
    const found = await db.query<{ id: string }>("select id from clients where short_code = $1 and status = 'active'", [clinic.code]);
    const clientId = found.rows[0]?.id;
    if (!clientId) continue;
    const currentPeriod = periods[1]!;
    const already = await db.query("select 1 from report_snapshots where client_id = $1 and metric = 'new_visitors' and period_start = $2 and period_end = $3 and superseded_by_id is null limit 1", [clientId, currentPeriod.start, currentPeriod.end]);
    if (already.rows.length) continue;
    for (const row of clinic.rows) {
      for (const period of periods) {
        await db.query(
          `insert into report_snapshots (client_id, source, channel, metric, period_start, period_end, value, unit, note, entered_by)
           values ($1, $2, $3, $4, $5, $6, $7, 'count', $8, $9)`,
          [clientId, row.source, row.channel, row.metric, period.start, period.end, row[period.key], PREVIEW_NOTE, actor],
        );
      }
    }
    added.push(`${clinic.code} traffic`);
  }
  if (added.length) {
    await db.query(
      "insert into audit_events (actor_type, actor_user_id, action, target_type, outcome, metadata) values ('system', $1, 'seed.run', 'database', 'success', $2)",
      [actor, JSON.stringify({ synthetic: true, previewSnapshots: added })],
    );
  }
  return added;
}

/** Internal agency directory row. Idempotent. Not a clinic client. */
async function ensureInternalAgencyClient(db: pg.PoolClient): Promise<void> {
  const existing = await db.query("select 1 from clients where slug = 'clinic-genie' or reference_number = 'CG-000'");
  if (existing.rows.length) return;
  const admin = await db.query<{ id: string }>("select id from staff_users where email = 'admin@example.invalid' and active limit 1");
  const actor = admin.rows[0]?.id;
  if (!actor) return;
  await createClient(db, {
    slug: "clinic-genie",
    name: "Clinic Genie",
    ownerUserId: actor,
    channels: ["website", "seo"],
    isSynthetic: false,
    notes: "Internal Clinic Genie record for agency work. Not a clinic client.",
    referenceNumber: "CG-000",
    shortCode: "CG",
    specialty: "Internal agency",
    legalName: "Clinic Genie",
    publicName: "Clinic Genie",
    enquiryOwnerUserId: actor,
    notificationOwnerUserId: actor,
    administrationOwnerUserId: actor,
  }, actor);
}

export async function seedDemo(pool: pg.Pool, log: (l: string) => void = () => {}): Promise<SeedSummary> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('app.context', 'service', true)");
    const exists = await db.query("select 1 from clients where slug = 'harbourview-dental'");
    if (exists.rows.length) {
      await ensureInternalAgencyClient(db);
      const added = await ensurePreviewSnapshots(db);
      const year = await ensureYearAnalytics(db);
      await db.query("commit");
      const notes = [
        added.length ? `Preview figures added for ${added.join(", ")}.` : "",
        year.length ? `One year of synthetic analytics added for ${year.join(", ")}.` : "",
      ].filter(Boolean);
      log(notes.length ? notes.join(" ") : "Demonstration data already present. Nothing changed.");
      return { seeded: false, staff: 0, clients: 0, tasks: 0 };
    }
    const today = todaySgt();
    const d = (n: number) => addDays(today, n);

    // Staff
    const ids: Record<string, string> = {};
    for (const s of DEMO_STAFF) {
      const existing = await db.query<{ id: string }>("select id from staff_users where email = $1", [s.email]);
      ids[s.role === "specialist" ? s.email : s.role] = existing.rows[0]?.id ?? (await createStaff(db, { email: s.email, displayName: s.name, role: s.role }, null));
    }
    const admin = ids.admin!, manager = ids.manager!, specA = ids["specialist-a@example.invalid"]!, specB = ids["specialist-b@example.invalid"]!, reviewer = ids.reviewer!, readonly = ids.read_only!;

    // Clients
    await ensureInternalAgencyClient(db);
    const harbour = await createClient(db, { slug: "harbourview-dental", name: "Harbourview Dental (fictional)", ownerUserId: specA, channels: ["website", "seo", "google_ads"], isSynthetic: true, notes: "Demonstration client. Two-chair general dental practice concept. All figures are synthetic.", specialty: "General dentistry", legalName: "Harbourview Dental Pte. Ltd. (fictional)", publicName: "Harbourview Dental", address: "18 Harbour Road, Singapore (fictional)", contactEmail: "hello@harbourview-dental.example.invalid", contactPhone: "+65 6000 0001", enquiryOwnerUserId: specA, notificationOwnerUserId: specA, administrationOwnerUserId: specA }, admin);
    const meridian = await createClient(db, { slug: "meridian-skin", name: "Meridian Skin Clinic (fictional)", ownerUserId: specA, channels: ["website", "seo", "social"], isSynthetic: true, notes: "Demonstration client. Aesthetic dermatology concept with medical claims under review.", specialty: "Dermatology", legalName: "Meridian Skin Pte. Ltd. (fictional)", publicName: "Meridian Skin Clinic", address: "42 Meridian Avenue, Singapore (fictional)", contactEmail: "hello@meridian-skin.example.invalid", contactPhone: "+65 6000 0002", enquiryOwnerUserId: specA, notificationOwnerUserId: specA, administrationOwnerUserId: specA }, admin);
    const northgate = await createClient(db, { slug: "northgate-physio", name: "Northgate Physio (fictional)", ownerUserId: specB, channels: ["website", "google_ads"], isSynthetic: true, notes: "Demonstration client. Physiotherapy practice concept, onboarding stage.", specialty: "Physiotherapy", legalName: "Northgate Physio Pte. Ltd. (fictional)", publicName: "Northgate Physio", address: "7 Northgate Lane, Singapore (fictional)", contactEmail: "hello@northgate-physio.example.invalid", contactPhone: "+65 6000 0003", enquiryOwnerUserId: specB, notificationOwnerUserId: specB, administrationOwnerUserId: specB }, admin);

    for (const [user, clients] of [
      [admin, [harbour.id, meridian.id, northgate.id]],
      [manager, [harbour.id, meridian.id, northgate.id]],
      [specA, [harbour.id, meridian.id]],
      [specB, [northgate.id]],
      [reviewer, [harbour.id, meridian.id]],
      [readonly, [harbour.id]],
    ] as const) {
      for (const c of clients) await grantMembership(db, { userId: user, clientId: c }, admin);
    }

    // Websites and account references (identifiers are placeholders, not real account IDs)
    const siteH = await createWebsite(db, { clientId: harbour.id, name: "Harbourview Dental website", url: "https://harbourview-dental.example.invalid", platform: "Wix", environment: "production", notes: "Live site managed on Wix. Placeholder URL." }, admin);
    const siteM = await createWebsite(db, { clientId: meridian.id, name: "Meridian Skin website", url: "https://meridian-skin.example.invalid", platform: "Next.js on Vercel", environment: "production", notes: "Placeholder URL." }, admin);
    await createWebsite(db, { clientId: meridian.id, name: "Meridian Skin staging", url: "https://staging.meridian-skin.example.invalid", platform: "Next.js on Vercel", environment: "staging", notes: "Password protected staging. Placeholder URL." }, admin);
    const siteN = await createWebsite(db, { clientId: northgate.id, name: "Northgate Physio website", url: "https://northgate-physio.example.invalid", platform: "Wix", environment: "production", notes: "Placeholder URL." }, admin);
    await createClientContact(db, harbour.id, { name: "Alex Tan (fictional)", designation: "Clinic director", workEmail: "hello@harbourview-dental.example.invalid", workPhone: "+65 6000 0001", isPrimary: true }, admin);
    await createClientContact(db, meridian.id, { name: "Priya Nair (fictional)", designation: "Practice manager", workEmail: "hello@meridian-skin.example.invalid", workPhone: "+65 6000 0002", isPrimary: true }, admin);
    await createClientContact(db, northgate.id, { name: "Jordan Lim (fictional)", designation: "Clinic coordinator", workEmail: "hello@northgate-physio.example.invalid", workPhone: "+65 6000 0003", isPrimary: true }, admin);

    const refAdsH = await createAccountReference(db, harbour.id, { kind: "google_ads", label: "Google Ads account", externalIdentifier: "PLACEHOLDER-ADS-ID", url: "https://ads.google.com/", vaultReference: "vault://clinic-genie/harbourview/google-ads", notes: "Identifier is a placeholder until the client supplies the real customer ID.", ownerUserId: specA }, admin);
    await createAccountReference(db, harbour.id, { kind: "ga4", label: "GA4 property", externalIdentifier: "PLACEHOLDER-GA4", url: "https://analytics.google.com/", vaultReference: null, notes: null, ownerUserId: specA }, admin);
    await createAccountReference(db, harbour.id, { kind: "search_console", label: "Search Console property", externalIdentifier: null, url: "https://search.google.com/search-console", vaultReference: null, notes: "Ownership verification pending.", ownerUserId: specA }, admin);
    await createAccountReference(db, meridian.id, { kind: "ga4", label: "GA4 property", externalIdentifier: "PLACEHOLDER-GA4", url: "https://analytics.google.com/", vaultReference: null, notes: null, ownerUserId: specA }, admin);
    await createAccountReference(db, meridian.id, { kind: "wix", label: "Wix site owner login", externalIdentifier: null, url: "https://manage.wix.com/", vaultReference: "vault://clinic-genie/meridian/wix", notes: "Credentials live in the vault, never here.", ownerUserId: specA }, admin);
    const refAdsN = await createAccountReference(db, northgate.id, { kind: "google_ads", label: "Google Ads account", externalIdentifier: "PLACEHOLDER-ADS-ID", url: "https://ads.google.com/", vaultReference: "vault://clinic-genie/northgate/google-ads", notes: null, ownerUserId: specB }, admin);

    // Tasks: overdue, due today, waiting, upcoming, completed, cancelled
    let tasks = 0;
    const mk = async (clientId: string, owner: string, title: string, priority: "low" | "medium" | "high" | "critical", due: string | null, extra: { description?: string; relatedType?: string; relatedId?: string } = {}) => {
      tasks++;
      return createTask(db, { clientId, title, description: extra.description ?? null, ownerUserId: owner, priority, dueDate: due, relatedType: extra.relatedType ?? null, relatedId: extra.relatedId ?? null }, admin);
    };
    const tH1 = await mk(harbour.id, specA, "Check Google Ads search terms for irrelevant queries", "high", d(-3), { description: "Review last 30 days of search terms and add negatives where spend is wasted." });
    await mk(harbour.id, specA, "Update implant page meta description", "medium", today);
    const tH3 = await mk(harbour.id, specA, "Confirm Search Console ownership with client", "medium", d(-1));
    await transitionTask(db, tH3, { status: "waiting", note: "Asked the practice manager for the DNS record.", waitingOn: "Client practice manager", followUpDate: d(-1) }, specA);
    await mk(harbour.id, specB, "Draft blog brief: fluoride treatment facts", "low", d(12));
    const tH5 = await mk(harbour.id, specA, "Record September performance figures", "medium", d(-10));
    await transitionTask(db, tH5, { status: "completed", note: "Figures entered from the GA4 export and the clinic's enquiry log." }, specA);
    const tH6 = await mk(harbour.id, specA, "Set up call tracking number", "low", d(5));
    await transitionTask(db, tH6, { status: "cancelled", note: "Client decided against call tracking this quarter." }, manager);
    await mk(harbour.id, manager, "Review quarterly plan with client", "high", d(3));
    const tM1 = await mk(meridian.id, specA, "Get reviewer decision on acne treatment claim", "critical", d(1), { description: "Launch copy is blocked until the claim is reviewed." });
    await mk(meridian.id, specA, "Fix duplicate target: two pages for chemical peel", "high", d(-6), { description: "Both /chemical-peel and /treatments/peel target the same keyword." });
    const tM3 = await mk(meridian.id, specA, "Collect before/after photo consent forms", "medium", d(-2));
    await transitionTask(db, tM3, { status: "waiting", note: "Clinic needs to sign the consent template first.", waitingOn: "Clinic director", followUpDate: d(2) }, specA);
    await mk(meridian.id, specA, "Publish updated privacy notice", "medium", d(6));
    await mk(northgate.id, specB, "Onboarding: confirm accountable contact and channels", "high", today);
    await mk(northgate.id, specB, "Baseline Google Ads audit", "medium", d(4));
    const tN3 = await mk(northgate.id, specB, "Verify website redirects after Wix page rename", "critical", d(-1));
    await addTaskNote(db, tH1, "Spend on 'free dental check' terms looks high. Checking match types first.", specA);
    await addTaskNote(db, tM1, "Reviewer assigned on the current wording.", specA);

    // Approvals: approved, submitted, changes requested, draft, superseded decision
    const apH1 = await createApproval(db, { clientId: harbour.id, title: "Add negative keyword list to Brand campaign", summary: "Add 14 negatives from the search terms review to stop wasted spend.", requestType: "ads_change", relatedType: "task", relatedId: tH1 }, specA, true);
    await decideApproval(db, apH1, { outcome: "approved", note: "Agreed. Keep the list to clearly irrelevant terms only." }, manager);
    await createApproval(db, { clientId: harbour.id, title: "Rewrite implant page title and description", summary: "Proposed: 'Dental implants in Singapore | Harbourview Dental'.", requestType: "seo_change", relatedType: null, relatedId: null }, specA, true);
    const apM1 = await createApproval(db, { clientId: meridian.id, title: "Acne treatment landing page copy", summary: "Copy for the new landing page. Medical claims need review before approval.", requestType: "content", relatedType: null, relatedId: null }, specA, true);
    await decideApproval(db, apM1, { outcome: "changes_requested", note: "Remove the 'clears acne in two weeks' line until the claim is reviewed and sourced." }, reviewer);
    await createApproval(db, { clientId: meridian.id, title: "Increase search budget for October", summary: "Draft only. Awaiting last month's figures.", requestType: "ads_change", relatedType: null, relatedId: null }, specA, false);
    const apN1 = await createApproval(db, { clientId: northgate.id, title: "Pause Display campaign", summary: "Display spend has no recorded enquiries over 60 days.", requestType: "ads_change", relatedType: null, relatedId: null }, specB, true);
    await decideApproval(db, apN1, { outcome: "changes_requested", note: "Reduce rather than pause until we see October data." }, manager);
    await decideApproval(db, apN1, { outcome: "approved", note: "Revised: pause is fine, client confirmed no awareness objective this quarter." }, manager);

    // SEO pages and changes
    const pH1 = await createSeoPage(db, harbour.id, { websiteId: siteH.id, pagePath: "/dental-implants", pageTitle: "Dental implants", primaryKeyword: "dental implants singapore", secondaryKeywords: ["implant cost singapore", "tooth implant"], searchIntent: "commercial", contentStatus: "published", ownerUserId: specA, lastReviewedOn: d(-20), nextReviewOn: d(40), mappingFlag: "none", flagNote: null, notes: null }, specA);
    const pH2 = await createSeoPage(db, harbour.id, { websiteId: siteH.id, pagePath: "/teeth-whitening", pageTitle: "Teeth whitening", primaryKeyword: "teeth whitening singapore", secondaryKeywords: [], searchIntent: "commercial", contentStatus: "needs_update", ownerUserId: specA, lastReviewedOn: d(-90), nextReviewOn: d(-5), mappingFlag: "thin_content", flagNote: "Page has 180 words and no FAQ. Competing pages answer cost and duration.", notes: null }, specA);
    await createSeoPage(db, harbour.id, { websiteId: siteH.id, pagePath: "/blog/fluoride-treatment", pageTitle: null, primaryKeyword: "fluoride treatment adults", secondaryKeywords: [], searchIntent: "informational", contentStatus: "planned", ownerUserId: specB, lastReviewedOn: null, nextReviewOn: null, mappingFlag: "none", flagNote: null, notes: "Brief in progress." }, specA);
    const pM1 = await createSeoPage(db, meridian.id, { websiteId: siteM.id, pagePath: "/chemical-peel", pageTitle: "Chemical peel", primaryKeyword: "chemical peel singapore", secondaryKeywords: [], searchIntent: "commercial", contentStatus: "published", ownerUserId: specA, lastReviewedOn: d(-30), nextReviewOn: d(30), mappingFlag: "duplicate_target", flagNote: "/treatments/peel targets the same keyword. Decide which page keeps it.", notes: null }, specA);
    await createSeoPage(db, meridian.id, { websiteId: siteM.id, pagePath: "/treatments/peel", pageTitle: "Peel treatments", primaryKeyword: "chemical peel singapore", secondaryKeywords: [], searchIntent: "commercial", contentStatus: "published", ownerUserId: specA, lastReviewedOn: d(-30), nextReviewOn: d(30), mappingFlag: "cannibalisation", flagNote: "Competes with /chemical-peel for the same query.", notes: null }, specA);
    await createSeoPage(db, meridian.id, { websiteId: siteM.id, pagePath: "/acne-treatment", pageTitle: "Acne treatment", primaryKeyword: "acne treatment singapore", secondaryKeywords: ["acne scar treatment"], searchIntent: "commercial", contentStatus: "in_review", ownerUserId: specA, lastReviewedOn: null, nextReviewOn: d(7), mappingFlag: "none", flagNote: null, notes: "Copy blocked on medical claim review." }, specA);
    await createSeoPage(db, northgate.id, { websiteId: siteN.id, pagePath: "/", pageTitle: "Northgate Physio", primaryKeyword: "physiotherapy singapore", secondaryKeywords: [], searchIntent: "navigational", contentStatus: "published", ownerUserId: specB, lastReviewedOn: null, nextReviewOn: d(14), mappingFlag: "wrong_intent", flagNote: "Home page targets a broad commercial query; a service page should own it.", notes: null }, specB);
    const chH1 = await recordSeoChange(db, pH1, { changeType: "title", beforeValue: "Implants | Harbourview", afterValue: "Dental implants in Singapore | Harbourview Dental", reason: "Title did not include the primary keyword or location.", changedOn: d(-18), approvalId: null }, specA);
    await verifySeoChange(db, chH1, { verificationOn: d(-4), outcomeNote: "Search Console shows the new title in results. Clicks for the primary query moved from 41 to 57 over the two weeks after. Other changes happened in the same window, so this is observed movement, not proof of cause." }, specA);
    await recordSeoChange(db, pH2, { changeType: "meta_description", beforeValue: "Whitening services.", afterValue: "Professional teeth whitening in Singapore. See costs, how long results last and what to expect.", reason: "Old description was a fragment with no call to action.", changedOn: d(-2), approvalId: null }, specA);
    await recordSeoChange(db, pM1, { changeType: "internal_links", beforeValue: "No links from /treatments/peel", afterValue: "Added a canonical-style link and note on /treatments/peel pointing to /chemical-peel", reason: "First step in resolving the duplicate target.", changedOn: d(-1), approvalId: null }, specA);

    // Google Ads audits, findings and changes
    const auH = await createAdsAudit(db, harbour.id, { accountReferenceId: refAdsH.id, title: "September search audit", periodStart: d(-48), periodEnd: d(-19), scope: "Brand and Implants search campaigns, all ad groups, search terms and landing pages.", summary: "Spend is concentrated on two ad groups. Search terms include unrelated 'free' queries." }, specA);
    const fH1 = await addAdsFinding(db, auH, { area: "search_terms", finding: "SGD 312 spent on terms containing 'free' or 'cheap' with no recorded enquiry.", severity: "high", recommendation: "Add negatives for free, cheap, cheapest, student." }, specA);
    await addAdsFinding(db, auH, { area: "landing_pages", finding: "Implants ad group sends traffic to the home page, not /dental-implants.", severity: "medium", recommendation: "Change the final URL to the implants page." }, specA);
    await addAdsFinding(db, auH, { area: "conversion_tracking", finding: "Form submission conversion is firing on page view of the form, not on submission.", severity: "high", recommendation: "Re-map the conversion to the success event." }, specA);
    const chAdsH = await recordAdsChange(db, harbour.id, { auditId: auH, findingId: fH1, scope: "Brand campaign, all ad groups", description: "Added 14 negative keywords (free, cheap, student and variants).", beforeValue: "0 negatives at campaign level", afterValue: "14 campaign-level negatives", reason: "Stop wasted spend on unrelated queries found in the audit.", responsibleUserId: specA, approvalId: apH1, implementedOn: d(-12) }, specA);
    await verifyAdsChange(db, chAdsH, { verificationOn: d(-2), outcomeNote: "No spend on the excluded terms in the ten days after the change. Overall clicks fell by 9%, cost fell by 14%. Enquiries unchanged. Observed only; no cause claimed." }, specA);
    await closeAdsAudit(db, auH, specA);
    const auN = await createAdsAudit(db, northgate.id, { accountReferenceId: refAdsN.id, title: "Onboarding baseline audit", periodStart: d(-60), periodEnd: d(-1), scope: "All campaigns.", summary: null }, specB);
    await addAdsFinding(db, auN, { area: "campaign", finding: "Display campaign has spent SGD 540 in 60 days with no recorded enquiry.", severity: "medium", recommendation: "Pause pending objective confirmation." }, specB);
    await recordAdsChange(db, northgate.id, { auditId: auN, findingId: null, scope: "Display campaign", description: "Paused the Display campaign.", beforeValue: "Enabled, SGD 9/day", afterValue: "Paused", reason: "No enquiries attributed in 60 days; client confirmed no awareness objective.", responsibleUserId: specB, approvalId: apN1, implementedOn: today }, specB);

    // Issues and evidence
    const isH1 = await openIssue(db, harbour.id, { title: "Contact form emails not reaching reception", description: "Two test submissions on the Wix form produced no email.", severity: "critical", ownerUserId: specA, relatedType: "website", relatedId: siteH.id }, specA);
    await transitionIssue(db, isH1, { status: "investigating", note: "Checking Wix form notification settings and spam folder." }, specA);
    await transitionIssue(db, isH1, { status: "resolved_pending_verification", note: "Notification address had a typo. Corrected and sent one test." }, specA);
    await addEvidenceLink(db, harbour.id, { issueId: isH1, label: "Screenshot of corrected notification setting (shared drive)", url: "https://drive.example.invalid/evidence/harbourview-form-fix" }, specA);
    const isH2 = await openIssue(db, harbour.id, { title: "Implants page returned 404 for a day", description: "Page was unpublished during an edit.", severity: "high", ownerUserId: specA, relatedType: "seo_page", relatedId: pH1 }, specA);
    await transitionIssue(db, isH2, { status: "resolved_pending_verification", note: "Republished the page." }, specA);
    await transitionIssue(db, isH2, { status: "verified_closed", note: "Fetched the URL on three devices and checked Search Console coverage. Returns 200.", verificationResult: "passed" }, manager);
    const isM1 = await openIssue(db, meridian.id, { title: "Before/after images shown without consent record", description: "Gallery shows four images with no consent form on file.", severity: "high", ownerUserId: specA, relatedType: "task", relatedId: tM3 }, reviewer);
    await transitionIssue(db, isM1, { status: "resolved_pending_verification", note: "Images hidden until consent forms are received." }, specA);
    await transitionIssue(db, isM1, { status: "reopened", note: "Two images are still visible in the mobile gallery.", verificationResult: "failed" }, reviewer);
    await openIssue(db, northgate.id, { title: "Redirects missing after Wix page rename", description: "Old /services URL returns 404.", severity: "high", ownerUserId: specB, relatedType: "task", relatedId: tN3 }, specB);

    // Medical claims
    const clM1 = await createClaim(db, meridian.id, { claimSummary: "Chemical peels improve the appearance of mild acne scarring", location: "/chemical-peel, second paragraph", wording: "Chemical peels can improve the appearance of mild acne scarring for some patients. Results vary and a consultation is needed to assess suitability." }, specA);
    await addSource(db, clM1, { title: "Clinical review of superficial peels for acne scarring (placeholder citation)", citation: "Journal placeholder, 2024; synthetic reference for demonstration", url: null, sourceType: "peer_reviewed", reviewId: null }, reviewer);
    const rvM1 = await assignReview(db, clM1, reviewer, specA);
    await decideReview(db, rvM1, { decision: "approved", note: "Wording is appropriately qualified and the source supports a modest claim. Approval here is a workflow outcome, not regulatory clearance." }, reviewer, false);
    const clM2 = await createClaim(db, meridian.id, { claimSummary: "Acne treatment clears acne in two weeks", location: "Acne landing page headline", wording: "Clears acne in two weeks." }, specA);
    const rvM2 = await assignReview(db, clM2, reviewer, specA);
    await decideReview(db, rvM2, { decision: "changes_required", note: "Absolute outcome claim with a fixed timescale. No source. Rephrase as a qualified statement about treatment plans." }, reviewer, false);
    await addWording(db, clM2, "Treatment plans are tailored to each patient. Improvement typically takes several weeks and varies between individuals.", specA);
    await assignReview(db, clM2, reviewer, specA);
    const clH1 = await createClaim(db, harbour.id, { claimSummary: "Painless dental implants", location: "Implants page hero", wording: "Painless dental implants." }, specA);
    const rvH1 = await assignReview(db, clH1, reviewer, specA);
    await decideReview(db, rvH1, { decision: "rejected", note: "Cannot be supported. Pain experience varies; 'painless' is an absolute claim." }, reviewer, false);

    // Reports: two like-for-like 28-day periods plus calendar months (different lengths, flagged by the tool)
    const p1 = { start: d(-55), end: d(-28) }, p2 = { start: d(-27), end: today };
    const metricsH: Array<[string, string, string, number | null, number | null]> = [
      ["search_console_export", "organic_search", "impressions", 18420, 21110],
      ["search_console_export", "organic_search", "clicks", 612, 701],
      ["ga4_export", "organic_search", "sessions", 540, 598],
      ["ga4_export", "paid_search", "sessions", 310, 282],
      ["google_ads_export", "paid_search", "clicks", 298, 271],
      ["google_ads_export", "paid_search", "cost", 1240.5, 1067.2],
      ["google_ads_export", "paid_search", "conversions_reported", 19, 17],
      ["clinic_records", "all", "enquiries", 31, 36],
      ["clinic_records", "all", "confirmed_appointments", 0, 9],
      ["clinic_records", "all", "patients", null, 7],
    ];
    for (const [source, channel, metric, v1, v2] of metricsH) {
      await addSnapshot(db, harbour.id, { source, channel, metric: metric as never, periodStart: p1.start, periodEnd: p1.end, value: v1, note: v1 === null ? "Clinic did not supply patient counts for this period." : null }, specA);
      await addSnapshot(db, harbour.id, { source, channel, metric: metric as never, periodStart: p2.start, periodEnd: p2.end, value: v2, note: metric === "confirmed_appointments" && v1 === 0 ? "Appointment confirmations were not recorded before this period." : null }, specA);
    }
    await addSnapshot(db, harbour.id, { source: "search_console_export", channel: "organic_search", metric: "clicks", periodStart: "2026-08-01", periodEnd: "2026-08-31", value: 655, note: "Calendar month" }, specA);
    await addSnapshot(db, harbour.id, { source: "search_console_export", channel: "organic_search", metric: "clicks", periodStart: "2026-09-01", periodEnd: "2026-09-30", value: 690, note: "Calendar month" }, specA);
    // A corrected snapshot: the first value is superseded, never edited.
    await addSnapshot(db, harbour.id, { source: "clinic_records", channel: "all", metric: "enquiries", periodStart: p2.start, periodEnd: p2.end, value: 38, note: "Corrected: two WhatsApp enquiries were missed in the first count." }, specA);
    await addReportNote(db, harbour.id, { periodStart: p2.start, periodEnd: p2.end, observation: "Organic clicks rose 14.5% against the previous 28 days while paid clicks fell 9%. Enquiries rose from 31 to 38. Confirmed appointments were not recorded in the earlier period, so no movement is shown.", possibleExplanations: "The implants title change and the negative keyword list both landed in this window. Either may be contributing; the data cannot separate them. Seasonality is unknown without a year-earlier baseline." }, specA);
    for (const [source, channel, metric, v1, v2] of [
      ["ga4_export", "organic_search", "sessions", 1210, 1188],
      ["clinic_records", "all", "enquiries", 44, 41],
      ["clinic_records", "all", "confirmed_appointments", 22, 25],
    ] as Array<[string, string, string, number, number]>) {
      await addSnapshot(db, meridian.id, { source, channel, metric: metric as never, periodStart: p1.start, periodEnd: p1.end, value: v1, note: null }, specA);
      await addSnapshot(db, meridian.id, { source, channel, metric: metric as never, periodStart: p2.start, periodEnd: p2.end, value: v2, note: null }, specA);
    }

    await archiveClient(db, harbour.id, admin);
    await archiveClient(db, meridian.id, admin);
    await archiveClient(db, northgate.id, admin);
    await ensurePreviewSnapshots(db);
    await ensureYearAnalytics(db);
    await db.query("insert into audit_events (actor_type, actor_user_id, action, target_type, outcome, metadata) values ('system', $1, 'seed.run', 'database', 'success', $2)", [admin, JSON.stringify({ synthetic: true, clients: 3, tasks })]);
    await db.query("commit");
    const summary = { seeded: true, staff: DEMO_STAFF.length, clients: 3, tasks };
    log(`Seed complete: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    db.release();
  }
}
