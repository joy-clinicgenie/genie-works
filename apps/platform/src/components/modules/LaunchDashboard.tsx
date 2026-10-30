import Link from "next/link";
import type { ReactNode } from "react";
import { Bell, Building2, Globe, Inbox } from "lucide-react";
import { Badge, APPROVAL_TONE, SEVERITY_TONE, label } from "@/components/ui/Badge";
import type { SubmissionListItem } from "@/lib/form-submissions";

const panel = "card";

function Bars({ items }: { items: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{item.label}</span>
            <span className="num font-semibold">{item.value}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full" style={{ width: item.value === 0 ? "0%" : `${Math.max(8, (item.value / max) * 100)}%`, background: item.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Stat({ icon: Icon, label: text, value, hint }: { icon: typeof Building2; label: string; value: string; hint: string }) {
  return (
    <article className={`${panel} flex h-full flex-col p-5`}>
      <span className="grid size-10 place-items-center rounded-2xl bg-brand-pale text-action"><Icon className="size-5" aria-hidden="true" /></span>
      <p className="mt-4 text-sm text-muted">{text}</p>
      <p className="num mt-1 text-4xl font-semibold tracking-tight">{value}</p>
      <p className="mt-auto pt-3 text-xs leading-relaxed text-muted">{hint}</p>
    </article>
  );
}

function Panel({ id, title, description, action, children }: { id: string; title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={`${panel} h-full`} aria-labelledby={id}>
      <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-5">
        <div>
          <h2 id={id} className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function OpenLink({ href, children }: { href: string; children: string }) {
  return <Link href={href} className="text-sm font-medium text-action hover:underline">{children}</Link>;
}

function SummaryTemplate({ title, fields }: { title: string; fields: string[] }) {
  const id = title.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <section className={`${panel} h-full`} aria-labelledby={id}>
      <div className="px-5 pb-2 pt-5">
        <h2 id={id} className="text-base font-semibold">{title}</h2>
      </div>
      <ul className="divide-y divide-line/80 px-5 pb-3">
        {fields.map((field) => (
          <li key={field} className="flex items-center justify-between gap-3 py-3 text-sm">
            <span className="text-muted">{field}</span>
            <span className="text-xs font-medium text-muted">Template</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface ApprovalItem {
  id: string;
  title: string;
  clientName: string;
  status: string;
}

export interface AlertItem {
  id: string;
  href: string;
  title: string;
  detail: string;
  severity: string;
}

export interface ActivityItem {
  id: string;
  title: string;
  clientName: string;
  when: string;
  actor: string | null;
}

export interface PerformanceItem {
  clientId: string;
  name: string;
  sessions: number;
}

export function LaunchDashboard({
  clientCount,
  websiteCount,
  clients,
  enquiries,
  recent,
  notifications,
  approvals,
  alerts,
  activity,
  performance,
  performancePeriod,
}: {
  clientCount: number;
  websiteCount: number;
  clients: Array<{ id: string; reference: string | null; name: string; websites: number }>;
  enquiries: { connected: true; counts: { new: number; acknowledged: number; closed: number } } | { connected: false };
  recent: SubmissionListItem[];
  notifications: { connected: true; pending: number; failed: number; unconfigured: number } | { connected: false };
  approvals: ApprovalItem[];
  alerts: AlertItem[];
  activity: ActivityItem[];
  performance: PerformanceItem[];
  performancePeriod: string | null;
}) {
  const attention = notifications.connected ? notifications.pending + notifications.failed : null;
  const enquiryTotal = enquiries.connected ? enquiries.counts.new + enquiries.counts.acknowledged + enquiries.counts.closed : null;
  return (
    <div className="space-y-5">
      <section aria-labelledby="overview">
        <h2 id="overview" className="sr-only">Overview</h2>
        <div className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/enquiries" className="relative flex h-full flex-col overflow-hidden rounded-3xl bg-action p-5 text-white shadow-[0_12px_28px_rgba(19,108,114,0.28)]">
            <div className="pointer-events-none absolute -right-6 -top-8 size-28 rounded-full bg-white/10" />
            <span className="grid size-10 place-items-center rounded-2xl bg-white/15"><Inbox className="size-5" aria-hidden="true" /></span>
            <p className="mt-4 text-sm text-white/80">New enquiries</p>
            <p className="num mt-1 text-4xl font-semibold tracking-tight">{enquiries.connected ? enquiries.counts.new : "—"}</p>
            <p className="mt-auto max-w-[16rem] pt-4 text-xs leading-relaxed text-white/75">{enquiries.connected ? `${enquiryTotal} submitted in total. Closed does not mean an appointment.` : "The clinic website database is not connected."}</p>
          </Link>
          <Link href="/clients" className="block h-full"><Stat icon={Building2} label="Active clients" value={String(clientCount)} hint="Basic client details. Open a client for the full record." /></Link>
          <Link href="/clients" className="block h-full"><Stat icon={Globe} label="Linked websites" value={String(websiteCount)} hint="Websites saved on an active client." /></Link>
          <Stat icon={Bell} label="Notifications to review" value={attention === null ? "—" : String(attention)} hint={attention === null ? "Notification records are not available." : `${notifications.connected ? notifications.pending : 0} pending, ${notifications.connected ? notifications.failed : 0} failed.`} />
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
          <Panel id="pending-approvals" title="Pending approvals" description="Submitted requests and requests sent back for changes." action={<OpenLink href="/approvals">Open approvals</OpenLink>}>
            <ul className="divide-y divide-line/80 px-5 pb-3">
              {approvals.map((item) => (
                <li key={item.id}>
                  <Link href={`/approvals/${item.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-action">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-muted">{item.clientName}</span>
                    </span>
                    <Badge tone={APPROVAL_TONE[item.status] ?? "neutral"}>{label(item.status)}</Badge>
                  </Link>
                </li>
              ))}
              {approvals.length === 0 && <li className="py-3 text-sm text-muted">No approvals are waiting.</li>}
            </ul>
          </Panel>

          <Panel id="urgent-alerts" title="Urgent alerts" description="High and critical issues, and failed clinic notifications." action={<OpenLink href="/issues">Open issues</OpenLink>}>
            <ul className="divide-y divide-line/80 px-5 pb-3">
              {alerts.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-action">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-muted">{item.detail}</span>
                    </span>
                    <Badge tone={SEVERITY_TONE[item.severity] ?? "warn"}>{label(item.severity)}</Badge>
                  </Link>
                </li>
              ))}
              {alerts.length === 0 && <li className="py-3 text-sm text-muted">No urgent alerts.</li>}
            </ul>
          </Panel>
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <Panel id="clients" title="Client overview" description="Basic client details and linked websites." action={<OpenLink href="/clients">Open directory</OpenLink>}>
          <ul className="divide-y divide-line/80 px-5 pb-3">
            {clients.map((client) => (
              <li key={client.id}>
                <Link href={`/clients/${client.id}`} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-action">
                  <span className="min-w-0 truncate">{client.reference ? `${client.reference} · ${client.name}` : client.name}</span>
                  <span className="shrink-0 text-xs text-muted">{client.websites === 0 ? "No website" : `${client.websites} ${client.websites === 1 ? "website" : "websites"}`}</span>
                </Link>
              </li>
            ))}
            {clients.length === 0 && <li className="py-3 text-sm text-muted">No active clients.</li>}
          </ul>
        </Panel>

        <Panel id="enquiries" title="Enquiries" description="Submission list and status. Names and messages stay on the enquiry itself." action={<OpenLink href="/enquiries">Open list</OpenLink>}>
          <div className="grid gap-6 px-5 pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            {enquiries.connected ? (
              <Bars items={[
                { label: "New", value: enquiries.counts.new, color: "#136c72" },
                { label: "Acknowledged", value: enquiries.counts.acknowledged, color: "#8fd4d8" },
                { label: "Closed", value: enquiries.counts.closed, color: "#173c40" },
              ]} />
            ) : <p className="text-sm text-muted">The clinic website database is not connected.</p>}
            <ul className="divide-y divide-line/80">
              {recent.map((item) => (
                <li key={item.id}>
                  <Link href={`/enquiries/${item.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-action">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{item.reference}</span>
                      <span className="block truncate text-xs text-muted">{item.clinicName}{item.isSynthetic ? " · Demonstration data" : ""}</span>
                    </span>
                    <Badge tone={item.status === "new" ? "info" : item.status === "closed" ? "neutral" : "good"}>{item.status}</Badge>
                  </Link>
                </li>
              ))}
              {enquiries.connected && recent.length === 0 && <li className="py-3 text-sm text-muted">No forms have been submitted.</li>}
            </ul>
          </div>
        </Panel>
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <SummaryTemplate title="SEO" fields={["Pages mapped", "Flagged mappings", "Changes awaiting verification"]} />
        <SummaryTemplate title="Ads" fields={["Open audits", "Recorded changes", "Changes awaiting verification"]} />
        <SummaryTemplate title="HCSA" fields={["Claims in review", "Approved wording", "Sources recorded"]} />
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <Panel id="recent-activity" title="Recent activity" description="The latest events on client records." action={<OpenLink href="/timeline">Open timeline</OpenLink>}>
          <ul className="divide-y divide-line/80 px-5 pb-3">
            {activity.map((item) => (
              <li key={item.id} className="py-2.5 text-sm">
                <span className="block truncate font-medium">{item.title}</span>
                <span className="block truncate text-xs text-muted">{item.clientName}{item.actor ? ` · ${item.actor}` : ""} · {item.when}</span>
              </li>
            ))}
            {activity.length === 0 && <li className="py-3 text-sm text-muted">No recent activity.</li>}
          </ul>
        </Panel>

        <Panel id="website-performance" title="Website performance" description={performancePeriod ? `Sessions recorded for ${performancePeriod}.` : "Recorded session totals."} action={<OpenLink href="/analytics">Open analytics</OpenLink>}>
          <ul className="divide-y divide-line/80 px-5 pb-3">
            {performance.map((item) => (
              <li key={item.clientId}>
                <Link href={`/analytics?client=${item.clientId}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-action">
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="num shrink-0 text-xs font-semibold">{item.sessions}</span>
                </Link>
              </li>
            ))}
            {performance.length === 0 && <li className="py-3 text-sm text-muted">No website performance is recorded.</li>}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
