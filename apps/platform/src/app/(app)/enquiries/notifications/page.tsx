import Link from "next/link";
import { formatDateTime } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { PageHeader, Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/Notice";
import { EnquiryTabs } from "@/components/modules/EnquiryTabs";
import { RetryNotification } from "@/components/modules/RetryNotification";
import { canRetryNotifications, listNotifications, submissionClinicScope, type NotificationStatus } from "@/lib/form-submissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notification status" };

const STATUS_TONE: Record<NotificationStatus, Tone> = {
  pending: "warn",
  sent: "good",
  failed: "bad",
  exhausted: "bad",
  unconfigured: "neutral",
};

const STATUS_LABEL: Record<NotificationStatus, string> = {
  pending: "Pending",
  sent: "Delivered",
  failed: "Failed",
  exhausted: "Failed",
  unconfigured: "Not configured",
};

export default async function NotificationStatusPage() {
  const access = await requireAccess();
  const data = await listNotifications(submissionClinicScope(access));
  const canRetry = canRetryNotifications(access);
  return (
    <EnquiryTabs>
      <PageHeader title="Enquiries" description="Delivery state of clinic notifications. Names, addresses and messages are not shown here. A retry sends the existing notification again." />
      {!data.connected && (
        <EmptyState title="Notification status is not available">The clinic website database is not connected. Nothing was changed.</EmptyState>
      )}
      {data.connected && (
        <Card>
          <Table caption="Notification status">
            <thead>
              <tr>
                <Th>Updated</Th>
                <Th>Client</Th>
                <Th>Enquiry</Th>
                <Th>Status</Th>
                <Th>Attempts</Th>
                {canRetry && <Th>Retry</Th>}
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(item.updatedAt)}</Td>
                  <Td>{item.clinicName}</Td>
                  <Td><Link href={`/enquiries/${item.enquiryId}`} className="font-medium text-action hover:underline">{item.reference}</Link></Td>
                  <Td>
                    <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                    {item.errorCode && <div className="mt-1 text-xs text-muted">{item.errorCode}</div>}
                  </Td>
                  <Td>{item.attempts}</Td>
                  {canRetry && (
                    <Td>{item.status === "failed" || item.status === "exhausted" ? <RetryNotification outboxId={item.id} /> : null}</Td>
                  )}
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={canRetry ? 6 : 5} className="px-3 py-6 text-center text-sm text-muted">No clinic notifications have been recorded.</td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
      )}
    </EnquiryTabs>
  );
}
