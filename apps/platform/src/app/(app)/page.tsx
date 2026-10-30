import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { formatDateTime, formatPeriod, listApprovals, listClients, listIssues, listTimeline } from "@clinic-genie/db";
import { LaunchDashboard } from "@/components/modules/LaunchDashboard";
import { listFormSubmissions, notificationAttention, submissionClinicScope, submissionStatusCounts } from "@/lib/form-submissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

const OPEN_ISSUE_STATUSES = ["open", "investigating", "resolved_pending_verification", "reopened"] as const;

export default async function DashboardPage() {
  const access = await requireAccess();
  const scope = submissionClinicScope(access);
  const [directory, enquiries, notifications, submissions] = await Promise.all([
    staffTx(access, async (db) => {
      const clients = await listClients(db);
      const approvals = await listApprovals(db, { statuses: ["submitted", "changes_requested"], limit: 5 });
      const issues = await listIssues(db, { statuses: [...OPEN_ISSUE_STATUSES], limit: 20 });
      const timeline = await listTimeline(db, { limit: 20 });
      const websites = await db.query<{ client_id: string; count: number }>("select client_id, count(*)::int as count from websites group by client_id");
      const performance = await db.query<{ client_id: string; name: string; period_start: string; period_end: string; sessions: number | null }>(
        `select c.id as client_id, c.name, s.period_start::text as period_start, s.period_end::text as period_end, sum(s.value)::float as sessions
         from report_snapshots s
         join clients c on c.id = s.client_id
         where s.superseded_by_id is null and s.metric = 'sessions' and s.source = 'ga4_export'
           and (s.period_start, s.period_end) = (
             select period_start, period_end from report_snapshots
             where superseded_by_id is null and metric = 'sessions' and source = 'ga4_export'
             order by period_end desc, abs((period_end - period_start) - 29), period_start desc limit 1
           )
         group by c.id, c.name, s.period_start, s.period_end
         order by sessions desc nulls last
         limit 4`,
      );
      const byClient = new Map(websites.rows.map((row) => [row.client_id, Number(row.count)]));
      const period = performance.rows[0];
      return {
        clientCount: clients.length,
        websiteCount: clients.reduce((sum, client) => sum + (byClient.get(client.id) ?? 0), 0),
        clients: clients.slice(0, 6).map((client) => ({
          id: client.id,
          reference: client.reference_number,
          name: client.name,
          websites: byClient.get(client.id) ?? 0,
        })),
        approvals: approvals.map((item) => ({
          id: item.id,
          title: item.title,
          clientName: item.client_name,
          status: item.status,
        })),
        alerts: issues
          .filter((issue) => issue.severity === "high" || issue.severity === "critical")
          .slice(0, 4)
          .map((issue) => ({
            id: issue.id,
            href: `/issues/${issue.id}`,
            title: issue.title,
            detail: issue.client_name,
            severity: issue.severity,
          })),
        activity: timeline.filter((event) => !event.event_type.startsWith("task_")).slice(0, 5).map((event) => ({
          id: event.id,
          title: event.title,
          clientName: event.client_name,
          when: formatDateTime(event.occurred_at),
          actor: event.actor_name,
        })),
        performance: performance.rows
          .filter((row) => row.sessions !== null)
          .map((row) => ({ clientId: row.client_id, name: row.name, sessions: Math.round(Number(row.sessions)) })),
        performancePeriod: period ? formatPeriod(period.period_start.slice(0, 10), period.period_end.slice(0, 10)) : null,
      };
    }),
    submissionStatusCounts(scope),
    notificationAttention(scope),
    listFormSubmissions(scope, {}),
  ]);

  const failed = notifications.connected ? notifications.failed : 0;
  const alerts = failed > 0
    ? [{ id: "failed-notifications", href: "/enquiries/notifications", title: "Failed clinic notifications", detail: `${failed} waiting for an authorised retry`, severity: "high" }, ...directory.alerts]
    : directory.alerts;

  return (
    <LaunchDashboard
      clientCount={directory.clientCount}
      websiteCount={directory.websiteCount}
      clients={directory.clients}
      enquiries={enquiries}
      recent={submissions.connected ? submissions.items.slice(0, 5) : []}
      notifications={notifications}
      approvals={directory.approvals}
      alerts={alerts.slice(0, 5)}
      activity={directory.activity}
      performance={directory.performance}
      performancePeriod={directory.performancePeriod}
    />
  );
}
