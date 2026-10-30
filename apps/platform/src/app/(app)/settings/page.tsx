import type { ReactNode } from "react";
import Link from "next/link";
import { canExport, canManageRegistry, canManageUsers, formatDateTime, listAuditEvents, listStaff, platformStatus, todaySgt } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card, CardHeader, KeyValue, Stat } from "@/components/ui/Card";
import { Badge, label, type Tone } from "@/components/ui/Badge";
import { SettingsProfile } from "@/components/modules/SettingsProfile";
import { AnalyticsConnections } from "@/components/modules/AnalyticsConnections";
import { enquiryConnection } from "@/lib/form-submissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform settings" };

function Connection({ name, status, tone, detail }: { name: string; status: string; tone: Tone; detail: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink">{name}</h3>
        <p className="mt-1 text-sm text-ink-soft">{detail}</p>
      </div>
      <Badge tone={tone}>{status}</Badge>
    </div>
  );
}

function Desk({ title, href, link, figure, hint, children }: { title: string; href: string; link: string; figure: ReactNode; hint: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col">
      <CardHeader title={title} />
      <div className="flex flex-1 flex-col px-5 pb-5">
        <p className="text-2xl font-semibold num text-ink">{figure}</p>
        <p className="mt-1 text-sm text-muted">{hint}</p>
        <p className="mt-3 text-sm text-ink-soft">{children}</p>
        <Link href={href} className="mt-4 text-sm font-semibold text-action hover:underline">{link}</Link>
      </div>
    </Card>
  );
}

function Boundary({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-t border-line px-5 py-3">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-0.5 text-sm text-ink-soft">{detail}</p>
    </div>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ client?: string; analyticsState?: string; analyticsError?: string; analytics?: string }> }) {
  const params = await searchParams;
  const access = await requireAccess();
  const privileged = canManageUsers(access);
  const global = canManageRegistry(access);
  const exportAllowed = canExport(access);
  const checkedAt = new Date();
  const [forms, admin] = await Promise.all([
    enquiryConnection(),
    privileged
      ? staffTx(access, async (db) => ({
          staff: await listStaff(db),
          status: await platformStatus(db, todaySgt()),
          events: await listAuditEvents(db, { limit: 1 }),
        }))
      : Promise.resolve(null),
  ]);
  const google = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
  const formsStatus = !forms.configured ? "Not connected" : forms.reachable ? "Reachable" : "Unreachable";
  const formsTone: Tone = !forms.configured ? "neutral" : forms.reachable ? "good" : "warn";
  const latest = admin?.events[0];
  const restore = admin?.status.lastRestoreTest;
  const activeStaff = admin?.staff.filter((person) => person.active).length ?? 0;
  const inactiveStaff = admin?.staff.filter((person) => !person.active).length ?? 0;
  const assigned = access.memberships.length;
  return (
    <>
      <PageHeader
        title="Platform settings"
        description="How this Genie Works workspace is run for the signed-in staff account. Clinic records and enquiry messages stay in their own systems."
      />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Role" value={label(access.user.platform_role)} />
        <Stat label="Clinic scope" value={global ? "All clinics" : assigned} hint={global ? "Every active clinic" : assigned === 1 ? "One assigned clinic" : `${assigned} assigned clinics`} />
        <Stat label="Report export" value={exportAllowed ? "CSV on" : "CSV off"} hint="A PDF is printed from the report" />
        <Stat label="Workspace clock" value="Singapore" hint={formatDateTime(checkedAt)} />
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Staff record" description="The name other staff see in Genie Works. The email is the sign-in address." />
          <div className="px-5 pb-5">
            <SettingsProfile name={access.user.display_name} email={access.user.email} />
          </div>
          <div className="border-t border-line px-5 py-5">
            <KeyValue items={[
              { label: "Clients", value: global ? "Every active clinic" : assigned ? "Only assigned clinics" : "No clinic assigned" },
              { label: "Enquiries", value: global ? "Every submitted form" : "Only when the website clinic matches an assignment" },
              { label: "Registry", value: global ? "Can edit clinics, websites and references" : "View only" },
              { label: "Reports", value: exportAllowed ? "CSV download is on. Each file takes the next serial number." : "CSV download is off. A summary can still be printed." },
              { label: "Session", value: "Ends after 12 hours, on sign-out, or when the account is deactivated." },
              { label: "Sign-in", value: google ? "Google Workspace is configured. No password is stored." : "Development sign-in link. Google Workspace is not configured. No password is stored." },
            ]} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Connections" description={`Checked ${formatDateTime(checkedAt)}. A saved account reference on a client is not a live connection.`} />
          <Connection
            name="Enquiry records"
            status={formsStatus}
            tone={formsTone}
            detail="Read from the clinic website database. A submission is not copied into Genie Works, and a contact click is not an enquiry."
          />
          <Connection
            name="Google Workspace"
            status={google ? "Configured" : "Not configured"}
            tone={google ? "good" : "neutral"}
            detail="Staff sign-in only. The platform does not store a password or a Workspace directory."
          />
          <Connection
            name="Measurement exports"
            status="Saved exports"
            tone="neutral"
            detail="Saved exports remain the report source until live reports are turned on. Provider connections are configured below."
          />
          {global && (
            <AnalyticsConnections
              access={access}
              clientId={params.client}
              stateToken={params.analyticsState}
              notice={params.analyticsError ?? params.analytics}
            />
          )}
        </Card>

        {privileged && admin && (
          <div className="grid gap-4 lg:grid-cols-3">
            <Desk title="Staff accounts" href="/admin/users" link="Users and roles" figure={activeStaff} hint={`${inactiveStaff} deactivated`}>
              Assigned clinics are set on the user and on the client profile. Deactivation ends that person’s sessions.
            </Desk>
            <Desk
              title="Audit log"
              href="/admin/audit"
              link="Full history"
              figure={latest ? label(latest.outcome) : "None"}
              hint={latest ? `${formatDateTime(latest.occurred_at)} · ${latest.action}` : "No audit events recorded"}
            >
              Records access changes, form views and exports. It does not copy names, emails or messages.
            </Desk>
            <Desk
              title="Backup and recovery"
              href="/admin/backups"
              link="Recorded runs"
              figure={admin.status.lastBackup ? label(admin.status.lastBackup.outcome) : "None"}
              hint={admin.status.lastBackup ? `Last backup ${formatDateTime(admin.status.lastBackup.started_at)}` : "No backup has been recorded"}
            >
              Last restore test: {restore ? `${restore.outcome}, ${formatDateTime(restore.started_at)}.` : "Not recorded."} A schedule alone is not a backup.
            </Desk>
          </div>
        )}

        <Card>
          <CardHeader title="Kept outside Genie Works" description="These are operating boundaries, not preferences waiting to be filled in." />
          <Boundary title="Notification recipients" detail="Operational contacts live on each client profile. There is no platform-wide recipient list." />
          <Boundary title="Retention and deletion" detail="No retention period has been approved, and deletion is not available from this platform." />
          <Boundary title="Sign-in security" detail="No MFA or authenticator is stored. Sessions are database sessions." />
          <Boundary title="Display" detail="No interface preference is stored. Dates and report file names use Singapore time." />
          <Boundary title="Incidents and support" detail="No incident owner or support contact is named in this workspace." />
          <Boundary title="Privacy notices" detail="The notice version stays with each submitted form in the clinic website database." />
        </Card>
      </div>
    </>
  );
}
