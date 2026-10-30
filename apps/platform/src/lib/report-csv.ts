import { REPORT_SECTIONS } from "@clinic-genie/contracts";
import { OPERATIONAL_TIME_ZONE, formatPeriod, type ReportBlock, type SavedFigure } from "@clinic-genie/db";
import { sourceLabel } from "@/components/modules/ReportDocument";

/** Display form of a download serial. The sequence starts at 1, so the first file is RD-0001. */
export function formatReportSerial(serial: number): string {
  return `RD-${String(serial).padStart(4, "0")}`;
}

function filePart(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

/** Clinic code, clinic name, Singapore date and time, then the download serial. The extension is added by the caller. */
export function reportDownloadName(clinicName: string, now: Date = new Date(), serial?: string, clinicCode?: string | null): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: OPERATIONAL_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const code = clinicCode ? filePart(clinicCode) : "";
  const clinic = filePart(clinicName) || "Clinic";
  const base = `${code ? `${code} ` : ""}${clinic} ${value("day")} ${value("month")} ${value("year")} ${value("hour")}-${value("minute")}`;
  return serial ? `${base} ${serial}` : base;
}

export function reportDownloadDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "").replace(/["\\]/g, "").trim() || "report.csv";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function line(values: Array<string | number | null | undefined>): string {
  return values.map(cell).join(",");
}

export function reportCsv(input: {
  serial: string;
  clinicCode: string | null;
  name: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  comparisonStart: string | null;
  comparisonEnd: string | null;
  sections: string[];
  figures: SavedFigure[];
  summary: string | null;
  observations: string | null;
  actionsTaken: string | null;
  nextSteps: string | null;
  dataSources: string[];
  lastRefresh: string;
  missingConnections: string[];
  limitationNote: string | null;
  blocks?: ReportBlock[];
}): string {
  const compared = Boolean(input.comparisonStart && input.comparisonEnd);
  const rows = [
    line(["Clinic code", input.clinicCode]),
    line(["Serial number", input.serial]),
    line(["Report", input.name]),
    line(["Client", input.clientName]),
    line(["Reporting period", formatPeriod(input.periodStart, input.periodEnd, " to ")]),
    line(["Comparison period", compared ? formatPeriod(input.comparisonStart!, input.comparisonEnd!, " to ") : ""]),
    "",
    line(["Section", "Metric", "Comparison", "Reporting period", "Change", "Change %"]),
  ];
  for (const block of input.blocks ?? []) {
    if (block.narrative || block.suggestion) rows.push(line([block.groupLabel, block.itemLabel, "", block.narrative || block.suggestion, "", block.narrative ? "" : "Suggested"]));
    for (const item of block.lines) rows.push(line([block.groupLabel, item.label, item.previous, item.current, item.change, item.note]));
  }
  for (const key of input.sections) {
    const section = REPORT_SECTIONS.find((item) => item.key === key);
    for (const figure of input.figures.filter((item) => item.section === key)) {
      rows.push(line([
        section?.label ?? key,
        figure.label,
        compared ? figure.previous : "",
        figure.current,
        compared ? figure.absoluteChange : "",
        compared ? figure.percentChange : "",
      ]));
    }
  }
  rows.push(
    "",
    line(["Summary", input.summary]),
    line(["Observations", input.observations]),
    line(["Actions taken", input.actionsTaken]),
    line(["Proposed next steps", input.nextSteps]),
    line(["Data sources", input.dataSources.map(sourceLabel).join(", ")]),
    line(["Last refresh", input.lastRefresh]),
    line(["Missing connections", input.missingConnections.map(sourceLabel).join(", ")]),
    line(["Measurement limitations", input.limitationNote]),
  );
  return `${rows.join("\n")}\n`;
}
