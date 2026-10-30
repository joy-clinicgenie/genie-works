import { canManageAssignments, canManageRegistry, formatDateTime, getClient, listAccountReferences, listActiveStaff, listAuditEvents, listClientContacts, listClientFileLinks, listMemberships, listStaff, listWebsites } from "@clinic-genie/db";
import { requireClientAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Card, CardHeader } from "@/components/ui/Card";
import { ClientForm, ContactForm, FileLinkForm, ReferenceForm, WebsiteForm } from "@/components/modules/ClientForms";
import { archiveClientAction, archiveFileLinkAction, membershipAction } from "@/app/actions/clients";
import { Button } from "@/components/ui/Button";
import { Badge, label } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { Select } from "@/components/ui/Field";

export const dynamic = "force-dynamic";

const HISTORY: Record<string, string> = {
  "client.create": "Created the client",
  "client.update": "Updated client details",
  "client.archive": "Deactivated the client",
  "client.restore": "Restored the client",
  "client_contact.create": "Added a client contact",
  "client_contact.update": "Updated a client contact",
  "account_reference.create": "Added an account reference",
  "account_reference.update": "Updated an account reference",
  "membership.grant": "Assigned a staff member",
  "membership.revoke": "Removed a staff member",
  "website.create": "Added a website",
  "website.update": "Updated a website",
  "client_file_link.create": "Added a file link",
  "client_file_link.archive": "Removed a file link",
};

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireClientAccess(id);
  const assign = canManageAssignments(access);
  const data = await staffTx(access, async (db) => ({
    client: (await getClient(db, id))!,
    websites: await listWebsites(db, id),
    refs: await listAccountReferences(db, id, true),
    contacts: await listClientContacts(db, id, true),
    members: await listMemberships(db, id),
    files: await listClientFileLinks(db, id),
    staff: await listActiveStaff(db),
    history: await listAuditEvents(db, { clientId: id, limit: 40 }),
    allStaff: assign ? await listStaff(db) : [],
  }));
  const manage = canManageRegistry(access);
  const nonMembers = data.allStaff.filter((s) => s.active && !data.members.some((m) => m.user_id === s.id));
  const client = data.client;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Client profile" description="Reference, names, address, general contact details and the staff responsible for operations." />
        <div className="px-5 pb-5">
          {manage ? (
            <ClientForm mode="edit" staff={data.staff} values={{
              clientId: id,
              slug: client.slug,
              name: client.name,
              ownerUserId: client.owner_user_id,
              channels: client.channels,
              services: client.services,
              notes: client.notes,
              referenceNumber: client.reference_number,
              shortCode: client.short_code,
              specialty: client.specialty,
              legalName: client.legal_name,
              publicName: client.public_name,
              address: client.address,
              contactEmail: client.contact_email,
              contactPhone: client.contact_phone,
              enquiryOwnerUserId: client.enquiry_owner_user_id,
              notificationOwnerUserId: client.notification_owner_user_id,
              administrationOwnerUserId: client.administration_owner_user_id,
            }} />
          ) : (
            <Notice tone="neutral">Only admins and managers can edit the profile.</Notice>
          )}
          {manage && (
            <form action={archiveClientAction} className="mt-6 border-t border-line pt-4">
              <input type="hidden" name="clientId" value={id} />
              {client.status === "active" ? (
                <>
                  <p className="text-sm text-muted mb-2">Deactivating hides the client from the active directory. Every task, decision and record is kept.</p>
                  <Button type="submit" variant="danger" size="sm">Deactivate client</Button>
                </>
              ) : (
                <>
                  <input type="hidden" name="restore" value="1" />
                  <Button type="submit" variant="secondary" size="sm">Restore client</Button>
                </>
              )}
            </form>
          )}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Client contacts" description="People at the clinic. One contact can be marked primary." />
          <div className="space-y-6 px-5 pb-5">
            {data.contacts.length === 0 && <p className="text-sm text-muted">{manage ? "No contacts recorded yet." : "No contacts recorded."}</p>}
            {data.contacts.map((contact) => (
              <div key={contact.id} className={`border-b border-line pb-5 ${contact.active ? "" : "opacity-70"}`}>
                {manage ? <ContactForm clientId={id} values={contact} /> : (
                  <p className="text-sm">
                    <span className="font-medium">{contact.name}</span>
                    {contact.is_primary && <Badge tone="info">Primary</Badge>}
                    {contact.designation && <span className="text-muted"> · {contact.designation}</span>}
                    {contact.work_email && <span className="block text-muted">{contact.work_email}</span>}
                    {contact.work_phone && <span className="block text-muted">{contact.work_phone}</span>}
                  </p>
                )}
              </div>
            ))}
            {manage && <div><h3 className="mb-2 text-sm font-semibold">Add a contact</h3><ContactForm key={data.contacts.map((contact) => contact.id).join(",") || "none"} clientId={id} /></div>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Assigned team" description="Staff authorised to access this client. Admins and managers can already see every client." />
          <div className="space-y-3 px-5 pb-5">
            <ul className="divide-y divide-line text-sm">
              {data.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{m.user_name} <Badge>{label(m.user_role)}</Badge> <span className="text-xs text-muted">{m.user_email}</span></span>
                  {assign && (
                    <form action={membershipAction}>
                      <input type="hidden" name="clientId" value={id} />
                      <input type="hidden" name="membershipId" value={m.id} />
                      <Button type="submit" variant="ghost" size="sm">Remove</Button>
                    </form>
                  )}
                </li>
              ))}
              {data.members.length === 0 && <li className="py-2 text-muted">No staff assigned.</li>}
            </ul>
            {assign && nonMembers.length > 0 && (
              <form key={data.members.map((m) => m.id).join(",")} action={membershipAction} className="flex items-end gap-2">
                <input type="hidden" name="clientId" value={id} />
                <label className="flex-1 text-sm">
                  <span className="mb-1 block text-xs font-medium">Assign staff</span>
                  <Select name="userId" defaultValue="">
                    <option value="" disabled>Choose staff</option>
                    {nonMembers.map((s) => (
                      <option key={s.id} value={s.id}>{s.display_name} ({label(s.platform_role)})</option>
                    ))}
                  </Select>
                </label>
                <Button type="submit" variant="secondary" size="sm">Assign</Button>
              </form>
            )}
            <p className="text-xs text-muted">An assignment covers every website of this client. {!assign && "Only an admin can assign or remove staff."}</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Files" description="Titled links only. Genie Works does not store the file itself." />
        <div className="space-y-4 px-5 pb-5 text-sm">
          <ul className="space-y-3">
            {data.files.length === 0 && <li className="text-muted">No file links recorded.</li>}
            {data.files.map((file) => (
              <li key={file.id} className="flex items-start justify-between gap-3">
                <span>
                  <a href={file.url} className="font-medium text-action hover:underline break-all" rel="noreferrer" target="_blank">{file.title}</a>
                  {file.notes && <span className="mt-1 block whitespace-pre-wrap text-muted">{file.notes}</span>}
                  <span className="mt-1 block text-xs text-muted">Opening the file depends on the site that hosts it.</span>
                </span>
                {manage && (
                  <form action={archiveFileLinkAction}>
                    <input type="hidden" name="clientId" value={id} />
                    <input type="hidden" name="fileLinkId" value={file.id} />
                    <Button type="submit" variant="ghost" size="sm">Remove</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {manage && <FileLinkForm clientId={id} />}
        </div>
      </Card>

      <Card>
        <CardHeader title="Booking" description="An external booking destination, or the appointment enquiry form when none is saved. The fallback is the primary contact." />
        <div className="space-y-3 px-5 pb-5 text-sm">
          {data.refs.filter((reference) => reference.kind === "booking" && reference.active).length === 0 ? (
            <p>Appointment enquiry form. No external booking destination is saved.</p>
          ) : data.refs.filter((reference) => reference.kind === "booking" && reference.active).map((reference) => (
            <p key={reference.id}>
              <span className="font-medium">{reference.label}</span>
              {reference.url && <span className="block text-muted">{reference.url}</span>}
            </p>
          ))}
          {(() => {
            const fallback = data.contacts.find((contact) => contact.active && contact.is_primary) ?? data.contacts.find((contact) => contact.active);
            return fallback ? (
              <p className="text-ink-soft">Fallback contact: {fallback.name}{fallback.work_phone ? ` · ${fallback.work_phone}` : ""}{fallback.work_email ? ` · ${fallback.work_email}` : ""}</p>
            ) : <p className="text-muted">No fallback contact is recorded.</p>;
          })()}
          {manage && <p className="text-xs text-muted">Add or change a booking destination in Account references below.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Account references" description="A reference is a saved link, an identifier and the staff member who owns it. Credentials stay in the vault." />
        <div className="space-y-6 px-5 pb-5">
          {data.refs.length === 0 && <p className="text-sm text-muted">{manage ? "No account references recorded yet." : "No account references recorded."}</p>}
          {data.refs.map((r) => (
            <div key={r.id} className={`border-b border-line pb-5 ${r.active ? "" : "opacity-70"}`}>
              {manage ? <ReferenceForm clientId={id} staff={data.staff} values={r} /> : <p className="text-sm">{label(r.kind)}: {r.label}{r.url ? ` · ${r.url}` : ""}{r.owner_name ? ` · ${r.owner_name}` : ""}</p>}
            </div>
          ))}
          {manage && <div><h3 className="mb-2 text-sm font-semibold">Add a reference</h3><ReferenceForm key={data.refs.map((r) => r.id).join(",") || "none"} clientId={id} staff={data.staff} /></div>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Websites" />
        <div className="space-y-6 px-5 pb-5">
          {data.websites.length === 0 && <p className="text-sm text-muted">{manage ? "No websites recorded yet. Add a placeholder address below, not a real clinic URL." : "No websites recorded."}</p>}
          {data.websites.map((w) => (
            <div key={w.id} className="border-b border-line pb-5">
              {manage ? <WebsiteForm clientId={id} values={w} /> : <p className="text-sm">{w.name}{w.url ? ` · ${w.url}` : ""} · {w.platform} · {label(w.environment)} · {label(w.status)}</p>}
            </div>
          ))}
          {manage && <div><h3 className="mb-2 text-sm font-semibold">Add a website</h3><WebsiteForm key={data.websites.map((w) => w.id).join(",") || "none"} clientId={id} /></div>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Record history" description="Who created or updated this client record, and when. Contact details are not copied into the history." />
        <ol className="divide-y divide-line">
          {data.history.length === 0 && <li className="px-5 py-3 text-sm text-muted">No history recorded yet.</li>}
          {data.history.map((event) => (
            <li key={event.id} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-baseline sm:justify-between">
              <span>{HISTORY[event.action] ?? event.action}</span>
              <span className="text-xs text-muted">{event.actor_name ?? "System"} · {formatDateTime(event.occurred_at)}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
