"use client";

import { useActionState } from "react";
import { retryVerificationAction, shipToSiteAction, websitePreviewAction } from "@/app/actions/blog";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

/**
 * D89: Ship to site, Retry verification and Preview on website for a connected website.
 * The buttons are disabled while a request runs so a double click cannot start a second delivery;
 * the server also reuses the running attempt.
 */
export function ShipControls({
  articleId,
  websiteName,
  intendedUrl,
  canShip,
  shippable,
  verifiable,
  previewable,
}: {
  articleId: string;
  websiteName: string;
  intendedUrl: string | null;
  canShip: boolean;
  /** An approved current revision, or a released revision not yet verified. */
  shippable: boolean;
  /** Delivered and awaiting verification. */
  verifiable: boolean;
  previewable: boolean;
}) {
  const [shipped, ship, shipping] = useActionState(shipToSiteAction, null);
  const [verified, verify, verifying] = useActionState(retryVerificationAction, null);
  const [previewed, preview, previewing] = useActionState(websitePreviewAction, null);
  const busy = shipping || verifying;
  return (
    <div className="space-y-3">
      <FormError state={shipped} />
      <FormError state={verified} />
      <FormError state={previewed} />
      {shipped?.ok && <Notice tone="good">{shipped.message} {shipped.href && <a href={shipped.href} className="underline" target="_blank" rel="noreferrer">View live article</a>}</Notice>}
      {verified?.ok && <Notice tone="good">{verified.message} {verified.href && <a href={verified.href} className="underline" target="_blank" rel="noreferrer">View live article</a>}</Notice>}
      {previewed?.ok && previewed.href && <Notice tone="neutral">{previewed.message} <a href={previewed.href} className="underline" target="_blank" rel="noreferrer">Open website preview</a></Notice>}
      <div className="flex flex-wrap items-center gap-2">
        {canShip && shippable && (
          <form action={ship} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="articleId" value={articleId} />
            <Button type="submit" disabled={busy} aria-busy={shipping}>{shipping ? "Shipping…" : `Ship to site: ${websiteName}`}</Button>
            {intendedUrl && <span className="text-sm text-muted">{intendedUrl}</span>}
          </form>
        )}
        {canShip && verifiable && (
          <form action={verify}>
            <input type="hidden" name="articleId" value={articleId} />
            <Button type="submit" variant="secondary" disabled={busy} aria-busy={verifying}>{verifying ? "Checking…" : "Retry verification"}</Button>
          </form>
        )}
        {previewable && (
          <form action={preview}>
            <input type="hidden" name="articleId" value={articleId} />
            <Button type="submit" variant="secondary" disabled={previewing}>{previewing ? "Preparing…" : "Preview on website"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
