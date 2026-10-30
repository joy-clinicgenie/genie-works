"use client";

import { useActionState } from "react";
import { uploadArticleMediaAction } from "@/app/actions/blog";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Input } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

export function ImageUpload({ articleId }: { articleId: string }) {
  const [state, action, pending] = useActionState(uploadArticleMediaAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="articleId" value={articleId} />
      <FormError state={state} />
      {state?.ok && <Notice tone="good">{state.message}</Notice>}
      <Field label="Upload image" htmlFor="file" hint="PNG, JPEG or WebP. 1 MB or smaller.">
        <Input id="file" name="file" type="file" accept="image/png,image/jpeg,image/webp" />
      </Field>
      <Field label="Alt text" htmlFor="altText">
        <Input id="altText" name="altText" maxLength={300} />
      </Field>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Uploading" : "Upload image"}</Button>
    </form>
  );
}
