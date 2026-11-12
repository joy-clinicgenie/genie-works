import { Notice } from "@/components/ui/Notice";
import { buttonClass } from "@/components/ui/Button";
import { prepareAnalyticsRange } from "@/app/actions/analytics";
import type { RangeJobStatus } from "@clinic-genie/db";

/** Tells staff whether Google Analytics reports exist for a custom range, and lets an admin or manager ask for them (D52). */
export function AnalyticsRangeNotice({ range, clientId, websiteId, from, to, tab }: {
  range: { status: RangeJobStatus; canPrepare: boolean } | null;
  clientId: string;
  websiteId: string | null;
  from?: string;
  to?: string;
  tab: "/analytics" | "/analytics/traffic" | "/analytics/behavior";
}) {
  if (!range || range.status === "ready" || range.status === "not_connected" || !websiteId || !from || !to) return null;
  if (range.status === "preparing") {
    return (
      <div className="mb-4">
        <Notice tone="info" title="Preparing this range">
          Google Analytics reports for these dates are queued. They appear after the next sync run. Until then, users, channels, pages, devices and countries show as unavailable.
        </Notice>
      </div>
    );
  }
  return (
    <div className="mb-4">
      <Notice tone="neutral" title="This range has not been prepared">
        <p>Daily sessions can show for these dates, but users, channels, pages, devices and countries need their own Google Analytics report.</p>
        {range.canPrepare ? (
          <form action={prepareAnalyticsRange} className="mt-2">
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="websiteId" value={websiteId} />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <input type="hidden" name="tab" value={tab} />
            <button className={buttonClass("secondary", "sm")} type="submit">Prepare this range</button>
          </form>
        ) : (
          <p className="mt-1">An administrator or manager can prepare it.</p>
        )}
      </Notice>
    </div>
  );
}
