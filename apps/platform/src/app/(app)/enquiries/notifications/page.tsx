import Link from "next/link";
import { formatDateTime, listAuditEvents, listClients, listFormWebsites } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { FilterBar, FilterInput, FilterSelect } from "@/components/ui/Filters";
import { EnquiryTabs } from "@/components/modules/EnquiryTabs";
import { RetryNotification } from "@/components/modules/RetryNotification";
import { clientLabel } from "@/lib/client-label";
import {
  ENQUIRY_PAGE_SIZE,
  canRetryNotifications,
  enquiryConnection,
  enquiryUnavailableCopy,
  enquiryWindow,
  listNotifications,
  notificationBoundary,
  notificationFailure,
  notificationFilter,
  submissionClinicScope,
  submissionWebsiteKey,
  type NotificationStatus,
} from "@/lib/form-submissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notification status" };

const STATUS_TONE: Record<NotificationStatus, Tone> = {
  pending: "warn",
  sent: "good",
  failed: "bad",
  exhausted: "bad",
  unconfigured: "neutral",
};

function queryHref(values: Record<string, string | undefined>, page?: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) search.set(key, value);
  if (page && page > 1) search.set("page", String(page));
  const text = search.toString();
  return text ? `/enquiries/notifications?${text}` : "/enquiries/notifications";
}

