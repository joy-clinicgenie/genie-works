"use client";

import { useActionState, useState } from "react";
import { saveWebsiteConnectionAction } from "@/app/actions/blog";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Input } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

/** D89: administrator set-up of the blog route and publish secret. The saved secret is never shown. */
export function WebsiteConnectionForm({ websiteId, websiteName, basePath, configured }: { websiteId: string; websiteName: string; basePath: string; configured: boolean }) {
  const [state, action, pending] = useActionState(saveWebsiteConnectionAction, null);
  const [route, setRoute] = useState(basePath);
  const err = (field: string) => (state && !state.ok && state.field === field ? state.error : null);
  return (
    <form action={action} className="space-y-4 border-t border-line px-5 py-4" autoComplete="off">
      <input type="hidden" name="websiteId" value={websiteId} />
      <Field label="Blog route" htmlFor="basePath" hint={`Where ${websiteName} shows articles, for example /genie-tips. Articles ship to this route plus their slug.`} error={err("basePath")}>
        <Input id="basePath" name="basePath" value={route} onChange={(event) => setRoute(event.target.value)} maxLength={120} />
      </Field>
      <Field
        label={configured ? "Replace publish secret" : "Publish secret"}
        htmlFor="secret"
        hint={configured ? "Leave empty to keep the saved secret. A new value must also replace GENIE_WORKS_PUBLISH_SECRET on the website." : "Generate it with: openssl rand -base64 32. Set the same value as GENIE_WORKS_PUBLISH_SECRET on the website, then paste it here. It is stored encrypted and never shown again."}
        error={err("secret")}
      >
        <Input id="secret" name="secret" type="password" autoComplete="new-password" spellCheck={false} maxLength={200} />
      </Field>
      <FormError state={state && !state.ok && !state.field ? state : null} />
      {state?.ok && <Notice tone="good">{state.message}</Notice>}
      <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save website connection"}</Button>
    </form>
  );
}
