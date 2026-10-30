"use client";

import { useActionState } from "react";
import { restoreVersionAction } from "@/app/actions/blog";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

export function HistoryRestore({ articleId, versionId, needsReplace }: { articleId: string; versionId: string; needsReplace: boolean }) {
  const [state, action, pending] = useActionState(restoreVersionAction, null);
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="articleId" value={articleId} />
      <input type="hidden" name="versionId" value={versionId} />
      <FormError state={state} />
      {state?.ok && <Notice tone="good">{state.message}</Notice>}
      {needsReplace && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="replaceWorking" /> Replace the working revision. The current draft is kept in history.</label>}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "Restoring" : "Restore as draft"}</Button>
    </form>
  );
}
