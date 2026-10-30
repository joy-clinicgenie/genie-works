import { REPORT_METRICS, REPORT_SECTION_KEYS, REPORT_SECTIONS, groupsForItems, checklistItem, isReportTemplate, isReportType, type ReportSectionKey, type ReportType } from "@clinic-genie/contracts";
import type { Queryable } from "../client";
import { recordAudit } from "./audit";
import { daysBetween, isValidDate } from "./dates";
import { compareValues } from "./reports";
import { composeReport, type ReportBlock } from "./report-builder";
import { recordTimeline } from "./timeline";

export { REPORT_SECTION_KEYS, REPORT_SECTIONS, type ReportSectionKey };

export interface SavedFigure {
  section: ReportSectionKey;
  metric: string;
  label: string;
  unit: string;
  current: number | null;
  previous: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
  status: string;
}

export interface ReportFacts {
  figures: SavedFigure[];
  dataSources: string[];
  lastRefresh: Date | null;
  missingConnections: string[];
  limitationNote: string;
}

export interface SavedReportInput {
  clientId: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  comparisonStart: string | null;
  comparisonEnd: string | null;
  sections: string[];
  summary: string | null;
  observations: string | null;
  actionsTaken: string | null;
  nextSteps: string | null;
  dataSourcesNote: string | null;
  missingConnections: string | null;
  measurementLimitations: string | null;
  websiteId?: string | null;
  reportType?: string | null;
  templateKey?: string | null;
  checklist?: string[];
  insights?: Record<string, string | null | undefined>;
}

export interface SavedReportRow {
  id: string;
  client_id: string;
  client_name: string;
  short_code: string | null;
  reference_number: string | null;
  name: string;
  period_start: string;
  period_end: string;
  comparison_start: string | null;
  comparison_end: string | null;
  sections: string[];
  summary: string | null;
  observations: string | null;
  actions_taken: string | null;
  next_steps: string | null;
  data_sources_note: string | null;
  missing_connections: string | null;
  measurement_limitations: string | null;
  website_id: string | null;
  website_label: string | null;
  report_type: ReportType;
  template_key: string | null;
  status: "draft" | "saved";
  checklist: string[];
  insights: Record<string, string>;
  created_by: string;
  creator_name: string;
  created_at: Date;
  updated_at: Date;
}

export interface SavedReportVersionRow {
  id: string;
  report_id: string;
  client_id: string;
  version_number: number;
  name: string;
  period_start: string;
  period_end: string;
  comparison_start: string | null;
  comparison_end: string | null;
  sections: string[];
  summary: string | null;
  observations: string | null;
  actions_taken: string | null;
  next_steps: string | null;
  data_sources_note: string | null;
  missing_connections: string | null;
  measurement_limitations: string | null;
  website_id: string | null;
  website_label: string | null;
  report_type: ReportType;
  template_key: string | null;
  checklist: string[];
  insights: Record<string, string>;
  blocks: ReportBlock[];
  figures: SavedFigure[];
  data_sources: string | null;
  last_refresh: Date | null;
  missing_connection_keys: string[];
  limitation_note: string | null;
  for_review: boolean;
  created_by: string;
  creator_name: string;
  created_at: Date;
}

export class SavedReportRuleError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "SavedReportRuleError";
  }
}

const REPORT_SELECT = `
  select r.id, r.client_id, c.name as client_name, c.short_code, c.reference_number, r.name,
         r.period_start::text as period_start, r.period_end::text as period_end,
         r.comparison_start::text as comparison_start, r.comparison_end::text as comparison_end,
         r.sections, r.summary, r.observations, r.actions_taken, r.next_steps,
         r.data_sources_note, r.missing_connections, r.measurement_limitations,
         r.website_id, r.website_label, r.report_type, r.template_key, r.status, r.checklist, r.insights,
         r.created_by, u.display_name as creator_name, r.created_at, r.updated_at
  from saved_reports r
  join clients c on c.id = r.client_id
  join staff_users u on u.id = r.created_by`;

