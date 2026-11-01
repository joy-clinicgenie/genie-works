/**
 * Idempotent demonstration seed: one fictional clinic with tasks, waiting follow-ups, decisions,
 * SEO changes, issues, sources and comparable performance periods. Every record is labelled synthetic.
 * Runs in one transaction and is a no-op when that demonstration client already exists.
 */
import type pg from "pg";
import { addDays, todaySgt } from "./services/dates";
import { archiveClient, createClient, createWebsite, createAccountReference, createClientContact, createStaff, grantMembership } from "./services/registry";
import { createTask, transitionTask, addTaskNote } from "./services/tasks";
import { createApproval, decideApproval } from "./services/approvals";
import { createSeoPage, recordSeoChange } from "./services/seo";
import { openIssue, transitionIssue } from "./services/issues";
import { createClaim, addSource, assignReview, decideReview, addWording } from "./services/medical";
import { ensureYearAnalytics } from "./preview-year";
import { addSnapshot } from "./services/reports";

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

/** One current snapshot row. A repeat of the live unique key inserts nothing. */
export async function insertPreviewSnapshot(
  db: pg.PoolClient,
  values: [string, string, string, string, string, string, number, string, string],
): Promise<number> {
  const result = await db.query(
    `insert into report_snapshots (client_id, source, channel, metric, dimension, period_start, period_end, value, unit, note, entered_by)
     values ($1, $2, $3, $4, '', $5, $6, $7, 'count', $8, $9)
     on conflict do nothing`,
    values,
  );
  return result.rowCount ?? 0;
}

