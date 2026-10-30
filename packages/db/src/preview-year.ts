/**
 * One year of synthetic analytics for CFAC, CEDAR and SUNRISE.
 * Fills every window the analytics picker can select, twelve rolling 30-day blocks,
 * and each calendar month from January 2025 through the month before today.
 * Existing headline rows are left in place. Missing rows are inserted. Device totals are
 * superseded only when extra session sources change the session sum.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { addDays, daysBetween, todaySgt } from "./services/dates";

const NOTE = "Synthetic demonstration figures for local preview. Not a live export.";
const CHANNELS = ["organic_search", "paid_search", "direct", "referral", "social", "email"] as const;
const DEVICES = ["mobile", "desktop", "tablet"] as const;

type PageProfile = { path: string; weight: number; clickRate: number; time: number; exit: number };
type ClinicProfile = {
  code: string;
  sessions: number[];
  visitors: number;
  newVisitors: number;
  returningVisitors: number;
  pageViews: number;
  postViews: number;
  contact: number;
  forms: number;
  enquiries: number;
  impressions: number;
  searchClicks: number;
  duration: number;
  pagesPer: number;
  bounce: number;
  position: number;
  pages: PageProfile[];
  flows: Array<{ name: string; weight: number }>;
};

const CLINICS: ClinicProfile[] = [
  {
    code: "CFAC",
    sessions: [684, 221, 204, 78, 52, 24],
    visitors: 972,
    newVisitors: 826,
    returningVisitors: 146,
    pageViews: 2388,
    postViews: 241,
    contact: 41,
    forms: 13,
    enquiries: 14,
    impressions: 15840,
    searchClicks: 531,
    duration: 98,
    pagesPer: 2.2,
    bounce: 46.2,
    position: 8.4,
    pages: [
      { path: "/", weight: 34, clickRate: 0.04, time: 72, exit: 38 },
      { path: "/aesthetic", weight: 22, clickRate: 0.09, time: 118, exit: 28 },
      { path: "/family-medicine", weight: 18, clickRate: 0.06, time: 96, exit: 32 },
      { path: "/doctors", weight: 14, clickRate: 0.05, time: 84, exit: 34 },
      { path: "/contact", weight: 12, clickRate: 0.22, time: 64, exit: 48 },
    ],
    flows: [
      { name: "Home → Aesthetic → Contact", weight: 40 },
      { name: "Home → Family medicine → Doctors", weight: 24 },
      { name: "Home → Contact", weight: 22 },
      { name: "Home → Doctors → Contact", weight: 14 },
    ],
  },
  {
    code: "CEDAR",
    sessions: [940, 154, 332, 110, 64, 28],
    visitors: 1088,
    newVisitors: 914,
    returningVisitors: 174,
    pageViews: 3490,
    postViews: 612,
    contact: 44,
    forms: 15,
    enquiries: 16,
    impressions: 20940,
    searchClicks: 764,
    duration: 124,
    pagesPer: 2.6,
    bounce: 41.5,
    position: 6.8,
    pages: [
      { path: "/", weight: 30, clickRate: 0.04, time: 80, exit: 36 },
      { path: "/diabetes", weight: 24, clickRate: 0.08, time: 132, exit: 26 },
      { path: "/thyroid", weight: 18, clickRate: 0.07, time: 118, exit: 29 },
      { path: "/articles", weight: 16, clickRate: 0.03, time: 146, exit: 42 },
      { path: "/contact", weight: 12, clickRate: 0.2, time: 70, exit: 46 },
    ],
    flows: [
      { name: "Home → Diabetes → Contact", weight: 38 },
      { name: "Home → Thyroid → Articles", weight: 26 },
      { name: "Home → Articles → Contact", weight: 20 },
      { name: "Home → Contact", weight: 16 },
    ],
  },
  {
    code: "SUNRISE",
    sessions: [468, 82, 61, 36, 22, 12],
    visitors: 441,
    newVisitors: 379,
    returningVisitors: 62,
    pageViews: 1510,
    postViews: 96,
    contact: 22,
    forms: 7,
    enquiries: 8,
    impressions: 9920,
    searchClicks: 248,
    duration: 86,
    pagesPer: 1.9,
    bounce: 54.8,
    position: 11.2,
    pages: [
      { path: "/", weight: 32, clickRate: 0.04, time: 68, exit: 40 },
      { path: "/heart-screening", weight: 26, clickRate: 0.1, time: 124, exit: 27 },
      { path: "/consultations", weight: 18, clickRate: 0.08, time: 102, exit: 31 },
      { path: "/team", weight: 12, clickRate: 0.05, time: 78, exit: 36 },
      { path: "/contact", weight: 12, clickRate: 0.24, time: 58, exit: 50 },
    ],
    flows: [
      { name: "Home → Heart screening → Contact", weight: 42 },
      { name: "Home → Consultations → Team", weight: 24 },
      { name: "Home → Contact", weight: 20 },
      { name: "Home → Team → Contact", weight: 14 },
    ],
  },
];

type Window = { start: string; end: string };
type Stored = { id: string; value: number };
type Pending = { source: string; channel: string; metric: string; dimension: string; value: number; start: string; end: string };

function weekStart(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const fromMonday = day === 0 ? 6 : day - 1;
  return addDays(iso, -fromMonday);
}

function yearWindows(today: string): Window[] {
  const map = new Map<string, Window>();
  const add = (start: string, end: string) => map.set(`${start}|${end}`, { start, end });
  add(today, today);
  add(addDays(today, -1), addDays(today, -1));
  add(addDays(today, -2), addDays(today, -2));
  add(addDays(today, -6), today);
  add(addDays(today, -13), addDays(today, -7));
  add(addDays(today, -13), today);
  add(addDays(today, -27), addDays(today, -14));
  add(addDays(today, -89), today);
  add(addDays(today, -179), addDays(today, -90));
  for (let index = 0; index < 12; index += 1) {
    const end = addDays(today, -index * 30);
    add(addDays(end, -29), end);
  }
  const monday = weekStart(today);
  const weekLength = daysBetween(monday, today);
  add(monday, today);
  const previousWeekEnd = addDays(monday, -1);
  add(addDays(previousWeekEnd, -weekLength), previousWeekEnd);
  const monthStart = `${today.slice(0, 8)}01`;
  const monthLength = daysBetween(monthStart, today);
  add(monthStart, today);
  const previousMonthEnd = addDays(monthStart, -1);
  add(addDays(previousMonthEnd, -monthLength), previousMonthEnd);
  add(addDays(today, -364), today);
  const previousYearEnd = addDays(today, -365);
  add(addDays(previousYearEnd, -364), previousYearEnd);
  let cursor = "2025-01-01";
  while (cursor < monthStart) {
    const [year, month] = cursor.split("-").map(Number);
    const nextMonth = month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, "0")}-01`;
    const monthEnd = addDays(nextMonth, -1);
    add(cursor, monthEnd);
    const length = daysBetween(cursor, monthEnd);
    const previousEnd = addDays(cursor, -1);
    add(addDays(previousEnd, -length), previousEnd);
    cursor = nextMonth;
  }
  return [...map.values()];
}

function trendAt(end: string, today: string): number {
  const ago = Math.max(0, daysBetween(end, today));
  return 0.78 + 0.22 * Math.max(0, 1 - ago / 365);
}

function lengthScale(window: Window, today: string): number {
  const days = daysBetween(window.start, window.end) + 1;
  return (days / 30) * trendAt(window.end, today);
}

function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((totalWeight, weight) => totalWeight + weight, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((weight) => (weight / sum) * total);
  const rounded = raw.map((value) => Math.round(value));
  let drift = total - rounded.reduce((totalValue, value) => totalValue + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  let step = 0;
  while (drift !== 0 && step < rounded.length * 4) {
    const index = order[step % order.length]!.index;
    if (drift > 0) {
      rounded[index] = (rounded[index] ?? 0) + 1;
      drift -= 1;
    } else if ((rounded[index] ?? 0) > 0) {
      rounded[index] = (rounded[index] ?? 0) - 1;
      drift += 1;
    }
    step += 1;
  }
  return rounded;
}

function rate(base: number, factor: number, places = 1): number {
  const value = Math.round(base * factor * 10 ** places) / 10 ** places;
  return value;
}

function planWindow(clinic: ClinicProfile, window: Window, today: string, have: Map<string, Stored>, pending: Pending[], replacements: Array<Pending & { id: string }>) {
  const remember = (source: string, channel: string, metric: string, value: number, dimension = "", replace = false) => {
    const id = `${source}|${channel}|${metric}|${dimension}|${window.start}|${window.end}`;
    const row = have.get(id);
    const rounded = Number(value.toFixed(2));
    if (!row) {
      pending.push({ source, channel, metric, dimension, value: rounded, start: window.start, end: window.end });
      have.set(id, { id: "", value: rounded });
      return rounded;
    }
    if (replace && row.id && Math.abs(Number(row.value) - rounded) > 0.05) {
      replacements.push({ id: row.id, source, channel, metric, dimension, value: rounded, start: window.start, end: window.end });
      row.value = rounded;
      return rounded;
    }
    return Number(row.value);
  };

  const organic = have.get(`ga4_export|organic_search|sessions||${window.start}|${window.end}`)?.value;
  const scale = organic != null && clinic.sessions[0] ? organic / clinic.sessions[0] : lengthScale(window, today);
  const trend = trendAt(window.end, today);
  const sessionParts = organic != null
    ? clinic.sessions.map((base, index) => remember("ga4_export", CHANNELS[index]!, "sessions", Math.round(base * scale)))
    : allocate(Math.round(clinic.sessions.reduce((sum, value) => sum + value, 0) * scale), clinic.sessions).map((value, index) => remember("ga4_export", CHANNELS[index]!, "sessions", value));
  const sessionTotal = sessionParts.reduce((sum, value) => sum + value, 0);
  allocate(sessionTotal, [70, 28, 2]).forEach((value, index) => remember("manual", DEVICES[index]!, "device_sessions", value, "", true));

  const visitors = remember("manual", "all", "unique_visitors", Math.round(clinic.visitors * scale));
  allocate(visitors, clinic.sessions).forEach((value, index) => remember("manual", CHANNELS[index]!, "unique_visitors", value));
  const visitorSplit = allocate(visitors, [clinic.newVisitors, clinic.returningVisitors]);
  remember("manual", "all", "new_visitors", visitorSplit[0] ?? 0);
  remember("manual", "all", "returning_visitors", visitorSplit[1] ?? 0);

  const pageViews = remember("manual", "all", "page_views", Math.round(clinic.pageViews * scale));
  remember("manual", "all", "post_views", Math.round(clinic.postViews * scale));
  const contact = remember("manual", "all", "contact_clicks", Math.round(clinic.contact * scale));
  const contactParts = allocate(contact, [46, 27, 15, 12]);
  ["contact_whatsapp", "contact_phone", "contact_email", "contact_booking"].forEach((metric, index) => remember("manual", "all", metric, contactParts[index] ?? 0));
  const forms = remember("manual", "all", "form_submissions", Math.round(clinic.forms * scale));
  remember("manual", "all", "form_views", Math.max(forms, Math.round(forms * 8)));
  remember("manual", "all", "form_starts", Math.max(forms, Math.round(forms * 2.4)));
  remember("manual", "all", "form_failures", forms === 0 ? 0 : Math.max(1, Math.round(forms * 0.08)));
  const enquiries = remember("clinic_records", "all", "enquiries", Math.round(clinic.enquiries * scale));
  remember("search_console_export", "organic_search", "impressions", Math.round(clinic.impressions * scale));
  remember("search_console_export", "organic_search", "clicks", Math.round(clinic.searchClicks * scale));
  remember("ga4_export", "all", "avg_session_duration", Math.round(clinic.duration * (0.94 + 0.1 * trend)));
  remember("ga4_export", "all", "pages_per_session", rate(clinic.pagesPer, 0.96 + 0.08 * trend));
  remember("ga4_export", "all", "bounce_rate", Math.min(95, Math.max(1, rate(clinic.bounce, 1.08 - 0.1 * trend))));
  remember("search_console_export", "organic_search", "avg_position", Math.min(40, Math.max(1, rate(clinic.position, 1.05 - 0.07 * trend))));

  if (enquiries > 0) allocate(enquiries, clinic.sessions).forEach((value, index) => remember("clinic_records", CHANNELS[index]!, "enquiries", value));
  if (forms > 0) allocate(forms, clinic.sessions).forEach((value, index) => remember("manual", CHANNELS[index]!, "form_submissions", value));
  if (pageViews > 0) {
    const visits = allocate(pageViews, clinic.pages.map((page) => page.weight));
    clinic.pages.forEach((page, index) => {
      const visitCount = visits[index] ?? 0;
      remember("manual", "all", "page_visits", visitCount, page.path);
      remember("manual", "all", "page_clicks", Math.round(visitCount * page.clickRate), page.path);
      remember("manual", "all", "page_time", Math.round(page.time * (0.94 + 0.1 * trend)), page.path);
      remember("manual", "all", "page_exit_rate", Math.min(95, Math.max(1, rate(page.exit, 1.06 - 0.08 * trend))), page.path);
    });
    allocate(sessionTotal, clinic.pages.map((page) => page.weight)).forEach((value, index) => remember("manual", "all", "landing_sessions", value, clinic.pages[index]!.path));
    allocate(contact, clinic.pages.map((page) => page.weight)).forEach((value, index) => remember("manual", "all", "landing_contacts", value, clinic.pages[index]!.path));
  }
  ["WhatsApp", "Call", "Email", "Book a visit", "Directions", "Services menu"].forEach((name, index) => {
    const value = index < 4 ? contactParts[index] ?? 0 : index === 4 ? Math.round(contact * 0.35) : Math.round(sessionTotal * 0.08);
    remember("manual", "all", "click_target", value, name);
  });
  if (sessionTotal > 0) {
    allocate(Math.round(sessionTotal * 0.62), clinic.flows.map((flow) => flow.weight)).forEach((value, index) => remember("manual", "all", "nav_flow", value, clinic.flows[index]!.name));
  }
  if (forms > 0) allocate(forms, [78, 14, 8]).forEach((value, index) => remember("manual", "all", "form_location", value, ["Singapore", "Johor", "Elsewhere"][index]!));
}

async function insertPending(db: pg.PoolClient, clientId: string, actor: string, rows: Pending[]) {
  for (let offset = 0; offset < rows.length; offset += 40) {
    const chunk = rows.slice(offset, offset + 40);
    const values: unknown[] = [];
    const placeholders = chunk.map((row, index) => {
      const base = index * 11;
      values.push(clientId, row.source, row.channel, row.metric, row.dimension, row.start, row.end, row.value, "count", NOTE, actor);
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`;
    });
    await db.query(
      `insert into report_snapshots (client_id, source, channel, metric, dimension, period_start, period_end, value, unit, note, entered_by)
       values ${placeholders.join(",")}`,
      values,
    );
  }
}

async function supersede(db: pg.PoolClient, clientId: string, actor: string, row: Pending & { id: string }) {
  const id = randomUUID();
  await db.query("update report_snapshots set superseded_by_id = $2 where id = $1 and superseded_by_id is null", [row.id, id]);
  await db.query(
    `insert into report_snapshots (id, client_id, source, channel, metric, dimension, period_start, period_end, value, unit, note, entered_by, supersedes_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'count', $10, $11, $12)`,
    [id, clientId, row.source, row.channel, row.metric, row.dimension, row.start, row.end, row.value, NOTE, actor, row.id],
  );
}

export async function ensureYearAnalytics(db: pg.PoolClient): Promise<string[]> {
  const admin = await db.query<{ id: string }>("select id from staff_users where email = 'admin@example.invalid' and active limit 1");
  const actor = admin.rows[0]?.id;
  if (!actor) return [];
  const today = todaySgt();
  const windows = yearWindows(today);
  const added: string[] = [];
  for (const clinic of CLINICS) {
    const found = await db.query<{ id: string }>("select id from clients where short_code = $1 and status = 'active'", [clinic.code]);
    const clientId = found.rows[0]?.id;
    if (!clientId) continue;
    const existing = await db.query<{ id: string; source: string; channel: string; metric: string; dimension: string; period_start: string; period_end: string; value: number }>(
      `select id, source, channel, metric, dimension, period_start::text as period_start, period_end::text as period_end, value
       from report_snapshots where client_id = $1 and superseded_by_id is null`,
      [clientId],
    );
    const have = new Map(existing.rows.map((row) => [`${row.source}|${row.channel}|${row.metric}|${row.dimension}|${row.period_start}|${row.period_end}`, { id: row.id, value: Number(row.value) }]));
    const pending: Pending[] = [];
    const replacements: Array<Pending & { id: string }> = [];
    for (const window of windows) planWindow(clinic, window, today, have, pending, replacements);
    if (pending.length === 0 && replacements.length === 0) continue;
    await insertPending(db, clientId, actor, pending);
    for (const row of replacements) await supersede(db, clientId, actor, row);
    added.push(clinic.code);
  }
  if (added.length) {
    await db.query(
      "insert into audit_events (actor_type, actor_user_id, action, target_type, outcome, metadata) values ('system', $1, 'seed.run', 'database', 'success', $2)",
      [actor, JSON.stringify({ synthetic: true, yearAnalytics: added })],
    );
  }
  return added;
}