function day(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function cleanText(value: string | null, max: number, label: string): string | null {
  const text = value?.trim() || null;
  if (text && text.length > max) throw new SavedReportRuleError(`${label} must be ${max} characters or fewer.`);
  return text;
}

function parseInput(input: SavedReportInput): SavedReportInput {
  const name = input.name.trim();
  if (!name) throw new SavedReportRuleError("Enter a report name.", "name");
  if (name.length > 160) throw new SavedReportRuleError("The report name must be 160 characters or fewer.", "name");
  if (!isValidDate(input.periodStart) || !isValidDate(input.periodEnd) || input.periodEnd < input.periodStart) {
    throw new SavedReportRuleError("Enter a reporting period that ends on or after it starts.", "periodEnd");
  }
  const comparisonStart = input.comparisonStart?.trim() || null;
  const comparisonEnd = input.comparisonEnd?.trim() || null;
  if ((comparisonStart && !comparisonEnd) || (!comparisonStart && comparisonEnd)) {
    throw new SavedReportRuleError("Enter both dates for the comparison period, or leave both blank.", "comparisonEnd");
  }
  if (comparisonStart && comparisonEnd && (!isValidDate(comparisonStart) || !isValidDate(comparisonEnd) || comparisonEnd < comparisonStart)) {
    throw new SavedReportRuleError("Enter a comparison period that ends on or after it starts.", "comparisonEnd");
  }
  const checklist = input.checklist === undefined
    ? undefined
    : [...new Set(input.checklist)].filter((item) => checklistItem(item));
  const sections = checklist && checklist.length > 0
    ? groupsForItems(checklist)
    : [...new Set(input.sections)].filter((section): section is ReportSectionKey => (REPORT_SECTION_KEYS as readonly string[]).includes(section));
  if (sections.length === 0) throw new SavedReportRuleError("Choose at least one report section.", "sections");
  const reportType = isReportType(input.reportType) ? input.reportType : "custom";
  const templateKey = isReportTemplate(input.templateKey) ? input.templateKey : null;
  const insights: Record<string, string | null> = {};
  if (input.insights) {
    for (const [key, value] of Object.entries(input.insights)) {
      if (!checklistItem(key) || checklistItem(key)?.kind !== "insight") continue;
      insights[key] = cleanText(value ?? null, 4000, checklistItem(key)?.label ?? "Insight");
    }
  }
  return {
    ...input,
    name,
    comparisonStart,
    comparisonEnd,
    sections,
    checklist,
    reportType,
    templateKey,
    websiteId: input.websiteId?.trim() || null,
    insights,
    summary: cleanText(input.summary, 4000, "Summary"),
    observations: cleanText(input.observations, 4000, "Observations"),
    actionsTaken: cleanText(input.actionsTaken, 4000, "Actions taken"),
    nextSteps: cleanText(input.nextSteps, 4000, "Proposed next steps"),
    dataSourcesNote: cleanText(input.dataSourcesNote, 2000, "Data sources note"),
    missingConnections: cleanText(input.missingConnections, 2000, "Missing connections"),
    measurementLimitations: cleanText(input.measurementLimitations, 2000, "Measurement limitations"),
  };
}

function metricMeta(key: string) {
  return REPORT_METRICS.find((metric) => metric.key === key);
}

function pickValue(rows: Array<{ metric: string; channel: string; period_start: string; period_end: string; value: number | null }>, metric: string, start: string, end: string): number | null | undefined {
  const matched = rows.filter((row) => row.metric === metric && day(row.period_start) === start && day(row.period_end) === end);
  if (matched.length === 0) return undefined;
  const combined = matched.find((row) => row.channel === "all" && row.value !== null);
  if (combined) return Number(combined.value);
  const parts = matched.filter((row) => row.channel !== "all" && row.value !== null);
  if (parts.length === 0) return null;
  return parts.reduce((sum, row) => sum + Number(row.value), 0);
}

export async function gatherReportFacts(db: Queryable, report: { client_id: string; period_start: string; period_end: string; comparison_start: string | null; comparison_end: string | null; sections: string[] }): Promise<ReportFacts> {
  const selected = REPORT_SECTIONS.filter((section) => report.sections.includes(section.key));
  const sources = [...new Set(selected.map((section) => section.source))];
  const metrics = [...new Set(selected.flatMap((section) => section.metrics))];
  const { rows } = await db.query<{ metric: string; channel: string; source: string; period_start: string; period_end: string; value: number | null; created_at: Date }>(
    `select metric, channel, source, period_start::text as period_start, period_end::text as period_end, value, created_at
     from report_snapshots
     where client_id = $1 and superseded_by_id is null
       and source = any($2::text[]) and metric = any($3::text[])
       and (
         (period_start = $4::date and period_end = $5::date)
         or ($6::date is not null and period_start = $6::date and period_end = $7::date)
       )`,
    [report.client_id, sources, metrics, report.period_start, report.period_end, report.comparison_start, report.comparison_end],
  );
  const figures: SavedFigure[] = [];
  for (const section of selected) {
    for (const metric of section.metrics) {
      const meta = metricMeta(metric);
      if (!meta) continue;
      const current = pickValue(rows.filter((row) => row.source === section.source), metric, report.period_start, report.period_end);
      const previous = report.comparison_start && report.comparison_end
        ? pickValue(rows.filter((row) => row.source === section.source), metric, report.comparison_start, report.comparison_end)
        : undefined;
      const compared = compareValues(metric, meta.label, meta.unit, current === undefined ? undefined : { value: current }, previous === undefined ? undefined : { value: previous });
      figures.push({
        section: section.key,
        metric,
        label: meta.label,
        unit: meta.unit,
        current: compared.current,
        previous: report.comparison_start ? compared.previous : null,
        absoluteChange: report.comparison_start ? compared.absoluteChange : null,
        percentChange: report.comparison_start ? compared.percentChange : null,
        status: compared.status,
      });
    }
  }
  const recorded = await db.query<{ source: string; created_at: Date }>(
    `select source, created_at from report_snapshots
     where client_id = $1 and superseded_by_id is null
       and (
         (period_start = $2::date and period_end = $3::date)
         or ($4::date is not null and period_start = $4::date and period_end = $5::date)
       )`,
    [report.client_id, report.period_start, report.period_end, report.comparison_start, report.comparison_end],
  );
  const present = new Set(recorded.rows.map((row) => row.source));
  const watched = ["ga4_export", "search_console_export", "google_ads_export", "clinic_records"];
  const missingConnections = watched.filter((source) => !present.has(source));
  const dataSources = [...present];
  const lastRefresh = recorded.rows.reduce<Date | null>((latest, row) => (!latest || row.created_at > latest ? row.created_at : latest), null);
  const notes = ["Unavailable figures stay blank. A contact click is not an enquiry or a confirmed appointment."];
  if (!report.comparison_start) notes.push("No comparison period is selected, so movement is not shown.");
  else if (daysBetween(report.period_start, report.period_end) !== daysBetween(report.comparison_start, report.comparison_end!)) {
    notes.push("The reporting period and the comparison period differ in length, so movements are not like-for-like.");
  }
  return { figures, dataSources, lastRefresh, missingConnections, limitationNote: notes.join(" ") };
}

async function websiteChoice(db: Queryable, clientId: string, websiteId: string | null | undefined): Promise<{ id: string | null; label: string | null }> {
  if (!websiteId) return { id: null, label: null };
  const { rows } = await db.query<{ name: string; url: string | null }>("select name, url from websites where id = $1 and client_id = $2", [websiteId, clientId]);
  const website = rows[0];
  if (!website) throw new SavedReportRuleError("Choose a website that belongs to this client.", "websiteId");
  return { id: websiteId, label: website.url ? `${website.name} (${website.url})` : website.name };
}

async function insertVersion(db: Queryable, reportId: string, input: SavedReportInput, actorUserId: string, forReview: boolean): Promise<{ id: string; version_number: number }> {
  const facts = await gatherReportFacts(db, {
    client_id: input.clientId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    comparison_start: input.comparisonStart,
    comparison_end: input.comparisonEnd,
    sections: input.sections,
  });
  const website = await websiteChoice(db, input.clientId, input.websiteId);
  const composition = input.checklist?.length
    ? await composeReport(db, {
        clientId: input.clientId,
        websiteId: website.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        comparisonStart: input.comparisonStart,
        comparisonEnd: input.comparisonEnd,
        items: input.checklist,
      })
    : null;
  const next = await db.query<{ n: number }>("select coalesce(max(version_number), 0) + 1 as n from saved_report_versions where report_id = $1", [reportId]);
  const { rows } = await db.query<{ id: string; version_number: number }>(
    `insert into saved_report_versions (
       report_id, client_id, version_number, name, period_start, period_end, comparison_start, comparison_end, sections,
       summary, observations, actions_taken, next_steps, data_sources_note, missing_connections, measurement_limitations,
       figures, data_sources, last_refresh, missing_connection_keys, limitation_note, for_review, created_by,
       website_id, website_label, report_type, template_key, checklist, insights, blocks
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, $15, $16,
       $17::jsonb, $18, $19, $20, $21, $22, $23,
       $24, $25, $26, $27, $28, $29::jsonb, $30::jsonb
     ) returning id, version_number`,
    [
      reportId, input.clientId, next.rows[0]!.n, input.name, input.periodStart, input.periodEnd, input.comparisonStart, input.comparisonEnd, input.sections,
      input.summary, input.observations, input.actionsTaken, input.nextSteps, input.dataSourcesNote, input.missingConnections, input.measurementLimitations,
      JSON.stringify(facts.figures), facts.dataSources.join(", ") || null, facts.lastRefresh, facts.missingConnections, composition?.limitationNote ?? facts.limitationNote, forReview, actorUserId,
      website.id, website.label, input.reportType ?? "custom", input.templateKey ?? null, input.checklist ?? [], JSON.stringify(input.insights ?? {}), JSON.stringify(composition?.blocks ?? []),
    ],
  );
  return rows[0]!;
}

export interface DashboardDraft {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  updatedAt: Date;
}

/** Unfinished drafts only. Saved-for-review reports are excluded. The latest row is the most recently edited. */
export async function dashboardReportAttention(db: Queryable, clientId?: string | null): Promise<{ draftCount: number; latest: DashboardDraft | null }> {
  const id = clientId ?? null;
  const count = await db.query<{ count: number }>(
    `select count(*)::int as count from saved_reports where status = 'draft' and ($1::uuid is null or client_id = $1)`,
    [id],
  );
  const latest = await db.query<{ id: string; name: string; client_id: string; client_name: string; updated_at: Date }>(
    `select r.id, r.name, r.client_id, c.name as client_name, r.updated_at
     from saved_reports r
     join clients c on c.id = r.client_id
     where r.status = 'draft' and ($1::uuid is null or r.client_id = $1)
     order by r.updated_at desc, r.id desc
     limit 1`,
    [id],
  );
  const row = latest.rows[0];
  return {
    draftCount: Number(count.rows[0]?.count ?? 0),
    latest: row ? { id: row.id, name: row.name, clientId: row.client_id, clientName: row.client_name, updatedAt: row.updated_at } : null,
  };
}

export async function listSavedReports(db: Queryable, clientId?: string): Promise<SavedReportRow[]> {
  const { rows } = await db.query<SavedReportRow>(
    `${REPORT_SELECT} where ($1::uuid is null or r.client_id = $1) order by r.created_at desc limit 100`,
    [clientId ?? null],
  );
  return rows.map(normaliseReport);
}

export async function getSavedReport(db: Queryable, id: string): Promise<(SavedReportRow & { versions: SavedReportVersionRow[] }) | null> {
  const { rows } = await db.query<SavedReportRow>(`${REPORT_SELECT} where r.id = $1`, [id]);
  const report = rows[0];
  if (!report) return null;
  const versions = await db.query<SavedReportVersionRow>(
    `select v.id, v.report_id, v.client_id, v.version_number, v.name,
            v.period_start::text as period_start, v.period_end::text as period_end,
            v.comparison_start::text as comparison_start, v.comparison_end::text as comparison_end,
            v.sections, v.summary, v.observations, v.actions_taken, v.next_steps,
            v.data_sources_note, v.missing_connections, v.measurement_limitations,
            v.website_id, v.website_label, v.report_type, v.template_key, v.checklist, v.insights, v.blocks,
            v.figures, v.data_sources, v.last_refresh, v.missing_connection_keys, v.limitation_note,
            v.for_review, v.created_by, u.display_name as creator_name, v.created_at
     from saved_report_versions v join staff_users u on u.id = v.created_by
     where v.report_id = $1 order by v.version_number desc`,
    [id],
  );
  return { ...normaliseReport(report), versions: versions.rows.map(normaliseVersion) };
}

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.trim()) record[key] = item;
  }
  return record;
}

