"use client";

import { useActionState, useState } from "react";
import { ACCOUNT_REFERENCE_KINDS, CLIENT_CHANNELS } from "@clinic-genie/contracts";
import { createClientAction, saveContactAction, saveFileLinkAction, saveReferenceAction, saveWebsiteAction, updateClientAction } from "@/app/actions/clients";
import type { ActionState } from "@/lib/actions";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, FormError, Input, Select, Textarea } from "@/components/ui/Field";
import { label } from "@/components/ui/Badge";

type Staff = Array<{ id: string; display_name: string }>;

function banner(state: ActionState): ActionState {
  if (state && !state.ok && state.field) return null;
  return state;
}

function describedBy(id: string, error: string | null, hint = false) {
  return {
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  };
}

function StaffSelect({ id, name, value, onChange, staff }: { id: string; name: string; value: string; onChange: (value: string) => void; staff: Staff }) {
  return (
    <Select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Unassigned</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>{s.display_name}</option>
      ))}
    </Select>
  );
}

export function ClientForm({ mode, staff, values }: { mode: "create" | "edit"; staff: Staff; values: { clientId?: string; slug?: string; name?: string; ownerUserId?: string | null; channels?: string[]; services?: string | null; notes?: string | null; isSynthetic?: boolean; referenceNumber?: string | null; shortCode?: string | null; specialty?: string | null; legalName?: string | null; publicName?: string | null; address?: string | null; contactEmail?: string | null; contactPhone?: string | null; enquiryOwnerUserId?: string | null; notificationOwnerUserId?: string | null; administrationOwnerUserId?: string | null } }) {
  const [state, action, pending] = useActionState(mode === "create" ? createClientAction : updateClientAction, null);
  const [name, setName] = useState(values.name ?? "");
  const [slug, setSlug] = useState(values.slug ?? "");
  const [owner, setOwner] = useState(values.ownerUserId ?? "");
  const [channels, setChannels] = useState(values.channels ?? []);
  const [services, setServices] = useState(values.services ?? "");
  const [notes, setNotes] = useState(values.notes ?? "");
  const [synthetic, setSynthetic] = useState(Boolean(values.isSynthetic));
  const [referenceNumber, setReferenceNumber] = useState(values.referenceNumber ?? "");
  const [shortCode, setShortCode] = useState(values.shortCode ?? "");
  const [specialty, setSpecialty] = useState(values.specialty ?? "");
  const [legalName, setLegalName] = useState(values.legalName ?? "");
  const [publicName, setPublicName] = useState(values.publicName ?? "");
  const [address, setAddress] = useState(values.address ?? "");
  const [contactEmail, setContactEmail] = useState(values.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(values.contactPhone ?? "");
  const [enquiryOwner, setEnquiryOwner] = useState(values.enquiryOwnerUserId ?? "");
  const [notificationOwner, setNotificationOwner] = useState(values.notificationOwnerUserId ?? "");
  const [administrationOwner, setAdministrationOwner] = useState(values.administrationOwnerUserId ?? "");
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : null);
  return (
    <form action={action} className="space-y-5">
      {values.clientId && <input type="hidden" name="clientId" value={values.clientId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client ID" htmlFor="referenceNumber" error={err("referenceNumber")} hint="Unique client reference, for example CG-001.">
          <Input id="referenceNumber" name="referenceNumber" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} maxLength={40} {...describedBy("referenceNumber", err("referenceNumber"), true)} />
        </Field>
        <Field label="Short code" htmlFor="shortCode" error={err("shortCode")} hint="Clinic abbreviation, for example CFAC.">
          <Input id="shortCode" name="shortCode" value={shortCode} onChange={(e) => setShortCode(e.target.value.toUpperCase())} maxLength={20} {...describedBy("shortCode", err("shortCode"), true)} />
        </Field>
        <Field label="Clinic name" htmlFor="name" required>
          <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <Field label="Specialty" htmlFor="specialty">
          <Input id="specialty" name="specialty" value={specialty} onChange={(e) => setSpecialty(e.target.value)} maxLength={80} />
        </Field>
        {mode === "create" ? (
          <Field label="Identifier" htmlFor="slug" required hint="Lowercase, numbers and hyphens. Permanent." error={err("slug")}>
            <Input id="slug" name="slug" value={slug} onChange={(e) => setSlug(e.target.value)} required pattern="[a-z0-9][a-z0-9-]{1,62}" {...describedBy("slug", err("slug"), true)} />
          </Field>
        ) : (
          <Field label="Identifier" htmlFor="slug-ro" hint="Permanent. It does not change.">
            <Input id="slug-ro" value={values.slug ?? ""} readOnly aria-readonly="true" className="read-only:bg-surface-muted read-only:text-muted" />
          </Field>
        )}
        <Field label="Clinic Genie owner" htmlFor="ownerUserId" hint="The staff member answerable for this client.">
          <StaffSelect id="ownerUserId" name="ownerUserId" value={owner} onChange={setOwner} staff={staff} />
        </Field>
        <Field label="Registered business name" htmlFor="legalName">
          <Input id="legalName" name="legalName" value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={160} />
        </Field>
        <Field label="Public clinic name" htmlFor="publicName">
          <Input id="publicName" name="publicName" value={publicName} onChange={(e) => setPublicName(e.target.value)} maxLength={160} />
        </Field>
        <Field label="General email" htmlFor="contactEmail" error={err("contactEmail")}>
          <Input id="contactEmail" name="contactEmail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} maxLength={160} {...describedBy("contactEmail", err("contactEmail"))} />
        </Field>
        <Field label="General telephone" htmlFor="contactPhone">
          <Input id="contactPhone" name="contactPhone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} maxLength={40} />
        </Field>
      </div>
      <Field label="Clinic address" htmlFor="address">
        <Textarea id="address" name="address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
      </Field>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Operational contacts</legend>
        <p className="text-xs text-muted">Staff responsible for each kind of operational issue. These are not patient contacts.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Enquiries" htmlFor="enquiryOwnerUserId">
            <StaffSelect id="enquiryOwnerUserId" name="enquiryOwnerUserId" value={enquiryOwner} onChange={setEnquiryOwner} staff={staff} />
          </Field>
          <Field label="Notification issues" htmlFor="notificationOwnerUserId">
            <StaffSelect id="notificationOwnerUserId" name="notificationOwnerUserId" value={notificationOwner} onChange={setNotificationOwner} staff={staff} />
          </Field>
          <Field label="Account administration" htmlFor="administrationOwnerUserId">
            <StaffSelect id="administrationOwnerUserId" name="administrationOwnerUserId" value={administrationOwner} onChange={setAdministrationOwner} staff={staff} />
          </Field>
        </div>
      </fieldset>
      <Field label="Services" htmlFor="services" hint="A plain description of what the clinic offers. Channel tags below are not the service list.">
        <Textarea id="services" name="services" value={services} onChange={(e) => setServices(e.target.value)} maxLength={2000} />
      </Field>
      <fieldset>
        <legend className="text-sm font-medium mb-1">Active channels</legend>
        <div className="flex flex-wrap gap-x-5">
          {CLIENT_CHANNELS.map((c) => (
            <Checkbox
              key={c}
              name="channels"
              value={c}
              checked={channels.includes(c)}
              onChange={(e) => setChannels((current) => e.target.checked ? [...current, c] : current.filter((item) => item !== c))}
              label={label(c)}
            />
          ))}
        </div>
      </fieldset>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </Field>
      {mode === "create" && (
        <Checkbox name="isSynthetic" label="This is demonstration data (fictional client)" checked={synthetic} onChange={(e) => setSynthetic(e.target.checked)} />
      )}
      <FormError state={banner(state)} />
      <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : mode === "create" ? "Create client" : "Save details"}</Button>
    </form>
  );
}

