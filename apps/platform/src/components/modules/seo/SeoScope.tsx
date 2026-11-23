"use client";

import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { SEO_WEBSITE_COOKIE, scopeView, websiteChoiceLabel } from "@/lib/seo-scope";

interface ScopeState {
  currentKey: string;
  requestedKey: string | null;
  requestedLabel: string | null;
  pending: boolean;
  open: (websiteId: string, href: string, label: string) => void;
}

const ScopeContext = createContext<ScopeState | null>(null);

function remember(websiteId: string | null) {
  try {
    document.cookie = websiteId
      ? `${SEO_WEBSITE_COOKIE}=${websiteId}; Path=/; Max-Age=31536000; SameSite=Lax`
      : `${SEO_WEBSITE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // A blocked cookie only loses the remembered website; the URL still carries the selection.
  }
}

/**
 * Holds the SEO website selection in the browser (SEO-01.1, D60). The server still resolves and authorises
 * the website on every request; this only remembers it and hides the old website while a switch loads.
 */
export function SeoScopeProvider({ currentKey, savedUnavailable, children }: { currentKey: string; savedUnavailable?: boolean; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [requested, setRequested] = useState<{ key: string; label: string } | null>(null);

  useEffect(() => {
    if (currentKey) remember(currentKey);
    else if (savedUnavailable) remember(null);
  }, [currentKey, savedUnavailable]);

  const open = useCallback((websiteId: string, href: string, label: string) => {
    setRequested({ key: websiteId, label });
    startTransition(() => router.push(href));
  }, [router]);

  const value = useMemo<ScopeState>(() => ({
    currentKey,
    requestedKey: requested?.key ?? null,
    requestedLabel: requested?.label ?? null,
    pending,
    open,
  }), [currentKey, requested, pending, open]);

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

/**
 * Renders SEO data only for the website the staff member asked for last. During a switch the previous
 * website's data is replaced by a loading state, and the content remounts per website so no client state
 * (such as a connection check result) carries over.
 */
export function SeoScopedContent({ children }: { children: ReactNode }) {
  const scope = useContext(ScopeContext);
  if (!scope) return <>{children}</>;
  if (scopeView({ currentKey: scope.currentKey, requestedKey: scope.requestedKey, pending: scope.pending }) === "loading") {
    return (
      <div role="status" aria-live="polite" className="card p-6 text-sm text-muted">
        Loading {scope.requestedLabel ?? "the selected website"}…
      </div>
    );
  }
  return <Fragment key={scope.currentKey || "none"}>{children}</Fragment>;
}

export interface WebsiteChoice {
  id: string;
  clientName: string;
  name: string;
  environment: "production" | "staging" | "development";
}

/**
 * One selector for every website and environment the staff member can read, labelled
 * Organisation · Website · Environment. Without JavaScript it submits as a plain GET form.
 */
export function SeoWebsiteSelector({ pathname, tab, sites, website, compact = false }: { pathname: string; tab?: string; sites: WebsiteChoice[]; website?: string; compact?: boolean }) {
  const scope = useContext(ScopeContext);
  const [choice, setChoice] = useState(website ?? "");
  const id = `${pathname}-website`;
  if (sites.length === 0) {
    return <p className="mt-3 text-sm text-muted">No website is available to you. Ask an administrator to add you to a clinic with an active website.</p>;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    const site = sites.find((item) => item.id === choice);
    if (!scope || !site) return;
    event.preventDefault();
    const params = new URLSearchParams({ website: site.id });
    if (tab) params.set("tab", tab);
    scope.open(site.id, `${pathname}?${params}`, websiteChoiceLabel(site));
  }
  return (
    <form method="get" action={pathname} onSubmit={submit} className={`flex flex-wrap items-end gap-3 ${compact ? "sm:flex-nowrap" : "mt-3"}`} data-website-selector>
      {tab && <input type="hidden" name="tab" value={tab} />}
      <div className="w-full min-w-0 sm:w-auto">
      <Field label="Organisation · Website · Environment" htmlFor={id}>
        <Select id={id} name="website" value={choice} required onChange={(event) => setChoice(event.target.value)} className="w-full min-w-0 sm:w-80">
          <option value="">Choose a website</option>
          {sites.map((site) => <option key={site.id} value={site.id}>{websiteChoiceLabel(site)}</option>)}
        </Select>
      </Field>
      </div>
      <Button type="submit" variant="secondary" size="sm" disabled={!choice}>Open website</Button>
    </form>
  );
}