function normaliseReport(row: SavedReportRow): SavedReportRow {
  return {
    ...row,
    period_start: day(row.period_start)!,
    period_end: day(row.period_end)!,
    comparison_start: day(row.comparison_start),
    comparison_end: day(row.comparison_end),
    checklist: row.checklist ?? [],
    insights: asRecord(row.insights),
    report_type: isReportType(row.report_type) ? row.report_type : "custom",
    status: row.status === "draft" ? "draft" : "saved",
  };
}

function normaliseVersion(row: SavedReportVersionRow): SavedReportVersionRow {
  const figures = Array.isArray(row.figures) ? row.figures : [];
  return {
    ...row,
    period_start: day(row.period_start)!,
    period_end: day(row.period_end)!,
    comparison_start: day(row.comparison_start),
    comparison_end: day(row.comparison_end),
    figures,
    checklist: row.checklist ?? [],
    insights: asRecord(row.insights),
    blocks: Array.isArray(row.blocks) ? row.blocks : [],
    report_type: isReportType(row.report_type) ? row.report_type : "custom",
    missing_connection_keys: row.missing_connection_keys ?? [],
  };
}

export async function createSavedReport(db: Queryable, input: SavedReportInput, actorUserId: string, origin: { duplicateOf?: string; draft?: boolean } = {}): Promise<string> {
  const parsed = parseInput(input);
  const website = await websiteChoice(db, parsed.clientId, parsed.websiteId);
  const status = origin.draft ? "draft" : "saved";
  const { rows } = await db.query<{ id: string }>(
    `insert into saved_reports (
       client_id, name, period_start, period_end, comparison_start, comparison_end, sections,
       summary, observations, actions_taken, next_steps, data_sources_note, missing_connections, measurement_limitations, created_by,
       website_id, website_label, report_type, template_key, status, checklist, insights
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb) returning id`,
    [parsed.clientId, parsed.name, parsed.periodStart, parsed.periodEnd, parsed.comparisonStart, parsed.comparisonEnd, parsed.sections, parsed.summary, parsed.observations, parsed.actionsTaken, parsed.nextSteps, parsed.dataSourcesNote, parsed.missingConnections, parsed.measurementLimitations, actorUserId, website.id, website.label, parsed.reportType ?? "custom", parsed.templateKey ?? null, status, parsed.checklist ?? [], JSON.stringify(parsed.insights ?? {})],
  );
  const id = rows[0]!.id;
  const version = origin.draft ? null : await insertVersion(db, id, parsed, actorUserId, true);
  await recordAudit(db, { actorType: "staff", actorUserId, action: origin.duplicateOf ? "saved_report.duplicate" : "saved_report.create", targetType: "saved_report", targetId: id, clientId: parsed.clientId, outcome: "success", metadata: { versionNumber: version?.version_number ?? null, duplicateOf: origin.duplicateOf ?? null, status } });
  await recordTimeline(db, { clientId: parsed.clientId, eventType: "report_saved", title: `${origin.duplicateOf ? "Report duplicated" : origin.draft ? "Report draft saved" : "Report created"}: ${parsed.name}`.slice(0, 300), relatedType: "saved_report", relatedId: id, actorUserId, dedupeKey: `saved_report_created:${id}` });
  return id;
}

