"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * D87: searchable "Select client" for the Blog pages. Choosing another client hides the current
 * client's data at once (it never shows under the new name while the next page loads).
 */
export function BlogScopeView({
  clients,
  clientId,
  children,
}: {
  clients: Array<{ id: string; label: string }>;
  clientId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const current = clients.find((client) => client.id === clientId) ?? null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [requested, setRequested] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const switching = requested !== null && requested !== clientId;
  const needle = query.trim().toLowerCase();
  const matches = (needle ? clients.filter((client) => client.label.toLowerCase().includes(needle)) : clients).slice(0, 50);

  function choose(id: string) {
    setOpen(false);
    setQuery("");
    if (id === clientId) return;
    setRequested(id);
    startTransition(() => router.push(`${pathname}?client=${encodeURIComponent(id)}`));
  }

  const pendingLabel = clients.find((client) => client.id === requested)?.label;
  return (
    <>
      <div className="relative mb-6 max-w-md">
        <label htmlFor={`${listId}-input`} className="mb-1 block text-sm font-medium">Select client</label>
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[highlight] ? `${listId}-${matches[highlight]!.id}` : undefined}
          autoComplete="off"
          placeholder={switching ? pendingLabel ?? "Loading…" : current?.label ?? "Search clients"}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setHighlight((h) => Math.min(h + 1, matches.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
            if (event.key === "Enter" && open && matches[highlight]) { event.preventDefault(); choose(matches[highlight]!.id); }
            if (event.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
          }}
          className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:shadow-[0_0_0_2px_var(--color-action)]"
        />
        {current && !switching && <p className="mt-1 text-xs text-muted">Showing {current.label}</p>}
        {open && (
          <ul id={listId} role="listbox" aria-label="Clients" className="absolute top-[calc(100%+4px)] z-40 max-h-72 w-full overflow-y-auto rounded-2xl bg-surface py-1 text-ink shadow-pop">
            {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted">No client matches.</li>}
            {matches.map((client, index) => (
              <li key={client.id} id={`${listId}-${client.id}`} role="option" aria-selected={client.id === clientId}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={`block w-full px-3 py-2 text-left text-sm ${index === highlight ? "bg-brand-pale" : "hover:bg-brand-pale"}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(client.id)}
                >
                  {client.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {switching ? <p role="status" className="text-sm text-muted">Loading {pendingLabel ?? "client"}…</p> : children}
    </>
  );
}
