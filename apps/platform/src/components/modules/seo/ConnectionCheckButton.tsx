"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { checkConnectionAction, type ConnectionCheckResult } from "@/app/actions/seo-connections";
import { acceptScopedResult, checkOutcomeText } from "@/lib/seo-scope";

/**
 * Checks one connection on its own. A result is shown only while the same website and connection are on
 * screen, so a late reply after a website switch is dropped.
 */
export function ConnectionCheckButton({ websiteId, connectionId, provider, label = "Check connection" }: { websiteId: string; connectionId: string; provider: string | null; label?: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ConnectionCheckResult | null>(null);
  const current = useRef({ websiteId, connectionId });

  useEffect(() => {
    current.current = { websiteId, connectionId };
  }, [websiteId, connectionId]);
  // A stored reply for another website or connection is never shown.
  const shown = result && acceptScopedResult({ websiteId, connectionId }, result) ? result : null;

  function run() {
    setResult(null);
    startTransition(async () => {
      try {
        const reply = await checkConnectionAction({ websiteId, connectionId });
        if (acceptScopedResult(current.current, reply)) setResult(reply);
      } catch {
        if (acceptScopedResult(current.current, { websiteId, connectionId })) {
          setResult({ ok: false, websiteId, connectionId, error: "The check could not be completed. Retry the check." });
        }
      }
    });
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="secondary" size="sm" onClick={run} disabled={pending}>
        {pending ? "Checking…" : shown && (!shown.ok || shown.outcome !== "verified") ? "Retry check" : label}
      </Button>
      {/* A completed check is also written to the card's details, so it is announced here but not repeated on screen. */}
      <p aria-live="polite" className={shown?.ok ? "sr-only" : "text-sm text-ink"}>
        {shown ? (shown.ok ? checkOutcomeText(shown.outcome, provider) : shown.error) : null}
      </p>
    </div>
  );
}
