import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReportBlock } from "./report-builder";
import { getSavedReport, SavedReportRuleError, type SavedFigure, type SavedReportRow, type SavedReportVersionRow } from "./saved-reports";
import type { Queryable } from "../client";

const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SavedReportArtifact {
  status: "saved";
  reportId: string;
  versionId: string;
  versionNumber: number;
  clientId: string;
  clientName: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  comparisonStart: string | null;
  comparisonEnd: string | null;
  figures: SavedFigure[];
  blocks: ReportBlock[];
  summary: string | null;
  observations: string | null;
  actionsTaken: string | null;
  nextSteps: string | null;
  limitationNote: string | null;
  savedAt: string;
}

export function defaultReportArtifactDirectory(): string {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, "docs", "DECISIONS.md"))) return join(dir, "docs", "report");
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new SavedReportRuleError("The saved-report folder could not be found.");
}

export function savedReportArtifactFileName(reportId: string, versionNumber: number): string {
  if (!REPORT_ID.test(reportId) || !Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new SavedReportRuleError("The saved copy could not be named.");
  }
  return `${reportId.toLowerCase()}-v${versionNumber}.json`;
}

export function savedReportArtifactExists(reportId: string, versionNumber: number, directory = defaultReportArtifactDirectory()): boolean {
  return existsSync(join(directory, savedReportArtifactFileName(reportId, versionNumber)));
}

export function artifactFromSavedVersion(report: SavedReportRow, version: SavedReportVersionRow): SavedReportArtifact {
  return {
    status: "saved",
    reportId: report.id,
    versionId: version.id,
    versionNumber: version.version_number,
    clientId: report.client_id,
    clientName: report.client_name,
    name: version.name,
    periodStart: version.period_start,
    periodEnd: version.period_end,
    comparisonStart: version.comparison_start,
    comparisonEnd: version.comparison_end,
    figures: version.figures,
    blocks: version.blocks,
    summary: version.summary,
    observations: version.observations,
    actionsTaken: version.actions_taken,
    nextSteps: version.next_steps,
    limitationNote: version.limitation_note,
    savedAt: version.created_at instanceof Date ? version.created_at.toISOString() : new Date(version.created_at).toISOString(),
  };
}

export async function writeSavedReportArtifact(directory: string, artifact: SavedReportArtifact): Promise<{ fileName: string; created: boolean }> {
  if (artifact.status !== "saved") throw new SavedReportRuleError("A draft is not stored as a saved copy.");
  const fileName = savedReportArtifactFileName(artifact.reportId, artifact.versionNumber);
  const root = resolve(directory);
  const full = join(root, fileName);
  if (full !== resolve(root, fileName)) throw new SavedReportRuleError("The saved copy could not be named.");
  const body = `${JSON.stringify(artifact, null, 2)}\n`;
  await mkdir(root, { recursive: true });
  try {
    await writeFile(full, body, { flag: "wx" });
    return { fileName, created: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return { fileName, created: false };
    throw new SavedReportRuleError("The saved copy could not be stored.");
  }
}

export interface SavedReportArtifactCopy {
  fileName: string;
  sha256: string;
  body: string;
}

/** Reads saved JSON that belongs to a backed-up version. A missing file is omitted. A draft file is not read. */
export function readSavedReportArtifactCopies(
  directory: string,
  versions: Array<{ report_id: string; version_number: number; status?: string }>,
): SavedReportArtifactCopy[] {
  const copies: SavedReportArtifactCopy[] = [];
  for (const version of versions) {
    if (version.status === "draft") continue;
    let fileName: string;
    try {
      fileName = savedReportArtifactFileName(version.report_id, version.version_number);
    } catch {
      continue;
    }
    const full = join(directory, fileName);
    if (!existsSync(full)) continue;
    const body = readFileSync(full, "utf8");
    let parsed: { status?: string; reportId?: string };
    try {
      parsed = JSON.parse(body) as { status?: string; reportId?: string };
    } catch {
      continue;
    }
    if (parsed.status !== "saved" || parsed.reportId?.toLowerCase() !== version.report_id.toLowerCase()) continue;
    copies.push({ fileName, sha256: createHash("sha256").update(body).digest("hex"), body });
  }
  return copies;
}

/** Writes restored JSON into an isolated directory. The source folder is never the destination. */
export function assertArtifactRestoreDirectory(sourceDirectory: string, destinationDirectory: string): void {
  const source = resolve(sourceDirectory);
  const destination = resolve(destinationDirectory);
  if (source === destination || destination.startsWith(source + sep)) {
    throw new SavedReportRuleError("Refusing recovery: saved report files would be written back over the source copies.");
  }
}

export async function restoreSavedReportArtifactCopies(
  sourceDirectory: string,
  destinationDirectory: string,
  copies: SavedReportArtifactCopy[],
): Promise<{ restored: number; mismatches: string[] }> {
  assertArtifactRestoreDirectory(sourceDirectory, destinationDirectory);
  const mismatches: string[] = [];
  await mkdir(destinationDirectory, { recursive: true });
  for (const copy of copies) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-v[1-9][0-9]*\.json$/.test(copy.fileName)) {
      mismatches.push(`report file name refused: ${copy.fileName}`);
      continue;
    }
    const hash = createHash("sha256").update(copy.body).digest("hex");
    if (hash !== copy.sha256) {
      mismatches.push(`report file hash mismatch: ${copy.fileName}`);
      continue;
    }
    const full = join(destinationDirectory, copy.fileName);
    if (resolve(full) !== resolve(destinationDirectory, copy.fileName)) {
      mismatches.push(`report file path refused: ${copy.fileName}`);
      continue;
    }
    await writeFile(full, copy.body, { flag: "wx" });
    const written = readFileSync(full, "utf8");
    if (createHash("sha256").update(written).digest("hex") !== copy.sha256) mismatches.push(`report file changed: ${copy.fileName}`);
  }
  return { restored: copies.length - mismatches.length, mismatches };
}

/** Writes the newest saved version. A draft returns null and writes nothing. An existing file is left unchanged. */
export async function storeSavedReportArtifact(db: Queryable, reportId: string, directory: string): Promise<{ fileName: string; created: boolean } | null> {
  const report = await getSavedReport(db, reportId);
  if (!report || report.status !== "saved") return null;
  const version = report.versions[0];
  if (!version) return null;
  return writeSavedReportArtifact(directory, artifactFromSavedVersion(report, version));
}
