"use client";

import { useActionState } from "react";
import { updateOwnNameAction } from "@/app/actions/settings";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Input } from "@/components/ui/Field";

export function SettingsProfile({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState(updateOwnNameAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="displayName" required>
          <Input id="displayName" name="displayName" defaultValue={name} required maxLength={120} />
        </Field>
        <Field label="Sign-in email" htmlFor="work-email" hint="An admin changes this address. No password is stored here.">
          <Input id="work-email" value={email} readOnly aria-readonly="true" />
        </Field>
      </div>
      <FormError state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save name"}</Button>
    </form>
  );
}
