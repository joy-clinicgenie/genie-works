import { formatPeriod } from "@clinic-genie/db";
import { Card, CardHeader, Stat } from "@/components/ui/Card";
import { enquiryChange, type EnquiryBoard, type EnquiryWindow } from "@/lib/form-submissions";

const GROUPS = [
  ["client", "By client"],
  ["website", "By website"],
  ["form", "By form"],
  ["source", "By source"],
] as const;

export function EnquiryOverview({ board, window, websiteNames }: { board: EnquiryBoard; window: EnquiryWindow; websiteNames: Map<string, string> }) {
  const groups = GROUPS.map(([key, title]) => ({
    title,
    rows: board.breakdowns[key].map((row) => key === "website" ? { ...row, label: websiteNames.get(row.key) ?? row.label } : row),
  }));
  return (
    <div className="mb-5 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Stat
          label="Enquiries received"
          value={board.currentTotal}
          hint={<>{enquiryChange(board.currentTotal, board.previousTotal)}<span className="mt-1 block">{formatPeriod(window.from, window.to)} compared with {formatPeriod(window.previousFrom, window.previousTo)}</span></>}
        />
        <Card className="p-5">
          <p className="text-sm text-ink-soft">This total counts production submissions. Demonstration submissions stay in the list below and are left out of this total, the previous period and the breakdowns. A Wix form is read when the page loads and is not copied. Form starts, contact clicks and confirmed bookings are counted separately and are not added here. A repeated submission with the same clinic and idempotency key keeps the existing enquiry. A new request from the same person is counted on its own. Notification retries are not additional enquiries.</p>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {groups.map((group) => (
          <Card key={group.title}>
            <CardHeader title={group.title} />
            <ul className="space-y-3 px-5 pb-5 text-sm">
              {group.rows.map((row) => (
                <li key={row.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-medium">{row.label}</span>
                    <span className="num shrink-0">{row.current}</span>
                  </div>
                  <p className="text-xs text-muted">{enquiryChange(row.current, row.previous)}</p>
                </li>
              ))}
              {group.rows.length === 0 && <li className="text-muted">None in this period.</li>}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
