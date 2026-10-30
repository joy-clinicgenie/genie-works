"use client";

import { useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import {
  archiveArticleAction,
  publishArticleAction,
  restoreArchivedAction,
  returnToDraftAction,
  reviewArticleAction,
  startRevisionAction,
  submitArticleAction,
  unpublishArticleAction,
} from "@/app/actions/blog";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Textarea } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

export function BlogWorkflow({
  articleId,
  versionId,
  status,
  workingStatus,
  native,
  live,
  title,
  clientName,
  websiteName,
  domain,
  publicUrl,
  approver,
  versionLabel,
  canEdit,
  canDecide,
  canPublish,
}: {
  articleId: string;
  versionId: string | null;
  status: string;
  workingStatus: string | null;
  native: boolean;
  live: boolean;
  title: string;
  clientName: string;
  websiteName: string;
  domain: string | null;
  publicUrl: string | null;
  approver: string | null;
  versionLabel: string;
  canEdit: boolean;
  canDecide: boolean;
  canPublish: boolean;
}) {
  const [submitted, submit, submitting] = useActionState(submitArticleAction, null);
  const [reviewed, review, reviewing] = useActionState(reviewArticleAction, null);
  const [returned, returnDraft, returning] = useActionState(returnToDraftAction, null);
  const [published, publish, publishing] = useActionState(publishArticleAction, null);
  const [unpublished, unpublish, unpublishing] = useActionState(unpublishArticleAction, null);
  const [archived, archive, archiving] = useActionState(archiveArticleAction, null);
  const [restored, restore, restoring] = useActionState(restoreArchivedAction, null);
  const [started, start, starting] = useActionState(startRevisionAction, null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const inReview = status === "in_review" || workingStatus === "in_review";
  const approved = status === "approved" || workingStatus === "approved";
  const draft = status === "draft" || workingStatus === "draft";
  const previewHref = versionId ? `/blog/${articleId}/preview?version=${versionId}` : null;

  return (
    <div className="space-y-4">
      <FormError state={submitted} />
      <FormError state={reviewed} />
      <FormError state={returned} />
      <FormError state={published} />
      <FormError state={unpublished} />
      <FormError state={archived} />
      <FormError state={restored} />
      <FormError state={started} />
      {submitted?.ok && <Notice tone="good">{submitted.message}</Notice>}
      {reviewed?.ok && <Notice tone="good">{reviewed.message}</Notice>}
      {returned?.ok && <Notice tone="good">{returned.message}</Notice>}
      {published?.ok && <Notice tone="good">{published.message} {publicUrl && <a href={publicUrl} className="underline" target="_blank" rel="noreferrer">View live article</a>}</Notice>}
      {unpublished?.ok && <Notice tone="good">{unpublished.message}</Notice>}
      {archived?.ok && <Notice tone="good">{archived.message}</Notice>}
      {restored?.ok && <Notice tone="good">{restored.message}</Notice>}
      {started?.ok && <Notice tone="good">{started.message}</Notice>}
      {!native && <Notice tone="warn" title="Publishing is unavailable">This website is not a native site. The article can be drafted and approved here. It will not be published to Wix.</Notice>}
      {!canPublish && native && <p className="text-sm text-muted">Publishing and unpublishing are limited to an admin or manager.</p>}
      <div className="flex flex-wrap gap-2">
        {canEdit && draft && (
          <form action={submit}><input type="hidden" name="articleId" value={articleId} /><Button type="submit" disabled={submitting}>Submit for review</Button></form>
        )}
        {previewHref && <Link href={previewHref} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium">Preview</Link>}
        {canDecide && inReview && (
          <>
            <form action={review} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="articleId" value={articleId} />
              <input type="hidden" name="decision" value="approved" />
              <Button type="submit" disabled={reviewing}>Approve</Button>
            </form>
            <form action={review} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="articleId" value={articleId} />
              <input type="hidden" name="decision" value="returned" />
              <Field label="Feedback" htmlFor="note"><Textarea id="note" name="note" required maxLength={1000} placeholder="What needs to change" /></Field>
              <Button type="submit" variant="secondary" disabled={reviewing}>Request changes</Button>
            </form>
          </>
        )}
        {(canEdit || canDecide) && (inReview || approved) && (
          <form action={returnDraft}><input type="hidden" name="articleId" value={articleId} /><Button type="submit" variant="secondary" disabled={returning}>Return for editing</Button></form>
        )}
        {canPublish && approved && native && <Button type="button" onClick={() => setConfirmPublish(true)}>Publish</Button>}
        {canEdit && status === "published" && !workingStatus && (
          <form action={start}><input type="hidden" name="articleId" value={articleId} /><Button type="submit" variant="secondary" disabled={starting}>Create revision</Button></form>
        )}
        {canPublish && live && <Button type="button" variant="secondary" onClick={() => setConfirmUnpublish(true)}>Unpublish</Button>}
        {publicUrl && live && <a href={publicUrl} className="inline-flex min-h-11 items-center text-sm text-action underline" target="_blank" rel="noreferrer">View live article</a>}
        {canEdit && !live && (status === "draft" || status === "approved") && (
          <form action={archive}><input type="hidden" name="articleId" value={articleId} /><Button type="submit" variant="ghost" disabled={archiving}>Archive</Button></form>
        )}
        {canEdit && status === "archived" && (
          <form action={restore}><input type="hidden" name="articleId" value={articleId} /><Button type="submit" disabled={restoring}>Restore to draft</Button></form>
        )}
      </div>
      {confirmPublish && (
        <dialog open className="w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-5 text-ink">
          <h2 className="text-lg font-semibold">Publish this article now</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="text-muted">Destination</dt><dd>{clientName} · {websiteName}{domain ? ` · ${domain}` : ""}</dd></div>
            <div><dt className="text-muted">Article</dt><dd>{title || "Untitled article"}</dd></div>
            <div><dt className="text-muted">URL</dt><dd>{publicUrl ?? "The public URL is not configured."}</dd></div>
            <div><dt className="text-muted">Approval</dt><dd>{approver ?? "Approved"} · {versionLabel}</dd></div>
          </dl>
          <form action={publish} className="mt-4 flex flex-wrap gap-2">
            <input type="hidden" name="articleId" value={articleId} />
            <input type="hidden" name="confirm" value="yes" />
            <Button type="submit" disabled={publishing}>Publish now</Button>
            <Button type="button" variant="secondary" onClick={() => setConfirmPublish(false)}>Cancel</Button>
          </form>
        </dialog>
      )}
      {confirmUnpublish && (
        <dialog open className="w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-5 text-ink">
          <h2 className="text-lg font-semibold">Unpublish this article</h2>
          <p className="mt-2 text-sm">This removes <strong>{title || "Untitled article"}</strong> from {websiteName}{domain ? ` (${domain})` : ""}. History is kept. The article returns to draft only after removal succeeds.</p>
          <form action={unpublish} className="mt-4 flex flex-wrap gap-2">
            <input type="hidden" name="articleId" value={articleId} />
            <input type="hidden" name="confirm" value="yes" />
            <Button type="submit" disabled={unpublishing}>Unpublish</Button>
            <Button type="button" variant="secondary" onClick={() => setConfirmUnpublish(false)}>Cancel</Button>
          </form>
        </dialog>
      )}
    </div>
  );
}