export function ContactForm({ clientId, values }: { clientId: string; values?: { id: string; name: string; designation: string | null; work_email: string | null; work_phone: string | null; is_primary: boolean; active: boolean } }) {
  const [state, action, pending] = useActionState(saveContactAction, null);
  const [name, setName] = useState(values?.name ?? "");
  const [designation, setDesignation] = useState(values?.designation ?? "");
  const [workEmail, setWorkEmail] = useState(values?.work_email ?? "");
  const [workPhone, setWorkPhone] = useState(values?.work_phone ?? "");
  const [primary, setPrimary] = useState(values?.is_primary ?? false);
  const [deactivate, setDeactivate] = useState(values ? !values.active : false);
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : null);
  const id = values?.id ?? "new";
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      {values && <input type="hidden" name="contactId" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact name" htmlFor={`c-name-${id}`} required error={err("name")}>
          <Input id={`c-name-${id}`} name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} {...describedBy(`c-name-${id}`, err("name"))} />
        </Field>
        <Field label="Designation" htmlFor={`c-role-${id}`}>
          <Input id={`c-role-${id}`} name="designation" value={designation} onChange={(e) => setDesignation(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Work email" htmlFor={`c-email-${id}`} error={err("workEmail")}>
          <Input id={`c-email-${id}`} name="workEmail" type="email" value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} maxLength={160} {...describedBy(`c-email-${id}`, err("workEmail"))} />
        </Field>
        <Field label="Work telephone" htmlFor={`c-phone-${id}`}>
          <Input id={`c-phone-${id}`} name="workPhone" value={workPhone} onChange={(e) => setWorkPhone(e.target.value)} maxLength={40} />
        </Field>
      </div>
      <Checkbox name="isPrimary" label="Primary contact" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
      {values && <Checkbox name="deactivate" label="Deactivate this contact" checked={deactivate} onChange={(e) => setDeactivate(e.target.checked)} />}
      <FormError state={banner(state)} />
      <Button type="submit" variant={values ? "secondary" : "primary"} size="sm" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : values ? "Save contact" : "Add contact"}</Button>
    </form>
  );
}

