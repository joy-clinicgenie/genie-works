"use client";

import { useActionState } from "react";
import {
  rotateSeoSiteTokenAction,
  saveGoogleVerificationAction,
  saveSeoBusinessProfileAction,
  saveSeoPageSettingAction,
  saveSeoRedirectAction,
} from "@/app/actions/seo";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, FormError, Input, Select, Textarea } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";

type Site = { id: string; name: string; url: string | null; platform: string };
type PageSetting = { id: string; page_path: string; title: string; description: string; canonical_path: string | null; indexable: boolean };
type Redirect = { id: string; source_path: string; destination_path: string; active: boolean };
type BusinessProfile = { id: string; branch_name: string; profile_url: string | null; external_identifier: string | null; setup_status: string; notes: string | null };

function SiteConnectionForm({ clientId, website, verificationToken, connected, canManageIntegration, canPublish }: { clientId: string; website: Site; verificationToken: string | null; connected: boolean; canManageIntegration: boolean; canPublish: boolean }) {
  const [state, action, pending] = useActionState(saveGoogleVerificationAction, null);
  const [tokenState, tokenAction, tokenPending] = useActionState(rotateSeoSiteTokenAction, null);
  return (
    <div className="space-y-5">
      <form action={action} className="space-y-3">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="websiteId" value={website.id} />
        <Field label="Google Search Console HTML verification token" htmlFor={`gsc-${website.id}`} hint="Paste only the content value from Google's google-site-verification meta tag. Saving publishes the verification tag. It does not verify ownership.">
          <Input id={`gsc-${website.id}`} name="verificationToken" defaultValue={verificationToken ?? ""} maxLength={200} autoComplete="off" disabled={!canPublish} />
        </Field>
        <FormError state={state} />
        {canPublish ? <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Saving…" : "Save verification code"}</Button> : <p className="text-xs text-muted">Publishing a verification tag stays with an admin or manager.</p>}
      </form>
      <div className="border-t border-line pt-4">
        <h3 className="text-sm font-semibold">Connect this published website</h3>
        <p className="mt-1 text-xs text-muted">The API returns published metadata and redirects only. Configure the generated token as SEO_SETTINGS_API_TOKEN, this site&apos;s registry UUID as SEO_WEBSITE_ID, and the Genie Works origin as SEO_SETTINGS_API_URL in the website deployment. Token rotation invalidates the previous token.</p>
        <p className="mt-2 text-xs text-muted">Connection status: <Badge tone={connected ? "good" : "warn"}>{connected ? "Token configured" : "Not connected"}</Badge></p>
        {canManageIntegration ? (
          <>
            <form action={tokenAction} className="mt-3">
              <input type="hidden" name="clientId" value={clientId} />
              <input type="hidden" name="websiteId" value={website.id} />
              <Button type="submit" variant="secondary" size="sm" disabled={tokenPending}>{tokenPending ? "Generating…" : connected ? "Rotate website token" : "Generate website token"}</Button>
            </form>
            {tokenState?.ok && tokenState.token && (
              <div role="status" className="mt-3 rounded-xl border border-warn/30 bg-warn-bg p-3">
                <p className="text-sm font-semibold">{tokenState.message}</p>
                <code className="mt-2 block break-all select-all text-xs">{tokenState.token}</code>
              </div>
            )}
            {tokenState && !tokenState.ok && <p role="alert" className="mt-2 text-sm text-bad">{tokenState.error}</p>}
          </>
        ) : (
          <p className="mt-3 text-xs text-muted">Only admins and managers can create or rotate the website API credential.</p>
        )}
      </div>
    </div>
  );
}

function PageSettingForm({ clientId, website, setting }: { clientId: string; website: Site; setting?: PageSetting }) {
  const [state, action, pending] = useActionState(saveSeoPageSettingAction, null);
  const id = setting?.id ?? `${website.id}-new`;
  return (
    <form action={action} className="space-y-4 rounded-xl border border-line p-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="websiteId" value={website.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Published page path" htmlFor={`page-${id}`} required hint="Use the exact route, for example /services/consultation.">
          <Input id={`page-${id}`} name="pagePath" defaultValue={setting?.page_path ?? ""} required maxLength={500} />
        </Field>
        <Field label="SEO title" htmlFor={`title-${id}`} required>
          <Input id={`title-${id}`} name="title" defaultValue={setting?.title ?? ""} required maxLength={200} />
        </Field>
        <Field label="Meta description" htmlFor={`description-${id}`} required>
          <Textarea id={`description-${id}`} name="description" defaultValue={setting?.description ?? ""} required maxLength={320} />
        </Field>
        <Field label="Canonical path (optional)" htmlFor={`canonical-${id}`} hint="Leave blank to use the page's own canonical URL.">
          <Input id={`canonical-${id}`} name="canonicalPath" defaultValue={setting?.canonical_path ?? ""} maxLength={500} />
        </Field>
      </div>
      <Checkbox name="indexable" label="Allow search engines to index this page" defaultChecked={setting?.indexable ?? true} />
      <FormError state={state} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Publishing…" : "Publish SEO settings"}</Button>
    </form>
  );
}

export function SeoSiteSettingsEditor({ clientId, website, settings, verificationToken, connected, canManageIntegration, canPublish, section = "all" }: { clientId: string; website: Site; settings: PageSetting[]; verificationToken: string | null; connected: boolean; canManageIntegration: boolean; canPublish: boolean; section?: "all" | "connection" | "pages" }) {
  return (
    <section className="space-y-5">
      {section !== "pages" && <SiteConnectionForm clientId={clientId} website={website} verificationToken={verificationToken} connected={connected} canManageIntegration={canManageIntegration} canPublish={canPublish} />}
      {section !== "connection" && (
        <div className={section === "all" ? "border-t border-line pt-4" : ""}>
          <h3 className="mb-3 text-sm font-semibold">Page titles and descriptions</h3>
          {canPublish ? (
            <div className="space-y-3">
              {settings.map((setting) => <PageSettingForm key={setting.id} clientId={clientId} website={website} setting={setting} />)}
              <PageSettingForm clientId={clientId} website={website} />
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              {settings.length === 0 && <p className="text-muted">No published page settings.</p>}
              {settings.map((setting) => <p key={setting.id}>{setting.page_path} — {setting.title}</p>)}
              <p className="text-xs text-muted">Publishing page titles and descriptions stays with an admin or manager.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function SeoRedirectForm({ clientId, websiteId, redirect, initialSource = "", initialDestination = "" }: { clientId: string; websiteId: string; redirect?: Redirect; initialSource?: string; initialDestination?: string }) {
  const [state, action, pending] = useActionState(saveSeoRedirectAction, null);
  const id = redirect?.id ?? "new";
  return (
    <form action={action} className="grid gap-3 rounded-xl border border-line p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="websiteId" value={websiteId} />
      {redirect && <input type="hidden" name="redirectId" value={redirect.id} />}
      <Field label="From path" htmlFor={`from-${id}`} required>
        <Input id={`from-${id}`} name="sourcePath" defaultValue={redirect?.source_path ?? initialSource} placeholder="/old-page" required maxLength={500} />
      </Field>
      <Field label="To path" htmlFor={`to-${id}`} required>
        <Input id={`to-${id}`} name="destinationPath" defaultValue={redirect?.destination_path ?? initialDestination} placeholder="/new-page" required maxLength={500} />
      </Field>
      <div className="flex items-center gap-3">
        <Checkbox name="active" label="Active (301)" defaultChecked={redirect?.active ?? true} />
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Saving…" : redirect ? "Save" : "Add redirect"}</Button>
      </div>
      {state && !state.ok && <p role="alert" className="text-sm text-bad md:col-span-3">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-good md:col-span-3">{state.message}</p>}
    </form>
  );
}

export function SeoBusinessProfileForm({ clientId, profile }: { clientId: string; profile?: BusinessProfile }) {
  const [state, action, pending] = useActionState(saveSeoBusinessProfileAction, null);
  const id = profile?.id ?? "new";
  return (
    <form action={action} className="space-y-3 rounded-xl border border-line p-4">
      <input type="hidden" name="clientId" value={clientId} />
      {profile && <input type="hidden" name="profileId" value={profile.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Clinic branch" htmlFor={`branch-${id}`} required>
          <Input id={`branch-${id}`} name="branchName" defaultValue={profile?.branch_name ?? ""} required maxLength={120} />
        </Field>
        <Field label="Google Business Profile URL" htmlFor={`gbp-url-${id}`} hint="Optional. Use the HTTPS Google profile or Maps link.">
          <Input id={`gbp-url-${id}`} name="profileUrl" type="url" defaultValue={profile?.profile_url ?? ""} maxLength={1000} />
        </Field>
        <Field label="Google profile/location ID (optional)" htmlFor={`gbp-id-${id}`}>
          <Input id={`gbp-id-${id}`} name="externalIdentifier" defaultValue={profile?.external_identifier ?? ""} maxLength={200} />
        </Field>
        <Field label="Setup status" htmlFor={`gbp-status-${id}`}>
          <Select id={`gbp-status-${id}`} name="setupStatus" defaultValue={profile?.setup_status ?? "not_started"}>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="staff_marked_verified">Staff marked verified</option>
          </Select>
        </Field>
      </div>
      <Field label="Notes" htmlFor={`gbp-notes-${id}`}>
        <Textarea id={`gbp-notes-${id}`} name="notes" defaultValue={profile?.notes ?? ""} maxLength={2000} />
      </Field>
      <FormError state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Saving…" : profile ? "Save branch profile" : "Add branch profile"}</Button>
        <a href="https://business.google.com/" target="_blank" rel="noreferrer" className="text-sm text-action hover:underline">Open in Google</a>
        {profile?.profile_url && <a href={profile.profile_url} target="_blank" rel="noreferrer" className="text-sm text-action hover:underline">Open branch profile</a>}
      </div>
    </form>
  );
}
