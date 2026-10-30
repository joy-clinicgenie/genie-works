import Link from "next/link";
import { formatDateTime, getClient, listAccountReferences, listApprovals, listClientContacts, listClientFileLinks, listIssues, listMemberships, listTimeline, listWebsites } from "@clinic-genie/db";
import { requireClientAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Card, CardHeader, KeyValue } from "@/components/ui/Card";
import { Badge, label } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { ClientMark } from "@/components/shell/ClientMark";

export const dynamic = "force-dynamic";

function workspaceLinks(clientId: string, slug: string, websites: Array<{ id: string; environment: string }>) {
  const site = websites.find((item) => item.environment === "production") ?? websites[0];
  const query = site ? `client=${clientId}&website=${site.id}` : `client=${clientId}`;
  return [
    { href: `/analytics?${query}`, label: "Website analytics" },
    { href: `/seo?${query}`, label: "SEO performance" },
    { href: `/blog?${query}`, label: "Blog" },
    { href: `/enquiries?clinic=${encodeURIComponent(slug)}`, label: "Leads and forms" },
    { href: `/clients/${clientId}/approvals`, label: "Approvals" },
    { href: `/clients/${clientId}/reports`, label: "Reports" },
    { href: `/clients/${clientId}/timeline`, label: "Timeline" },
  ];
}

