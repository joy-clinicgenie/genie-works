"use client";

import { useState } from "react";
import { useActionState } from "react";
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
import { Button, LinkButton } from "@/components/ui/Button";
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
  intendedUrl = null,
  approver,
  versionLabel,
  canEdit,
  canDecide,
  canPublish,
  shipConnected = false,
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
  /** The address the article is meant to have on the website; not evidence that it is there. */
  intendedUrl?: string | null;
  approver: string | null;
  versionLabel: string;
  canEdit: boolean;
  canDecide: boolean;
  canPublish: boolean;
  /** D89: the website is connected for Ship to site, which replaces the internal release. */
  shipConnected?: boolean;
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
      {published?.ok && <Notice tone="good">{published.message}</Notice>}
      {unpublished?.ok && <Notice tone="good">{unpublished.message}</Notice>}
      {archived?.ok && <Notice tone="good">{archived.message}</Notice>}
      {restored?.ok && <Notice tone="good">{restored.message}</Notice>}
      {started?.ok && <Notice tone="good">{started.message}</Notice>}
      {!native && <Notice tone="warn" title="Publishing is unavailable">This website is not a native site. The article can be drafted and approved here. It will not be published to Wix.</Notice>}
      {!canPublish && native && <p className="text-sm text-muted">Releasing to this website needs publishing access for it from an administrator.</p>}
      <div className="flex flex-wrap gap-2">
        {canEdit && draft && (
          <form action={submit}><input type="hidden" name="articleId" value={articleId} /><Button type="submit" disabled={submitting}>Submit for review</Button></form>
        )}
        {previewHref && <LinkButton href={previewHref} variant="secondary">Preview</LinkButton>}
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
        {canPublish && approved && native && !shipConnected && <Button type="button" onClick={() => setConfirmPublish(true)}>Release to content API</Button>}
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
          <h2 className="text-lg font-semibold">Release to content API</h2>
          <p className="mt-2 text-sm">This makes the approved revision available through the content API. It does not deliver the article to the website or check it there, so website publication stays unverified until Ship to site is available.</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div><dt className="text-muted">Destination</dt><dd>{clientName} · {websiteName}{domain ? ` · ${domain}` : ""}</dd></div>
            <div><dt className="text-muted">Article</dt><dd>{title || "Untitled article"}</dd></div>
            <div><dt className="text-muted">Intended URL</dt><dd>{intendedUrl ?? "The website URL or slug is not set."}</dd></div>
            <div><dt className="text-muted">Approval</dt><dd>{approver ?? "Approved"} · {versionLabel}</dd></div>
          </dl>
          <form action={publish} className="mt-4 flex flex-wrap gap-2">
            <input type="hidden" name="articleId" value={articleId} />
            <input type="hidden" name="confirm" value="yes" />
            <Button type="submit" disabled={publishing}>Release now</Button>
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