export default async function NotificationStatusPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const scope = submissionClinicScope(access);
  const window = enquiryWindow(params.from, params.to);
  const denied = Boolean(params.clinic && scope !== null && !scope.includes(params.clinic));
  const clinic = denied ? undefined : params.clinic && /^[a-z0-9-]{1,64}$/.test(params.clinic) ? params.clinic : undefined;
  const website = submissionWebsiteKey(params.website);
  const status = notificationFilter(params.notification);
  const page = Math.max(1, Number(params.page) || 1);
  const [data, directory] = await Promise.all([
    listNotifications(scope, { clinicId: clinic, websiteKey: website, status, from: window.from, to: window.to, page }),
    staffTx(access, async (db) => ({ clients: await listClients(db), websites: await listFormWebsites(db, null) })),
  ]);
  const canRetry = canRetryNotifications(access);
  const retries = data.connected
    ? await staffTx(access, (db) => listAuditEvents(db, { action: "notification.retry", targetIds: data.items.map((item) => item.id), limit: 200 }))
    : [];
  const retriesByOutbox = new Map<string, typeof retries>();
  for (const retry of retries) {
    if (!retry.target_id) continue;
    const list = retriesByOutbox.get(retry.target_id) ?? [];
    list.push(retry);
    retriesByOutbox.set(retry.target_id, list);
  }
  const websiteNames = new Map(directory.websites.flatMap((site) => site.enquiry_key ? [[site.enquiry_key, site.name] as const] : []));
  const clientOptions = new Map(directory.clients.map((client) => [client.slug, clientLabel(client)]));
  if (data.connected) for (const item of data.clinics) if (!clientOptions.has(item.id)) clientOptions.set(item.id, item.name);
  const websiteOptions = new Map<string, string>();
  for (const site of directory.websites) {
    if (!site.enquiry_key || (clinic && site.client_slug !== clinic)) continue;
    websiteOptions.set(site.enquiry_key, site.name);
  }
  if (data.connected) {
    for (const site of data.websites) {
      if (clinic && site.clinicId !== clinic) continue;
      if (!websiteOptions.has(site.key)) websiteOptions.set(site.key, websiteNames.get(site.key) ?? site.key);
    }
  }
  const preserved = { clinic, website, notification: status, from: window.from, to: window.to };
  const source = data.connected ? null : await enquiryConnection();
  const lastPage = data.connected ? Math.max(1, Math.ceil(data.total / ENQUIRY_PAGE_SIZE)) : 1;
  const columns = canRetry ? 10 : 9;
  return (
    <EnquiryTabs>
      <PageHeader
        title="Notification status"
        description="This list is the website-database outbox only. A Wix form keeps its own sender and is not listed here. Retry requested means a staff retry is waiting. Processing means that website’s sender has the row. Sent means the provider accepted the message. Inbox delivery is not confirmed. Failed and Not configured are not provider acceptance. A retry does not create another enquiry. Genie Works does not send the email, and another website does not have to use the same provider."
      />
      {denied && <div className="mb-4"><Notice tone="bad" title="Not available">You do not have access to that clinic.</Notice></div>}
      {!data.connected && <EmptyState title="Notification status is not available">{enquiryUnavailableCopy(source ?? { configured: false, refused: false }, "The website enquiry database is not connected, so its notification rows are not available. Wix forms keep their own sender and are not listed here. Nothing was changed.")}</EmptyState>}
      {data.connected && (
        <>
          <FilterBar clearHref="/enquiries/notifications">
            <FilterInput name="from" label="From" type="date" value={window.from} />
            <FilterInput name="to" label="To" type="date" value={window.to} />
            <FilterSelect name="clinic" label="Client" value={clinic} allLabel="All clients" options={[...clientOptions].map(([value, label]) => ({ value, label }))} />
            <FilterSelect name="website" label="Website" value={website} allLabel="All websites" options={[...websiteOptions].map(([value, label]) => ({ value, label }))} />
            <FilterSelect name="notification" label="Delivery status" value={status} allLabel="Any status" options={[{ value: "pending", label: "Pending" }, { value: "sent", label: "Sent" }, { value: "failed", label: "Failed" }, { value: "unconfigured", label: "Not configured" }]} />
          </FilterBar>
          <p className="mb-3 text-sm text-ink-soft">{data.total === 1 ? "1 matching notification" : `${data.total} matching notifications`}</p>
          <Card>
            <Table caption="Notification status">
              <thead>
                <tr>
                  <Th>Client</Th>
                  <Th>Enquiry</Th>
                  <Th>Stored</Th>
                  <Th>Email</Th>
                  <Th>Attempts</Th>
                  <Th>Last attempt</Th>
                  <Th>Next retry</Th>
                  <Th>Latest send</Th>
                  <Th>Manual retries</Th>
                  {canRetry && <Th>Retry</Th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => {
                  const manual = retriesByOutbox.get(item.id) ?? [];
                  const failure = notificationFailure(item.errorCode);
                  const boundary = notificationBoundary({ status: item.status, leasedUntil: item.leasedUntil, manualRetry: manual.length > 0 });
                  return (
                    <tr key={item.id}>
                      <Td>
                        {item.clinicName}
                        <div className="text-xs text-muted">{item.websiteKey ? websiteNames.get(item.websiteKey) ?? item.websiteKey : "Website not recorded"}</div>
                      </Td>
                      <Td><Link href={`/enquiries/${item.enquiryId}`} className="font-medium text-action hover:underline">{item.reference}</Link></Td>
                      <Td className="whitespace-nowrap">{formatDateTime(item.submittedAt)}</Td>
                      <Td>
                        <Badge tone={STATUS_TONE[item.status]}>{boundary.label}</Badge>
                        {failure && item.errorCode && <div className="mt-1 text-xs text-muted">{failure} {item.errorCode}</div>}
                      </Td>
                      <Td>{item.attempts}</Td>
                      <Td className="whitespace-nowrap">{item.lastAttemptAt ? formatDateTime(item.lastAttemptAt) : "Not recorded"}</Td>
                      <Td className="whitespace-nowrap">{item.nextAttemptAt ? formatDateTime(item.nextAttemptAt) : "None scheduled"}</Td>
                      <Td>{item.latestOrigin ?? "Not recorded"}</Td>
                      <Td>
                        {manual.length === 0 && <span className="text-muted">None recorded</span>}
                        {manual.length > 0 && (
                          <ul className="space-y-1">
                            {[...manual].reverse().map((retry) => (
                              <li key={retry.id}>Manual retry requested · {retry.actor_name ?? "Staff"} · {formatDateTime(retry.occurred_at)}</li>
                            ))}
                          </ul>
                        )}
                      </Td>
                      {canRetry && <Td>{item.status === "failed" || item.status === "exhausted" ? <RetryNotification outboxId={item.id} /> : null}</Td>}
                    </tr>
                  );
                })}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={columns} className="px-3 py-6 text-center text-sm text-muted">No clinic notifications match this search.</td>
                  </tr>
                )}
              </tbody>
            </Table>
            {data.total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <p>Showing {(data.page - 1) * ENQUIRY_PAGE_SIZE + 1}–{Math.min(data.page * ENQUIRY_PAGE_SIZE, data.total)} of {data.total}</p>
                <div className="flex gap-3">
                  {data.page > 1 && <Link href={queryHref(preserved, data.page - 1)} className="text-action underline">Previous</Link>}
                  {data.page < lastPage && <Link href={queryHref(preserved, data.page + 1)} className="text-action underline">Next</Link>}
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </EnquiryTabs>
  );
}