export async function saveSavedReport(db: Queryable, id: string, input: SavedReportInput, actorUserId: string, options: { review?: boolean } = {}): Promise<number | null> {
  const parsed = parseInput(input);
  const current = await getSavedReport(db, id);
  if (!current) throw new SavedReportRuleError("That report was not found.");
  if (current.client_id !== parsed.clientId) throw new SavedReportRuleError("A saved report stays with its client.");
  const review = options.review !== false;
  const builder = Boolean(parsed.checklist && parsed.checklist.length > 0);
  const website = builder ? await websiteChoice(db, parsed.clientId, parsed.websiteId) : null;
  const { rowCount } = builder
    ? await db.query(
        `update saved_reports set name = $2, period_start = $3, period_end = $4, comparison_start = $5, comparison_end = $6, sections = $7,
           summary = $8, observations = $9, actions_taken = $10, next_steps = $11, data_sources_note = $12, missing_connections = $13,
           measurement_limitations = $14, website_id = $15, website_label = $16, report_type = $17, template_key = $18, status = $19,
           checklist = $20, insights = $21::jsonb, updated_at = now()
         where id = $1`,
        [id, parsed.name, parsed.periodStart, parsed.periodEnd, parsed.comparisonStart, parsed.comparisonEnd, parsed.sections, parsed.summary, parsed.observations, parsed.actionsTaken, parsed.nextSteps, parsed.dataSourcesNote, parsed.missingConnections, parsed.measurementLimitations, website!.id, website!.label, parsed.reportType ?? "custom", parsed.templateKey ?? null, review ? "saved" : "draft", parsed.checklist, JSON.stringify(parsed.insights ?? {})],
      )
    : await db.query(
        `update saved_reports set name = $2, period_start = $3, period_end = $4, comparison_start = $5, comparison_end = $6, sections = $7,
           summary = $8, observations = $9, actions_taken = $10, next_steps = $11, data_sources_note = $12, missing_connections = $13,
           measurement_limitations = $14, updated_at = now()
         where id = $1`,
        [id, parsed.name, parsed.periodStart, parsed.periodEnd, parsed.comparisonStart, parsed.comparisonEnd, parsed.sections, parsed.summary, parsed.observations, parsed.actionsTaken, parsed.nextSteps, parsed.dataSourcesNote, parsed.missingConnections, parsed.measurementLimitations],
      );
  if (!rowCount) throw new SavedReportRuleError("That report was not found.");
  if (!review) {
    await recordAudit(db, { actorType: "staff", actorUserId, action: "saved_report.draft", targetType: "saved_report", targetId: id, clientId: parsed.clientId, outcome: "success" });
    return null;
  }
  const version = await insertVersion(db, id, parsed, actorUserId, true);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "saved_report.save", targetType: "saved_report", targetId: id, clientId: parsed.clientId, outcome: "success", metadata: { versionNumber: version.version_number } });
  await recordTimeline(db, { clientId: parsed.clientId, eventType: "report_saved", title: `Report version ${version.version_number} saved: ${parsed.name}`.slice(0, 300), relatedType: "saved_report", relatedId: id, actorUserId, dedupeKey: `saved_report_version:${version.id}` });
  return version.version_number;
}

