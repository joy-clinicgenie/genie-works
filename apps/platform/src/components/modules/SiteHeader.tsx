import Link from "next/link";
import { formatDateTime, formatPeriod } from "@clinic-genie/db";
import { ClientPicker } from "./ClientPicker";
import { PeriodSelect } from "./PeriodSelect";
import type { PeriodRangeId } from "@/lib/period-options";
import type { PeriodWindow } from "@/lib/site-metrics";

export function SiteHeader({
  title,
  clients,
  clientId,
  clientName,
  clientReference,
  clientSpecialty,
  websiteUrl,
  websiteId,
  current,
  previous,
  updatedAt,
  analyticsHref,
  range,
  from,
  to,
  comparedLabel,
}: {
  title: string;
  clients: Array<{ id: string; name: string; referenceNumber?: string | null }>;
  clientId: string;
  clientName: string;
  clientReference?: string | null;
  clientSpecialty?: string | null;
  websiteUrl: string | null;
  websiteId?: string | null;
  current?: PeriodWindow;
  previous?: PeriodWindow;
  updatedAt: Date | null;
  analyticsHref?: string;
  range?: PeriodRangeId;
  from?: string;
  to?: string;
  comparedLabel?: string;
}) {
  const rangeText = current ? formatPeriod(current.start, current.end, " to ") : "No recorded period";
  const compared = previous ? formatPeriod(previous.start, previous.end, " to ") : null;
  return (
    <header className="mb-6">
      <h1 className="text-[1.65rem] font-semibold tracking-tight text-ink">{title}</h1>
      <div className="mt-1 flex items-center justify-between gap-4">
        <h2 className="min-w-0 text-xl font-semibold tracking-tight text-ink">
          {clientReference && <span className="mr-2 inline-flex translate-y-[-1px] items-center rounded-md bg-brand-pale px-2 py-0.5 align-middle text-sm font-semibold tracking-normal text-action">{clientReference}</span>}
          {clientName}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <ClientPicker clients={clients} value={clientId} label="Clinic" range={range} from={from} to={to} />
          {analyticsHref && <Link href={analyticsHref} className="inline-flex min-h-9 items-center rounded-xl bg-action px-4 text-sm font-medium text-white hover:bg-action-hover">View analytics</Link>}
        </div>
      </div>
      {range && comparedLabel ? (
        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
          <PeriodSelect clientId={clientId} websiteId={websiteId} range={range} from={from} to={to} />
          <p className="text-sm text-ink-soft">compared to previous period ({comparedLabel})</p>
        </div>
      ) : (
        <p className="mt-8 text-sm text-muted">
          {clientSpecialty ? `${clientSpecialty}` : null}
          {websiteUrl ? <>{clientSpecialty ? " · " : ""}<Link href={websiteUrl} className="font-medium text-action hover:underline">Open website</Link></> : null}
          {" · "}{rangeText}{compared ? ` compared with ${compared}` : " · no earlier period of the same length"}
        </p>
      )}
      <p className="mt-2 text-xs text-muted">{updatedAt ? `Last updated ${formatDateTime(updatedAt)}` : "No export has been recorded"}</p>
    </header>
  );
}
