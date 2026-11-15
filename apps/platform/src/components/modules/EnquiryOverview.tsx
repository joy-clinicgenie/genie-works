import { formatPeriod } from "@clinic-genie/db";
import { enquiryChange, type EnquiryBoard, type EnquiryWindow } from "@/lib/form-submissions";

const GROUPS = [
  ["client", "By client"],
  ["website", "By website"],
  ["form", "By form"],
  ["source", "By source"],
] as const;

// Each breakdown shows its largest rows only; the rest are summarised as "+N more".
const TOP_ROWS = 5;

export function EnquiryOverview({ board, window, websiteNames }: { board: EnquiryBoard; window: EnquiryWindow; websiteNames: Map<string, string> }) {
  const groups = GROUPS.map(([key, title]) => ({
    title,
    rows: board.breakdowns[key]
      .map((row) => key === "website" ? { ...row, label: websiteNames.get(row.key) ?? row.label } : row)
      .sort((a, b) => b.current - a.current),
  }));
  return (
    <div className="mb-4 space-y-2">
      <div className="card flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Enquiries received</span>
        <span className="num text-2xl font-semibold">{board.currentTotal}</span>
        <span className="text-sm text-ink-soft">{enquiryChange(board.currentTotal, board.previousTotal)}</span>
        <span className="text-xs text-muted">{formatPeriod(window.from, window.to)} compared with {formatPeriod(window.previousFrom, window.previousTo)}</span>
      </div>
      <details className="card text-sm">
        <summary className="cursor-pointer px-5 py-3 font-medium">Breakdown by client, website, form and source</summary>
        <div className="grid gap-x-6 gap-y-4 px-5 pb-5 md:grid-cols-2 xl:grid-cols-4">
          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">{group.title}</h3>
              <ul className="space-y-1">
                {group.rows.slice(0, TOP_ROWS).map((row) => (
                  <li key={row.key} className="flex items-baseline justify-between gap-3" title={enquiryChange(row.current, row.previous)}>
                    <span className="min-w-0 truncate">{row.label}</span>
                    <span className="num shrink-0">{row.current}</span>
                  </li>
                ))}
                {group.rows.length > TOP_ROWS && <li className="text-xs text-muted">+{group.rows.length - TOP_ROWS} more</li>}
                {group.rows.length === 0 && <li className="text-muted">None in this period.</li>}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
