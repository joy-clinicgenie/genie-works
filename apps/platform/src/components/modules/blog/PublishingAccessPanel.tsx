"use client";

import { useActionState, useId, useState } from "react";
import { grantPublishingAccessAction, revokePublishingAccessAction } from "@/app/actions/blog";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { FormError } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Table, Td, Th } from "@/components/ui/Table";

type Grant = { id: string; user_id: string; display_name: string; email: string; platform_role: string; granted_by_name: string | null; granted_at: string; revoked_at: string | null; revoked_by_name: string | null };
type Person = { id: string; display_name: string; email: string; platform_role: string };

const ROLE: Record<string, string> = { manager: "Manager", specialist: "Specialist", admin: "Administrator", reviewer: "Reviewer", read_only: "Read only" };

function stamp(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

/** D87: who may release to one website. Only administrators see the grant and revoke actions. */
export function PublishingAccessPanel({
  websiteId,
  websiteName,
  grants,
  revoked,
  eligible,
  admins,
  canManage,
}: {
  websiteId: string;
  websiteName: string;
  grants: Grant[];
  revoked: Grant[];
  eligible: Person[];
  admins: Array<{ id: string; display_name: string }>;
  canManage: boolean;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Administrator override" description="Administrators can release to every website without a grant. They are not listed as grant holders below." />
        <p className="px-5 pb-5 text-sm">{admins.length ? admins.map((admin) => admin.display_name).join(", ") : "No active administrator."}</p>
      </Card>

      <Card>
        <CardHeader title="Publishing access" description={`Staff who can release articles to ${websiteName}. Access applies to this website only.`} />
        {grants.length === 0
          ? <p className="px-5 pb-5 text-sm text-muted">No staff member has publishing access to {websiteName}.</p>
          : (
            <Table caption={`Publishing access for ${websiteName}`}>
              <thead><tr><Th>Staff member</Th><Th>Role</Th><Th>Granted</Th>{canManage && <Th>Action</Th>}</tr></thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id}>
                    <Td><span className="font-medium">{grant.display_name}</span><span className="block text-xs text-muted">{grant.email}</span></Td>
                    <Td>{ROLE[grant.platform_role] ?? grant.platform_role}</Td>
                    <Td>{stamp(grant.granted_at)}{grant.granted_by_name ? ` by ${grant.granted_by_name}` : ""}</Td>
                    {canManage && <Td><RevokeAccess websiteId={websiteId} websiteName={websiteName} userId={grant.user_id} name={grant.display_name} /></Td>}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        {canManage && <GrantAccess websiteId={websiteId} websiteName={websiteName} eligible={eligible} />}
        {!canManage && <p className="px-5 pb-5 text-sm text-muted">Only an administrator can change publishing access.</p>}
      </Card>

      {revoked.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface px-5 py-4 text-sm">
          <summary className="cursor-pointer font-medium">Revoked access ({revoked.length})</summary>
          <ul className="mt-3 space-y-1">
            {revoked.map((grant) => (
              <li key={grant.id}>{grant.display_name} · granted {stamp(grant.granted_at)}{grant.granted_by_name ? ` by ${grant.granted_by_name}` : ""} · revoked {stamp(grant.revoked_at)}{grant.revoked_by_name ? ` by ${grant.revoked_by_name}` : ""}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function GrantAccess({ websiteId, websiteName, eligible }: { websiteId: string; websiteName: string; eligible: Person[] }) {
  const [state, action, pending] = useActionState(grantPublishingAccessAction, null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Person | null>(null);
  const needle = query.trim().toLowerCase();
  const matches = eligible.filter((person) => !needle || `${person.display_name} ${person.email}`.toLowerCase().includes(needle)).slice(0, 30);
  return (
    <form action={action} className="space-y-3 border-t border-line px-5 py-4" onSubmit={() => setOpen(false)}>
      <input type="hidden" name="websiteId" value={websiteId} />
      <input type="hidden" name="userId" value={chosen?.id ?? ""} />
      <div className="relative max-w-md">
        <label htmlFor={`${listId}-input`} className="mb-1 block text-sm font-medium">Grant publishing access</label>
        <input
          id={`${listId}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Search managers and assigned specialists"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setChosen(null); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:shadow-[0_0_0_2px_var(--color-action)]"
        />
        {open && (
          <ul id={listId} role="listbox" aria-label="Eligible staff" className="absolute top-[calc(100%+4px)] z-40 max-h-64 w-full overflow-y-auto rounded-2xl bg-surface py-1 text-ink shadow-pop">
            {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted">{eligible.length ? "No eligible staff member matches." : "Every eligible staff member already has access."}</li>}
            {matches.map((person) => (
              <li key={person.id} role="option" aria-selected={chosen?.id === person.id}>
                <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-pale" onMouseDown={(event) => event.preventDefault()} onClick={() => { setChosen(person); setQuery(person.display_name); setOpen(false); }}>
                  {person.display_name} <span className="text-muted">· {ROLE[person.platform_role] ?? person.platform_role} · {person.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted">Eligible: managers, and specialists assigned to this client. Granting access does not connect or test the website.</p>
      <FormError state={state} />
      {state?.ok && <Notice tone="good">{state.message}</Notice>}
      {chosen && <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>{pending ? "Granting…" : `Grant ${chosen.display_name} publishing access to ${websiteName}`}</Button>}
    </form>
  );
}

function RevokeAccess({ websiteId, websiteName, userId, name }: { websiteId: string; websiteName: string; userId: string; name: string }) {
  const [state, action, pending] = useActionState(revokePublishingAccessAction, null);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <Button type="button" size="sm" variant="secondary" aria-label={`Revoke access: ${name} on ${websiteName}`} onClick={() => setConfirming(true)}>Revoke access</Button>;
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="websiteId" value={websiteId} />
      <input type="hidden" name="userId" value={userId} />
      <p className="text-sm">Revoke {name}&apos;s publishing access to {websiteName}?</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="danger" disabled={pending} aria-busy={pending}>{pending ? "Revoking…" : `Revoke ${name}'s access to ${websiteName}`}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
      </div>
      <FormError state={state} />
    </form>
  );
}
