import { REPORT_SECTIONS, REPORT_TYPE_LABELS, type ReportType } from "@clinic-genie/contracts";
import type { ReportBlock, SavedFigure } from "@clinic-genie/db";
import { formatDateTime, formatPeriod } from "../../../../../packages/db/src/services/dates";
import { label } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";

const SOURCE_LABEL: Record<string, string> = {
  ga4_export: "Analytics export",
  search_console_export: "Search Console export",
  google_ads_export: "Google Ads export",
  clinic_records: "Clinic enquiry records",
  manual: "Manual entry",
  other: "Other",
};

function figureText(value: number | null, unit: string, status: string): string {
  if (value === null) return status === "not_recorded" ? "Not recorded" : "Unavailable";
  return unit === "sgd" ? `SGD ${value.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value.toLocaleString("en-SG");
}

function changeText(figure: SavedFigure, compared: boolean): string {
  if (!compared) return "";
  if (figure.percentChange !== null) return `${figure.percentChange > 0 ? "+" : ""}${figure.percentChange}%`;
  if (figure.status === "zero_baseline") return "Zero baseline, no %";
  if (figure.status === "not_recorded") return "Not recorded";
  return "Not shown";
}

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? label(source);
}

export function ReportDocument({
  name,
  clientName,
  periodStart,
  periodEnd,
  comparisonStart,
  comparisonEnd,
  sections,
  figures,
  summary,
  observations,
  actionsTaken,
  nextSteps,
  dataSources,
  dataSourcesNote,
  lastRefresh,
  missingConnections,
  missingNote,
  limitationNote,
  measurementLimitations,
  caption,
  blocks,
  websiteLabel,
  reportType,
  preparedBy,
}: {
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
  dataSourcesNote: string | null;
  lastRefresh: Date | null;
  missingConnections: string[];
  missingNote: string | null;
  limitationNote: string | null;
  measurementLimitations: string | null;
  caption?: string;
  blocks?: ReportBlock[];
  websiteLabel?: string | null;
  reportType?: string | null;
  preparedBy?: string | null;
}) {
  const compared = Boolean(comparisonStart && comparisonEnd);
  const checklist = blocks && blocks.length > 0;
  return (
    <div className="space-y-6">
      {caption && <p className="text-sm text-muted">{caption}</p>}
      <div>
        <h3 className="text-lg font-semibold">{name}</h3>
        <p className="mt-1 text-sm text-muted">
          {clientName}
          {websiteLabel ? ` · ${websiteLabel}` : ""}
          {reportType ? ` · ${REPORT_TYPE_LABELS[reportType as ReportType] ?? reportType}` : ""}
          {" · "}{formatPeriod(periodStart, periodEnd, " to ")}
          {compared ? ` · compared with ${formatPeriod(comparisonStart!, comparisonEnd!, " to ")}` : ""}
          {preparedBy ? ` · Prepared by ${preparedBy}` : ""}
        </p>
      </div>
      {blocks && blocks.length > 0 && <ChecklistBlocks blocks={blocks} compared={compared} />}
      {!checklist && sections.map((key) => {
        const section = REPORT_SECTIONS.find((item) => item.key === key);
        const rows = figures.filter((figure) => figure.section === key);
        if (!section) return null;
        return (
          <section key={key} id={key} className="scroll-mt-28">
            <h4 className="text-sm font-semibold">{section.label}</h4>
            <Table caption={section.label}>
              <thead>
                <tr>
                  <Th>Metric</Th>
                  {compared && <Th align="right">Comparison</Th>}
                  <Th align="right">Reporting period</Th>
                  {compared && <Th align="right">Change</Th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((figure) => (
                  <tr key={figure.metric}>
                    <Td>{figure.label}</Td>
                    {compared && <Td align="right">{figureText(figure.previous, figure.unit, figure.status)}</Td>}
                    <Td align="right">{figureText(figure.current, figure.unit, figure.status)}</Td>
                    {compared && <Td align="right">{changeText(figure, compared)}</Td>}
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        );
      })}
      {!checklist && <section className="space-y-3 text-sm">
        <h4 className="font-semibold">Written commentary</h4>
        <Commentary label="Summary" text={summary} />
        <Commentary label="Observations" text={observations} />
        <Commentary label="Actions taken" text={actionsTaken} />
        <Commentary label="Proposed next steps" text={nextSteps} />
      </section>}
      {!checklist && <section className="space-y-2 text-sm">
        <h4 className="font-semibold">Data notes</h4>
        <p><span className="font-medium">Data sources. </span>{dataSources.length ? dataSources.map(sourceLabel).join(", ") : "Not recorded"}{dataSourcesNote ? `. ${dataSourcesNote}` : ""}</p>
        <p><span className="font-medium">Last refresh. </span>{lastRefresh ? formatDateTime(lastRefresh) : "Not recorded"}</p>
        <p><span className="font-medium">Missing connections. </span>{missingConnections.length ? missingConnections.map(sourceLabel).join(", ") : "None recorded for this period"}{missingNote ? `. ${missingNote}` : ""}</p>
        <p><span className="font-medium">Measurement limitations. </span>{[limitationNote, measurementLimitations].filter(Boolean).join(" ") || "Not recorded"}</p>
      </section>}
      {checklist && limitationNote && <p className="text-sm text-muted">{limitationNote}</p>}
    </div>
  );
}

function ChecklistBlocks({ blocks, compared }: { blocks: ReportBlock[]; compared: boolean }) {
  const groups: Array<{ key: string; label: string; blocks: ReportBlock[] }> = [];
  for (const block of blocks) {
    const current = groups.find((group) => group.key === block.groupKey);
    if (current) current.blocks.push(block);
    else groups.push({ key: block.groupKey, label: block.groupLabel, blocks: [block] });
  }
  return (
    <>
      {groups.map((group) => (
        <section key={group.key} id={group.key} className="scroll-mt-28 space-y-4">
          <h4 className="text-sm font-semibold">{group.label}</h4>
          {group.blocks.map((block) => (
            <div key={block.itemKey} className="space-y-2">
              <h5 className="text-sm font-medium">{block.itemLabel}</h5>
              {block.narrative && <p className="whitespace-pre-wrap text-sm">{block.narrative}</p>}
              {!block.narrative && block.suggestion && <p className="whitespace-pre-wrap text-sm text-muted">Suggested from recorded work. {block.suggestion}</p>}
              {block.lines.length > 0 && (
                <Table caption={block.itemLabel}>
                  <thead>
                    <tr>
                      <Th>Item</Th>
                      {compared && <Th align="right">Comparison</Th>}
                      <Th align="right">Reporting period</Th>
                      {compared && <Th align="right">Change</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {block.lines.map((line) => (
                      <tr key={`${block.itemKey}-${line.label}`}>
                        <Td>
                          {line.label}
                          {line.note && <span className="mt-1 block text-xs text-muted">{line.note}</span>}
                        </Td>
                        {compared && <Td align="right">{line.previous ?? ""}</Td>}
                        <Td align="right">{line.current}</Td>
                        {compared && <Td align="right">{line.change ?? ""}</Td>}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

function Commentary({ label: title, text }: { label: string; text: string | null }) {
  return (
    <p className="whitespace-pre-wrap">
      <span className="font-medium">{title}. </span>
      {text || <span className="text-muted">Not written</span>}
    </p>
  );
}
