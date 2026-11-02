import { agencySessionSummary, dashboardReportAttention, listShellClients, type AgencySessionSummary } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { AgencyOverview } from "@/components/modules/AgencyOverview";
import { enquiryConnection, notificationAttention, submissionClinicScope, submissionStatusCounts } from "@/lib/form-submissions";
import { periodRange } from "@/lib/period-range";
import {
  analyticsDashboardHref,
  dashboardRangeId,
  enquiryDashboardHref,
  notificationFailureHref,
  reportsLibraryHref,
  sessionComparison,
} from "@/lib/agency-overview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ client?: string; range?: string }> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const rangeId = dashboardRangeId(params.range);
  const windows = periodRange(rangeId);
  const scope = submissionClinicScope(access);
  const requestedClient = params.client && CLIENT_ID.test(params.client) ? params.client : null;

  const registry = await settle(staffTx(access, async (db) => {
    const clients = await listShellClients(db);
    const websites = await db.query<{ client_id: string; count: number }>("select client_id, count(*)::int as count from websites group by client_id");
    return {
      clients: clients.map((client) => ({
        id: client.id,
        name: client.name,
        slug: client.slug,
        referenceNumber: client.reference_number,
      })),
      websites: new Map(websites.rows.map((row) => [row.client_id, Number(row.count)])),
    };
  }), null);

  const selected = registry?.clients.find((client) => client.id === requestedClient) ?? null;
  const clientId = selected?.id ?? null;
  const clinic = selected?.slug ?? null;
  const from = windows.current.start;
  const to = windows.current.end;

  const [enquiries, notifications, reports, sessions] = await Promise.all([
    settle(submissionStatusCounts(scope, { from, to, clinicId: clinic }), { connected: false as const }),
    settle(notificationAttention(scope, clinic), { connected: false as const }),
    settle(staffTx(access, (db) => dashboardReportAttention(db, clientId)), null),
    settle(staffTx(access, (db) => agencySessionSummary(db, {
      clientId,
      start: from,
      end: to,
      previousStart: windows.previous.start,
      previousEnd: windows.previous.end,
    })), unavailableSessions()),
  ]);

  const notices: string[] = [];
  if (!registry) notices.push("The client registry is unavailable. Other sections remain available.");
  if (!enquiries.connected) {
    const connection = await enquiryConnection().catch(() => ({ configured: false, reachable: false, refused: false }));
    notices.push(connection.refused
      ? "The enquiry database target was refused. Other sections remain available."
      : connection.configured
        ? "The enquiry database is unavailable. Other sections remain available."
        : "The enquiry database is not connected. Other sections remain available.");
  } else if (!notifications.connected) {
    notices.push("Notification status is unavailable. Enquiry counts are still shown.");
  }
  if (!reports) notices.push("Reports are unavailable. Other sections remain available.");
  for (const notice of sessions.notices) notices.push(notice.message);

  const linkedWebsites = registry
    ? selected
      ? registry.websites.get(selected.id) ?? 0
      : registry.clients.reduce((sum, client) => sum + (registry.websites.get(client.id) ?? 0), 0)
    : null;
  const enquiryHrefs = {
    total: enquiryDashboardHref({ from, to, clinic }),
    new: enquiryDashboardHref({ status: "new", from, to, clinic }),
    acknowledged: enquiryDashboardHref({ status: "acknowledged", from, to, clinic }),
    closed: enquiryDashboardHref({ status: "closed", from, to, clinic }),
  };
  const counts = enquiries.connected ? enquiries.counts : null;

  return (
    <AgencyOverview
      clients={registry?.clients ?? []}
      clientId={selected?.id ?? ""}
      rangeId={rangeId}
      activeClients={registry ? registry.clients.length : null}
      linkedWebsites={linkedWebsites}
      clientsHref="/clients"
      websitesHref={selected ? `/clients/${selected.id}` : "/clients"}
      enquiries={counts
        ? { connected: true, total: counts.new + counts.acknowledged + counts.closed, counts }
        : { connected: false }}
      enquiryHrefs={enquiryHrefs}
      notificationFailures={enquiries.connected && notifications.connected ? notifications.failed : null}
      notificationHref={notificationFailureHref(clinic)}
      draftCount={reports ? reports.draftCount : null}
      latestDraft={reports?.latest ? { ...reports.latest, updatedAt: reports.latest.updatedAt } : null}
      reportsHref={reportsLibraryHref(clientId)}
      reportsUnavailable={!reports}
      sessions={sessions}
      comparison={sessionComparison(sessions.total, sessions.previous)}
      analyticsHref={analyticsDashboardHref(rangeId, clientId)}
      notices={notices}
    />
  );
}

function unavailableSessions(): AgencySessionSummary {
  return {
    state: "unavailable",
    total: null,
    previous: null,
    series: null,
    top: [],
    fetchedAt: null,
    notices: [{ id: "analytics-unavailable", kind: "unavailable", message: "Website sessions are unavailable." }],
    websiteCount: 0,
    unconnectedCount: 0,
  };
}

async function settle<T>(work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}