/** Two matching 28-day periods for CFAC, CEDAR and SUNRISE. A clinic that already has the current session row is left unchanged. A row that already matches report_snapshots_current_idx is skipped. */
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
    let inserted = 0;
    for (const row of clinic.rows) {
      for (const period of periods) {
        inserted += await insertPreviewSnapshot(db, [clientId, row.source, row.channel, row.metric, period.start, period.end, row[period.key], PREVIEW_NOTE, actor]);
      }
    }
    if (inserted) added.push(clinic.code);
  }
  for (const clinic of TRAFFIC_SPLITS) {
    const found = await db.query<{ id: string }>("select id from clients where short_code = $1 and status = 'active'", [clinic.code]);
    const clientId = found.rows[0]?.id;
    if (!clientId) continue;
    const currentPeriod = periods[1]!;
    const already = await db.query("select 1 from report_snapshots where client_id = $1 and metric = 'new_visitors' and period_start = $2 and period_end = $3 and superseded_by_id is null limit 1", [clientId, currentPeriod.start, currentPeriod.end]);
    if (already.rows.length) continue;
    let inserted = 0;
    for (const row of clinic.rows) {
      for (const period of periods) {
        inserted += await insertPreviewSnapshot(db, [clientId, row.source, row.channel, row.metric, period.start, period.end, row[period.key], PREVIEW_NOTE, actor]);
      }
    }
    if (inserted) added.push(`${clinic.code} traffic`);
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
    const exists = await db.query("select 1 from clients where slug = 'meridian-skin'");
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
    const admin = ids.admin!, manager = ids.manager!, specA = ids["specialist-a@example.invalid"]!, reviewer = ids.reviewer!;

    // One fictional clinic. Specialist B and the read-only account stay on the staff list with no client.
    await ensureInternalAgencyClient(db);
    const meridian = await createClient(db, { slug: "meridian-skin", name: "Meridian Skin Clinic (fictional)", ownerUserId: specA, channels: ["website", "seo", "social"], isSynthetic: true, notes: "Demonstration client. Aesthetic dermatology concept with medical claims under review.", specialty: "Dermatology", legalName: "Meridian Skin Pte. Ltd. (fictional)", publicName: "Meridian Skin Clinic", address: "42 Meridian Avenue, Singapore (fictional)", contactEmail: "hello@meridian-skin.example.invalid", contactPhone: "+65 6000 0002", enquiryOwnerUserId: specA, notificationOwnerUserId: specA, administrationOwnerUserId: specA }, admin);

    for (const [user, clients] of [
      [admin, [meridian.id]],
      [manager, [meridian.id]],
      [specA, [meridian.id]],
      [reviewer, [meridian.id]],
    ] as const) {
      for (const c of clients) await grantMembership(db, { userId: user, clientId: c }, admin);
    }

    const siteM = await createWebsite(db, { clientId: meridian.id, name: "Meridian Skin website", url: "https://meridian-skin.example.invalid", platform: "Next.js on Vercel", environment: "production", notes: "Placeholder URL." }, admin);
    await createWebsite(db, { clientId: meridian.id, name: "Meridian Skin staging", url: "https://staging.meridian-skin.example.invalid", platform: "Next.js on Vercel", environment: "staging", notes: "Password protected staging. Placeholder URL." }, admin);
    await createClientContact(db, meridian.id, { name: "Priya Nair (fictional)", designation: "Practice manager", workEmail: "hello@meridian-skin.example.invalid", workPhone: "+65 6000 0002", isPrimary: true }, admin);
    await createAccountReference(db, meridian.id, { kind: "ga4", label: "GA4 property", externalIdentifier: "PLACEHOLDER-GA4", url: "https://analytics.google.com/", vaultReference: null, notes: null, ownerUserId: specA }, admin);
    await createAccountReference(db, meridian.id, { kind: "wix", label: "Wix site owner login", externalIdentifier: null, url: "https://manage.wix.com/", vaultReference: "vault://clinic-genie/meridian/wix", notes: "Credentials live in the vault, never here.", ownerUserId: specA }, admin);

    let tasks = 0;
    const mk = async (clientId: string, owner: string, title: string, priority: "low" | "medium" | "high" | "critical", due: string | null, extra: { description?: string; relatedType?: string; relatedId?: string } = {}) => {
      tasks++;
      return createTask(db, { clientId, title, description: extra.description ?? null, ownerUserId: owner, priority, dueDate: due, relatedType: extra.relatedType ?? null, relatedId: extra.relatedId ?? null }, admin);
    };
    const tM1 = await mk(meridian.id, specA, "Get reviewer decision on acne treatment claim", "critical", d(1), { description: "Launch copy is blocked until the claim is reviewed." });
    await mk(meridian.id, specA, "Fix duplicate target: two pages for chemical peel", "high", d(-6), { description: "Both /chemical-peel and /treatments/peel target the same keyword." });
    const tM3 = await mk(meridian.id, specA, "Collect before/after photo consent forms", "medium", d(-2));
    await transitionTask(db, tM3, { status: "waiting", note: "Clinic needs to sign the consent template first.", waitingOn: "Clinic director", followUpDate: d(2) }, specA);
    await mk(meridian.id, specA, "Publish updated privacy notice", "medium", d(6));
    await addTaskNote(db, tM1, "Reviewer assigned on the current wording.", specA);

    const apM1 = await createApproval(db, { clientId: meridian.id, title: "Acne treatment landing page copy", summary: "Copy for the new landing page. Medical claims need review before approval.", requestType: "content", relatedType: null, relatedId: null }, specA, true);
    await decideApproval(db, apM1, { outcome: "changes_requested", note: "Remove the 'clears acne in two weeks' line until the claim is reviewed and sourced." }, reviewer);
    await createApproval(db, { clientId: meridian.id, title: "Increase search budget for October", summary: "Draft only. Awaiting last month's figures.", requestType: "ads_change", relatedType: null, relatedId: null }, specA, false);

    const pM1 = await createSeoPage(db, meridian.id, { websiteId: siteM.id, pagePath: "/chemical-peel", pageTitle: "Chemical peel", primaryKeyword: "chemical peel singapore", secondaryKeywords: [], searchIntent: "commercial", contentStatus: "published", ownerUserId: specA, lastReviewedOn: d(-30), nextReviewOn: d(30), mappingFlag: "duplicate_target", flagNote: "/treatments/peel targets the same keyword. Decide which page keeps it.", notes: null }, specA);
    await createSeoPage(db, meridian.id, { websiteId: siteM.id, pagePath: "/treatments/peel", pageTitle: "Peel treatments", primaryKeyword: "chemical peel singapore", secondaryKeywords: [], searchIntent: "commercial", contentStatus: "published", ownerUserId: specA, lastReviewedOn: d(-30), nextReviewOn: d(30), mappingFlag: "cannibalisation", flagNote: "Competes with /chemical-peel for the same query.", notes: null }, specA);
    await createSeoPage(db, meridian.id, { websiteId: siteM.id, pagePath: "/acne-treatment", pageTitle: "Acne treatment", primaryKeyword: "acne treatment singapore", secondaryKeywords: ["acne scar treatment"], searchIntent: "commercial", contentStatus: "in_review", ownerUserId: specA, lastReviewedOn: null, nextReviewOn: d(7), mappingFlag: "none", flagNote: null, notes: "Copy blocked on medical claim review." }, specA);
    await recordSeoChange(db, pM1, { changeType: "internal_links", beforeValue: "No links from /treatments/peel", afterValue: "Added a canonical-style link and note on /treatments/peel pointing to /chemical-peel", reason: "First step in resolving the duplicate target.", changedOn: d(-1), approvalId: null }, specA);

    const isM1 = await openIssue(db, meridian.id, { title: "Before/after images shown without consent record", description: "Gallery shows four images with no consent form on file.", severity: "high", ownerUserId: specA, relatedType: "task", relatedId: tM3 }, reviewer);
    await transitionIssue(db, isM1, { status: "resolved_pending_verification", note: "Images hidden until consent forms are received." }, specA);
    await transitionIssue(db, isM1, { status: "reopened", note: "Two images are still visible in the mobile gallery.", verificationResult: "failed" }, reviewer);

    const clM1 = await createClaim(db, meridian.id, { claimSummary: "Chemical peels improve the appearance of mild acne scarring", location: "/chemical-peel, second paragraph", wording: "Chemical peels can improve the appearance of mild acne scarring for some patients. Results vary and a consultation is needed to assess suitability." }, specA);
    await addSource(db, clM1, { title: "Clinical review of superficial peels for acne scarring (placeholder citation)", citation: "Journal placeholder, 2024; synthetic reference for demonstration", url: null, sourceType: "peer_reviewed", reviewId: null }, reviewer);
    const rvM1 = await assignReview(db, clM1, reviewer, specA);
    await decideReview(db, rvM1, { decision: "approved", note: "Wording is appropriately qualified and the source supports a modest claim. Approval here is a workflow outcome, not regulatory clearance." }, reviewer, false);
    const clM2 = await createClaim(db, meridian.id, { claimSummary: "Acne treatment clears acne in two weeks", location: "Acne landing page headline", wording: "Clears acne in two weeks." }, specA);
    const rvM2 = await assignReview(db, clM2, reviewer, specA);
    await decideReview(db, rvM2, { decision: "changes_required", note: "Absolute outcome claim with a fixed timescale. No source. Rephrase as a qualified statement about treatment plans." }, reviewer, false);
    await addWording(db, clM2, "Treatment plans are tailored to each patient. Improvement typically takes several weeks and varies between individuals.", specA);
    await assignReview(db, clM2, reviewer, specA);

    const p1 = { start: d(-55), end: d(-28) }, p2 = { start: d(-27), end: today };
    for (const [source, channel, metric, v1, v2] of [
      ["ga4_export", "organic_search", "sessions", 1210, 1188],
      ["clinic_records", "all", "enquiries", 44, 41],
      ["clinic_records", "all", "confirmed_appointments", 22, 25],
    ] as Array<[string, string, string, number, number]>) {
      await addSnapshot(db, meridian.id, { source, channel, metric: metric as never, periodStart: p1.start, periodEnd: p1.end, value: v1, note: null }, specA);
      await addSnapshot(db, meridian.id, { source, channel, metric: metric as never, periodStart: p2.start, periodEnd: p2.end, value: v2, note: null }, specA);
    }

    await archiveClient(db, meridian.id, admin);
    await ensurePreviewSnapshots(db);
    await ensureYearAnalytics(db);
    await db.query("insert into audit_events (actor_type, actor_user_id, action, target_type, outcome, metadata) values ('system', $1, 'seed.run', 'database', 'success', $2)", [admin, JSON.stringify({ synthetic: true, clients: 1, tasks })]);
    await db.query("commit");
    const summary = { seeded: true, staff: DEMO_STAFF.length, clients: 1, tasks };
    log(`Seed complete: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    db.release();
  }
}
