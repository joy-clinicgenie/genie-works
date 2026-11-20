"use client";

import { useActionState } from "react";
import { saveSeoPageSettingAction } from "@/app/actions/seo";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Input, Textarea } from "@/components/ui/Field";
import { IndexingPreferenceField } from "@/components/modules/SeoSoftLaunchForms";

/**
 * Page-level overrides for one page through the connected site's settings API (SEO-03.2, D61).
 * A blank field inherits; saving advances only the Saved state.
 */
export function PageSeoForm({ clientId, websiteId, pagePath, canonicalPath, title, description, indexable }: {
  clientId: string;
  websiteId: string;
  pagePath: string;
  canonicalPath: string | null;
  title: string | null;
  description: string | null;
  indexable: boolean | null;
}) {
  const [state, action, pending] = useActionState(saveSeoPageSettingAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="websiteId" value={websiteId} />
      <input type="hidden" name="pagePath" value={pagePath} />
      <input type="hidden" name="canonicalPath" value={canonicalPath ?? ""} />
      <Field label="SEO title override" htmlFor="page-seo-title" hint="Leave blank to inherit the website default.">
        <Input id="page-seo-title" name="title" defaultValue={title ?? ""} maxLength={200} />
      </Field>
      <Field label="Meta description override" htmlFor="page-seo-description" hint="Leave blank to inherit the website default.">
        <Textarea id="page-seo-description" name="description" defaultValue={description ?? ""} maxLength={320} />
      </Field>
      <IndexingPreferenceField id="page-seo-indexing" value={indexable} />
      <FormError state={state} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Saving…" : "Save page settings"}</Button>
    </form>
  );
}