export function WebsiteForm({ clientId, values }: { clientId: string; values?: { id: string; name: string; url: string | null; platform: string; environment: string; status: string; notes: string | null; blog_requirements?: { author?: boolean; category?: boolean; featuredImage?: boolean; seo?: boolean; social?: boolean } } }) {
  const [state, action, pending] = useActionState(saveWebsiteAction, null);
  const [name, setName] = useState(values?.name ?? "");
  const [url, setUrl] = useState(values?.url ?? "");
  const [platform, setPlatform] = useState(values?.platform ?? "");
  const [environment, setEnvironment] = useState(values?.environment ?? "production");
  const [status, setStatus] = useState(values?.status ?? "active");
  const [notes, setNotes] = useState(values?.notes ?? "");
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : null);
  const id = values?.id ?? "new";
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      {values && <input type="hidden" name="websiteId" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`w-name-${id}`} required>
          <Input id={`w-name-${id}`} name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <Field label="URL" htmlFor={`w-url-${id}`} error={err("url")}>
          <Input id={`w-url-${id}`} name="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" {...describedBy(`w-url-${id}`, err("url"))} />
        </Field>
        <Field label="Platform" htmlFor={`w-platform-${id}`} hint="For example Wix, WordPress, Next.js on Vercel.">
          <Input id={`w-platform-${id}`} name="platform" value={platform} onChange={(e) => setPlatform(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Environment" htmlFor={`w-env-${id}`}>
          <Select id={`w-env-${id}`} name="environment" value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </Select>
        </Field>
        {values && (
          <Field label="Status" htmlFor={`w-status-${id}`}>
            <Select id={`w-status-${id}`} name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
        )}
      </div>
      <Field label="Notes" htmlFor={`w-notes-${id}`}>
        <Textarea id={`w-notes-${id}`} name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>
      {values && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Article requirements</legend>
          <p className="text-xs text-muted">Unchecked fields can be left empty when an article is submitted for review.</p>
          <Checkbox name="requireAuthor" label="Require an author" defaultChecked={values.blog_requirements?.author === true} />
          <Checkbox name="requireCategory" label="Require a category" defaultChecked={values.blog_requirements?.category === true} />
          <Checkbox name="requireFeaturedImage" label="Require a featured image and alt text" defaultChecked={values.blog_requirements?.featuredImage === true} />
          <Checkbox name="requireSeo" label="Require an SEO title and description" defaultChecked={values.blog_requirements?.seo === true} />
          <Checkbox name="requireSocial" label="Require a sharing title and description" defaultChecked={values.blog_requirements?.social === true} />
        </fieldset>
      )}
      <FormError state={banner(state)} />
      <Button type="submit" variant={values ? "secondary" : "primary"} size="sm" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : values ? "Save website" : "Add website"}</Button>
    </form>
  );
}

