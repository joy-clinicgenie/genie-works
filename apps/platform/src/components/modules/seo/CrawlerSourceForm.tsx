"use client";

import { useActionState } from "react";
import { createCrawlerSourceAction } from "@/app/actions/seo-ai";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select } from "@/components/ui/Field";

/** Connects a request-log feed (administrator). The token appears once, like the website settings API token. */
export function CrawlerSourceForm({ websiteId, ingestUrl }: { websiteId: string; ingestUrl: string }) {
  const [state, action, pending] = useActionState(createCrawlerSourceAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="websiteId" value={websiteId} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Source name" htmlFor="crawler-source-label">
          <Input id="crawler-source-label" name="label" required maxLength={120} placeholder="Website request log" />
        </Field>
        <Field label="Source type" htmlFor="crawler-source-kind">
          <Select id="crawler-source-kind" name="kind" defaultValue="request_log">
            <option value="request_log">Website request log</option>
            <option value="platform_feed">Platform feed</option>
          </Select>
        </Field>
      </div>
      <Checkbox name="geminiAttribution" label="This source supplies documented Gemini attribution (otherwise Gemini stays Unavailable)" />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Connecting…" : "Connect log source"}</Button>
      {state && !state.ok && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state?.ok && (
        <div role="status" className="rounded-xl border border-warn/30 bg-warn-bg p-3 text-sm">
          <p className="font-semibold">{state.message}</p>
          <code className="mt-2 block select-all break-all text-xs">{state.token}</code>
          <p className="mt-2 text-xs">POST batches to <span className="break-all font-mono">{ingestUrl}</span> with <span className="font-mono">Authorization: Bearer</span> and this token.</p>
        </div>
      )}
    </form>
  );
}