export default async function ClientOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireClientAccess(id);
  const data = await staffTx(access, async (db) => ({
    client: (await getClient(db, id))!,
    websites: await listWebsites(db, id),
    refs: await listAccountReferences(db, id),
    members: await listMemberships(db, id),
    contacts: await listClientContacts(db, id),
    files: await listClientFileLinks(db, id),
    approvals: await listApprovals(db, { clientId: id, statuses: ["submitted"] }),
    issues: await listIssues(db, { clientId: id, statuses: ["open", "investigating", "resolved_pending_verification", "reopened"] }),
    timeline: (await listTimeline(db, { clientId: id, limit: 20 })).filter((event) => !event.event_type.startsWith("task_")).slice(0, 8),
  }));
  const client = data.client;
  const primary = data.contacts.find((contact) => contact.is_primary);
  const detail = [client.reference_number, client.short_code, client.specialty].filter(Boolean).join(" · ");
  const contact = [client.contact_email, client.contact_phone].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden">
        <div className="flex flex-col gap-5 bg-brand-pale/50 px-5 py-6 sm:flex-row sm:items-center sm:px-6">
          <ClientMark slug={client.slug} name={client.name} shortCode={client.short_code} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted"><Link href="/clients" className="hover:text-action">Clients</Link></div>
            <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-tight break-words">{client.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={client.status === "active" ? "good" : "neutral"}>{client.status === "active" ? "Active" : "Inactive"}</Badge>
              {client.is_synthetic && <Badge tone="warn">Demonstration data</Badge>}
            </div>
            <p className="mt-1 text-sm text-ink-soft">{detail || "No client ID, short code or specialty recorded"}</p>
            <p className="mt-1 text-sm text-muted">Clinic Genie owner: {client.owner_name ?? "Unassigned"}{client.public_name && client.public_name !== client.name ? ` · ${client.public_name}` : ""}{client.address ? ` · ${client.address}` : ""}</p>
          </div>
          <LinkButton href={`/clients/${id}/profile`} variant="secondary">Edit profile</LinkButton>
        </div>
        <div className="grid gap-px bg-line md:grid-cols-2">
          <div className="bg-surface px-5 py-4 sm:px-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Files</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {data.files.length === 0 && <li className="text-muted">No files recorded.</li>}
              {data.files.map((file) => (
                <li key={file.id}>
                  <a href={file.url} className="font-medium text-action hover:underline" rel="noreferrer" target="_blank">{file.title}</a>
                  {file.notes && <p className="text-xs text-muted">{file.notes}</p>}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-surface px-5 py-4 sm:px-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Websites</h2>
            <ul className="mt-3 space-y-3 text-sm">
              {data.websites.length === 0 && <li className="text-muted">No websites recorded.</li>}
              {data.websites.map((site) => (
                <li key={site.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{site.name}</span>
                    <Badge tone={site.environment === "production" ? "good" : "warn"}>{label(site.environment)}</Badge>
                    {site.platform && site.platform !== "unknown" && <span className="text-muted">{site.platform}</span>}
                  </div>
                  {site.url && <a href={site.url} className="text-action hover:underline break-all" rel="noreferrer" target="_blank">{site.url}</a>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(17rem,0.9fr)]">
        <div className="space-y-6">
          <Card id="profile" className="scroll-mt-24">
            <CardHeader title="Profile" description="Names, contact, services and the people responsible for this client." action={<Link href={`/clients/${id}/profile`} className="text-sm text-action hover:underline">Edit</Link>} />
            <div className="space-y-5 px-5 pb-5">
              <KeyValue items={[
                { label: "Registered name", value: client.legal_name },
                { label: "Public name", value: client.public_name },
                { label: "Address", value: client.address },
                { label: "General contact", value: contact || null },
                { label: "Primary contact", value: primary ? `${primary.name}${primary.designation ? ` · ${primary.designation}` : ""}` : null },
                { label: "Services", value: client.services },
                { label: "Channels", value: client.channels.length ? <span className="flex flex-wrap gap-1">{client.channels.map((channel) => <Badge key={channel}>{label(channel)}</Badge>)}</span> : null },
                { label: "Enquiries", value: client.enquiry_owner_name },
                { label: "Notifications", value: client.notification_owner_name },
                { label: "Account administration", value: client.administration_owner_name },
                { label: "Assigned team", value: data.members.map((member) => `${member.user_name} (${label(member.user_role)})`).join(", ") || null },
              ]} />
              {client.notes && <p className="whitespace-pre-wrap text-sm text-muted">{client.notes}</p>}
              <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                <Link href={`/clients/${id}/approvals`} className="rounded-2xl bg-brand-pale/40 px-4 py-3 hover:bg-brand-pale/70">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Approvals waiting</div>
                  <div className={`mt-1 text-2xl font-semibold ${data.approvals.length ? "text-warn" : "text-ink"}`}>{data.approvals.length}</div>
                </Link>
                <Link href={`/clients/${id}/issues`} className="rounded-2xl bg-brand-pale/40 px-4 py-3 hover:bg-brand-pale/70">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Open issues</div>
                  <div className={`mt-1 text-2xl font-semibold ${data.issues.some((issue) => issue.severity === "critical") ? "text-bad" : "text-ink"}`}>{data.issues.length}</div>
                </Link>
              </div>
            </div>
          </Card>

          <Card id="workspace" className="scroll-mt-24">
            <CardHeader title="Workspace" description="Open this client's work in the rest of Genie Works." />
            <ul className="divide-y divide-line">
              {workspaceLinks(id, client.slug, data.websites).map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="flex min-h-12 items-center justify-between gap-3 px-5 text-sm font-medium hover:bg-brand-pale/50">
                    {item.label}
                    <span className="text-muted" aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card id="references" className="scroll-mt-24">
            <CardHeader title="Account references" description="Saved links and identifiers. Credentials stay in the vault." action={<Link href={`/clients/${id}/profile`} className="text-sm text-action hover:underline">Edit</Link>} />
            <ul className="divide-y divide-line">
              {data.refs.length === 0 && <li className="px-5 py-4 text-sm text-muted">No account references recorded.</li>}
              {data.refs.map((reference) => (
                <li key={reference.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{label(reference.kind)}</Badge>
                    <span className="font-medium">{reference.label}</span>
                  </div>
                  <p className="mt-1 text-muted">
                    {[reference.owner_name, reference.external_identifier].filter(Boolean).join(" · ") || "No identifier recorded"}
                  </p>
                  {reference.url && <a href={reference.url} className="mt-1 inline-block text-action hover:underline break-all" rel="noreferrer" target="_blank">{reference.url}</a>}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card className="xl:sticky xl:top-24">
          <CardHeader title="Recent activity" action={<Link href={`/clients/${id}/timeline`} className="text-sm text-action hover:underline">Timeline</Link>} />
          <ol className="divide-y divide-line">
            {data.timeline.length === 0 && <li className="px-5 py-4 text-sm text-muted">No activity recorded yet.</li>}
            {data.timeline.map((event) => (
              <li key={event.id} className="px-5 py-3">
                <p className="text-sm">{event.title}</p>
                <p className="mt-1 text-xs text-muted">{formatDateTime(event.occurred_at)}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
