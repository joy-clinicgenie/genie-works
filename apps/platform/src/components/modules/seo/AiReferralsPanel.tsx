import Link from "next/link";
import { AI_REFERRERS, formatDateTime, formatPeriod } from "@clinic-genie/db";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Table, Td, Th } from "@/components/ui/Table";
import { AI_REFERRAL_RANGES, type AiReferralRange, type AiReferralView } from "@/lib/ai-referrals";

const STATUS_TEXT: Record<string, string> = {
  reconnect_required: "needs reconnecting",
  not_configured: "is not configured",
};

export function AiReferralsPanel({ view, range, hrefFor }: {
  view: AiReferralView;
  range: AiReferralRange;
  hrefFor: (range: AiReferralRange) => string;
}) {
  const period = formatPeriod(view.start, view.end);
  return (
    <Card>
      <CardHeader
        title="AI referral sessions"
        description="Website sessions that GA4 recorded as arriving from an AI assistant. A visit is counted only when the assistant passes a referrer or tags its link, so assistants that send none are not seen here. This is traffic, not a count of mentions or citations."
      />
      <nav aria-label="Period" className="flex flex-wrap gap-2 px-5 pb-4 text-sm">
        {AI_REFERRAL_RANGES.map(([id, label]) => (
          <Link
            key={id}
            href={hrefFor(id)}
            aria-current={id === range ? "page" : undefined}
            className={id === range ? "rounded-full bg-action px-3 py-1 font-semibold text-white" : "rounded-full border border-line px-3 py-1 text-action hover:bg-action-soft"}
          >
            {label}
          </Link>
        ))}
        <span className="self-center text-muted">{period}</span>
      </nav>
      <div className="px-5 pb-5 text-sm">
        {view.state === "no_ga4" ? (
          <p className="text-muted">No GA4 property is connected to this website, so AI referral sessions are unavailable. Connect GA4 under Analytics.</p>
        ) : view.state === "ga4_not_connected" ? (
          <p className="text-muted">The GA4 connection {STATUS_TEXT[view.status] ?? `is ${view.status.replace(/_/g, " ")}`}, so AI referral sessions are unavailable.</p>
        ) : view.state === "not_fetched" ? (
          <p className="text-muted">GA4 has not been read for this period yet. The analytics worker runs every hour and fetches newer periods first.</p>
        ) : (
          <ReadyTable view={view} />
        )}
      </div>
    </Card>
  );
}

function ReadyTable({ view }: { view: Extract<AiReferralView, { state: "ready" }> }) {
  const byPlatform = new Map(view.summary.platforms.map((item) => [item.platform, item]));
  return (
    <div className="space-y-3">
      <p>
        <span className="text-2xl font-semibold num">{view.summary.total.toLocaleString("en-SG")}</span>{" "}
        <span className="text-muted">AI referral sessions · read from GA4 {formatDateTime(view.fetchedAt)}</span>
      </p>
      <Table caption="AI referral sessions by assistant">
        <thead><tr><Th>Assistant</Th><Th>Sessions</Th><Th>Share</Th><Th>GA4 source</Th></tr></thead>
        <tbody>
          {AI_REFERRERS.map(({ platform }) => {
            const row = byPlatform.get(platform);
            return (
              <tr key={platform}>
                <Td className="font-medium">{platform}</Td>
                <Td className="num">{row ? row.sessions.toLocaleString("en-SG") : <Badge>None recorded</Badge>}</Td>
                <Td className="num">{row && view.summary.total > 0 ? `${Math.round((row.sessions / view.summary.total) * 100)}%` : ""}</Td>
                <Td className="text-muted">{row ? row.sources.join(", ") : ""}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="text-muted">None recorded means GA4 saw no session from that source in this period. It does not mean the assistant never mentioned the clinic.</p>
    </div>
  );
}
