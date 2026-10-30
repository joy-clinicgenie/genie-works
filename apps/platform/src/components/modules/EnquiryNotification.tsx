import { formatDateTime } from "@clinic-genie/db";
import { Badge, type Tone } from "@/components/ui/Badge";
import { RetryNotification } from "@/components/modules/RetryNotification";
import { notificationFailure, notificationLabel, type ClinicNotification, type NotificationStatus } from "@/lib/form-submissions";

const TONE: Record<NotificationStatus, Tone> = {
  pending: "warn",
  sent: "good",
  failed: "bad",
  exhausted: "bad",
  unconfigured: "neutral",
};

const OUTCOME: Record<string, string> = {
  sent: "Sent",
  failed: "Failed",
  unconfigured: "Not configured",
};

export function EnquiryNotification({
  storedAt,
  status,
  notification,
  manualRetries,
  canRetry,
}: {
  storedAt: Date;
  status: NotificationStatus | null;
  notification: ClinicNotification | null;
  manualRetries: Array<{ id: string; at: Date; actor: string }>;
  canRetry: boolean;
}) {
  const label = notificationLabel(notification?.status ?? status);
  const tone = notification?.status ?? status;
  const failure = notificationFailure(notification?.errorCode);
  const nextRetry = notification?.nextAttemptAt ? formatDateTime(notification.nextAttemptAt) : "None scheduled";
  const lastAttempt = notification?.lastAttemptAt ? formatDateTime(notification.lastAttemptAt) : "Not recorded";
  return (
    <div>
      <h2 className="text-base font-semibold">Clinic notification</h2>
      <p className="mt-2 text-sm text-muted">The enquiry is already stored. This panel is only the clinic email. A failed email does not remove the enquiry, and a retry does not create another one.</p>
      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Enquiry stored</dt>
          <dd className="mt-0.5">{formatDateTime(storedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Clinic notification</dt>
          <dd className="mt-0.5">{tone ? <Badge tone={TONE[tone]}>{label}</Badge> : label}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Attempts</dt>
          <dd className="mt-0.5">{notification ? notification.attempts : "Not recorded"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Last attempt</dt>
          <dd className="mt-0.5">{lastAttempt}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Next retry</dt>
          <dd className="mt-0.5">{nextRetry}</dd>
        </div>
      </dl>
      {tone === "sent" && <p className="mt-3 text-xs text-muted">Sent means the provider accepted the message. Delivery to the mailbox is not confirmed.</p>}
      {failure && notification?.errorCode && (
        <p className="mt-3 text-sm">{failure} <span className="text-muted">{notification.errorCode}</span></p>
      )}
      <h3 className="mt-6 text-sm font-semibold">Sender attempts</h3>
      {notification && notification.senderAttempts.length > 0 ? (
        <ol className="mt-2 space-y-2 text-sm">
          {notification.senderAttempts.map((attempt) => (
            <li key={attempt.id}>
              <p>{formatDateTime(attempt.attemptedAt)} · {attempt.origin} · {OUTCOME[attempt.outcome] ?? attempt.outcome}</p>
              {attempt.errorCode && <p className="text-xs text-muted">{notificationFailure(attempt.errorCode)} {attempt.errorCode}</p>}
            </li>
          ))}
        </ol>
      ) : <p className="mt-2 text-sm text-muted">No sender attempt is recorded.</p>}
      <h3 className="mt-6 text-sm font-semibold">Manual retries</h3>
      {manualRetries.length > 0 ? (
        <ol className="mt-2 space-y-2 text-sm">
          {manualRetries.map((retry) => (
            <li key={retry.id}>Manual retry requested · {retry.actor} · {formatDateTime(retry.at)}</li>
          ))}
        </ol>
      ) : <p className="mt-2 text-sm text-muted">No manual retry is recorded.</p>}
      {canRetry && notification && (notification.status === "failed" || notification.status === "exhausted") && (
        <div className="mt-4"><RetryNotification outboxId={notification.id} /></div>
      )}
    </div>
  );
}