export function ReferenceForm({ clientId, staff, values }: { clientId: string; staff: Staff; values?: { id: string; kind: string; label: string; external_identifier: string | null; url: string | null; vault_reference: string | null; notes: string | null; owner_user_id: string | null; active: boolean } }) {
  const [state, action, pending] = useActionState(saveReferenceAction, null);
  const [kind, setKind] = useState(values?.kind ?? "other");
  const [refLabel, setRefLabel] = useState(values?.label ?? "");
  const [externalId, setExternalId] = useState(values?.external_identifier ?? "");
  const [url, setUrl] = useState(values?.url ?? "");
  const [vault, setVault] = useState(values?.vault_reference ?? "");
  const [notes, setNotes] = useState(values?.notes ?? "");
  const [owner, setOwner] = useState(values?.owner_user_id ?? "");
  const [deactivate, setDeactivate] = useState(values ? !values.active : false);
  const err = (f: string) => (state && !state.ok && state.field === f ? state.error : null);
  const k = values?.id ?? "new";
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      {values && <input type="hidden" name="referenceId" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind" htmlFor={`r-kind-${k}`}>
          <Select id={`r-kind-${k}`} name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {ACCOUNT_REFERENCE_KINDS.map((item) => (
              <option key={item} value={item}>{label(item)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Label" htmlFor={`r-label-${k}`} required error={err("label")}>
          <Input id={`r-label-${k}`} name="label" value={refLabel} onChange={(e) => setRefLabel(e.target.value)} required maxLength={120} {...describedBy(`r-label-${k}`, err("label"))} />
        </Field>
        <Field label="Identifier" htmlFor={`r-ext-${k}`} hint="Account or property ID as given by the client. Never a password.">
          <Input id={`r-ext-${k}`} name="externalIdentifier" value={externalId} onChange={(e) => setExternalId(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Link" htmlFor={`r-url-${k}`} error={err("url")}>
          <Input id={`r-url-${k}`} name="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" {...describedBy(`r-url-${k}`, err("url"))} />
        </Field>
        <Field label="Vault reference" htmlFor={`r-vault-${k}`} hint="Where the credential lives, for example vault://clinic-genie/client/ga4. The secret itself is not stored here.">
          <Input id={`r-vault-${k}`} name="vaultReference" value={vault} onChange={(e) => setVault(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Account owner" htmlFor={`r-owner-${k}`} hint="Staff member who looks after this account.">
          <StaffSelect id={`r-owner-${k}`} name="ownerUserId" value={owner} onChange={setOwner} staff={staff} />
        </Field>
      </div>
      <Field label="Notes" htmlFor={`r-notes-${k}`}>
        <Textarea id={`r-notes-${k}`} name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>
      {values && (
        <Checkbox name="deactivate" label="Deactivate this reference" checked={deactivate} onChange={(e) => setDeactivate(e.target.checked)} />
      )}
      <FormError state={banner(state)} />
      <Button type="submit" variant={values ? "secondary" : "primary"} size="sm" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : values ? "Save reference" : "Add reference"}</Button>
    </form>
  );
}

export function FileLinkForm({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(saveFileLinkAction, null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      <p className="text-xs text-muted">Save a titled https link. Genie Works controls who can see the link. The site that hosts the file controls who can open it.</p>
      <Field label="Title" htmlFor="file-title">
        <Input id="file-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
      </Field>
      <Field label="https link" htmlFor="file-url">
        <Input id="file-url" name="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" required />
      </Field>
      <Field label="Notes" htmlFor="file-notes">
        <Textarea id="file-notes" name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>
      <FormError state={banner(state)} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Add file link"}</Button>
    </form>
  );
}
