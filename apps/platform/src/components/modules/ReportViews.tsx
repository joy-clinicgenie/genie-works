import type { PeriodComparison, SnapshotRow } from "@clinic-genie/db";
import { formatPeriod } from "@clinic-genie/db";
import { Badge, label } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";

function fmt(v: number | null, unit: string): string {
  if (v === null) return "Unavailable";
  return unit === "sgd" ? `SGD ${v.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : v.toLocaleString("en-SG");
}

export function ComparisonTable({ comparison }: { comparison: PeriodComparison }) {
  const recorded = comparison.metrics.filter((m) => m.metric !== "patients" && m.status !== "not_recorded");
  return (
    <Table caption="Period comparison">
      <thead>
        <tr>
          <Th>Metric</Th>
          <Th align="right">{formatPeriod(comparison.previous.start, comparison.previous.end, " to ")}</Th>
          <Th align="right">{formatPeriod(comparison.current.start, comparison.current.end, " to ")}</Th>
          <Th align="right">Change</Th>
          <Th align="right">Change %</Th>
        </tr>
      </thead>
      <tbody>
        {recorded.map((m) => (
          <tr key={m.metric}>
            <Td>{m.label}</Td>
            <Td align="right">{fmt(m.previous, m.unit)}</Td>
            <Td align="right">{fmt(m.current, m.unit)}</Td>
            <Td align="right">{m.absoluteChange === null ? <span className="text-muted">Not shown</span> : <span className={m.absoluteChange > 0 ? "text-good" : m.absoluteChange < 0 ? "text-bad" : ""}>{m.absoluteChange > 0 ? "+" : ""}{fmt(m.absoluteChange, m.unit)}</span>}</Td>
            <Td align="right">
              {m.percentChange !== null ? <span className={m.percentChange > 0 ? "text-good" : m.percentChange < 0 ? "text-bad" : ""}>{m.percentChange > 0 ? "+" : ""}{m.percentChange}%</span>
                : m.status === "zero_baseline" ? <Badge tone="neutral">Zero baseline, no %</Badge>
                : m.status === "ok" ? <span className="text-muted">0%</span>
                : <Badge tone="neutral">{m.status === "both_unavailable" ? "Both unavailable" : m.status === "current_unavailable" ? "Current unavailable" : "Previous unavailable"}</Badge>}
            </Td>
          </tr>
        ))}
        {recorded.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">No figures recorded for these periods, source and channel.</td></tr>}
      </tbody>
    </Table>
  );
}

export function SnapshotTable({ snapshots }: { snapshots: SnapshotRow[] }) {
  return (
    <Table caption="Recorded snapshots">
      <thead><tr><Th>Period</Th><Th>Source</Th><Th>Channel</Th><Th>Metric</Th><Th align="right">Value</Th><Th>Entered</Th><Th>Note</Th></tr></thead>
      <tbody>
        {snapshots.filter((s) => s.metric !== "patients").map((s) => {
          const metric = s.metric.replace(/_/g, " ");
          return (
            <tr key={s.id} className={s.superseded_by_id ? "opacity-60" : ""}>
              <Td className="whitespace-nowrap">{formatPeriod(s.period_start, s.period_end, " to ")}</Td>
              <Td>{label(s.source)}</Td>
              <Td>{label(s.channel)}</Td>
              <Td>{metric.charAt(0).toUpperCase() + metric.slice(1)}</Td>
              <Td align="right">{s.value === null ? <Badge tone="neutral">Unavailable</Badge> : fmt(s.value, s.unit)}{s.superseded_by_id && <div className="text-xs text-muted">Superseded</div>}{s.supersedes_id && <div className="text-xs text-muted">Correction</div>}</Td>
              <Td className="text-muted whitespace-nowrap">{s.entered_by_name}</Td>
              <Td className="text-muted">{s.note}</Td>
            </tr>
          );
        })}
        {snapshots.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">No snapshots recorded.</td></tr>}
      </tbody>
    </Table>
  );
}
