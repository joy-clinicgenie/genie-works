"use client";

import { useActionState } from "react";
import { retryNotificationAction } from "@/app/actions/enquiries";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/Field";

export function RetryNotification({ outboxId }: { outboxId: string }) {
  const [state, action, pending] = useActionState(retryNotificationAction, null);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="outboxId" value={outboxId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Retrying…" : "Retry"}</Button>
      <FormError state={state} />
    </form>
  );
}