export async function issueReportDownload(
  db: Queryable,
  input: { reportId: string; clientId: string; versionNumber: number | null; format: "csv" | "pdf"; actorUserId: string },
): Promise<number> {
  const { rows } = await db.query<{ serial_number: number }>(
    `insert into saved_report_downloads (report_id, client_id, version_number, format, downloaded_by)
     values ($1, $2, $3, $4, $5)
     returning serial_number`,
    [input.reportId, input.clientId, input.versionNumber, input.format, input.actorUserId],
  );
  const serial = rows[0]?.serial_number;
  if (!serial) throw new Error("Report download serial was not issued");
  return serial;
}

export async function duplicateSavedReport(db: Queryable, id: string, actorUserId: string): Promise<string> {
  const current = await getSavedReport(db, id);
  if (!current) throw new SavedReportRuleError("That report was not found.");
  const name = `Copy of ${current.name}`.slice(0, 160);
  return createSavedReport(db, {
    clientId: current.client_id,
    name,
    periodStart: current.period_start,
    periodEnd: current.period_end,
    comparisonStart: current.comparison_start,
    comparisonEnd: current.comparison_end,
    sections: current.sections,
    summary: current.summary,
    observations: current.observations,
    actionsTaken: current.actions_taken,
    nextSteps: current.next_steps,
    dataSourcesNote: current.data_sources_note,
    missingConnections: current.missing_connections,
    measurementLimitations: current.measurement_limitations,
    websiteId: current.website_id,
    reportType: current.report_type,
    templateKey: current.template_key,
    checklist: current.checklist,
    insights: current.insights,
  }, actorUserId, { duplicateOf: id, draft: current.status === "draft" });
}
