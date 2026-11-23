"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Plus, Search } from "lucide-react";

/** Buttons on the dark back layer (D77): a pale-aqua primary and a quiet outlined secondary. */
const ON_BACK_PRIMARY = "inline-flex min-h-9 items-center justify-center gap-2 rounded-full bg-brand-pale px-3 text-sm font-semibold text-back transition-colors hover:bg-white";
const ON_BACK_SECONDARY = "inline-flex min-h-9 items-center justify-center rounded-full px-3 text-sm font-medium text-white shadow-[0_0_0_1px_rgba(255,255,255,0.22)] transition-colors hover:bg-white/10";

export interface TopLink {
  href: string;
  label: string;
  keywords?: string;
}

export function TopBar({
  heading,
  greeting = false,
  pages,
  clients,
  adds,
  environment,
}: {
  /** The section title, or the greeting on arrival (D77). */
  heading: string;
  greeting?: boolean;
  pages: TopLink[];
  clients: TopLink[];
  adds: TopLink[];
  environment?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setQuery("");
    setSearchOpen(false);
    setMenuOpen(false);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? [...pages, ...clients].filter((item) => `${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(needle)).slice(0, 8)
    : [];
  function go(href: string) {
    setSearchOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:flex-nowrap lg:justify-between lg:gap-8">
      <p className={`flex min-h-11 w-full min-w-0 max-w-full items-center truncate font-semibold tracking-tight text-white lg:w-auto lg:flex-none lg:shrink-0 ${greeting ? "text-lg lg:text-[1.5rem]" : "text-xl lg:text-[1.9rem]"}`} data-section-title>
        {heading}
      </p>
      <div className="flex min-w-0 w-full flex-1 flex-wrap items-center gap-2 lg:ml-auto lg:w-auto lg:flex-none lg:shrink-0 lg:flex-nowrap lg:justify-end lg:gap-3">
      <div className="relative min-w-0 w-full basis-full sm:basis-52 sm:w-auto lg:w-56 xl:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/70" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          role="combobox"
          aria-expanded={searchOpen && needle.length > 0}
          aria-controls={listId}
          aria-label="Search clients and pages"
          placeholder="Search"
          onChange={(event) => {
            setQuery(event.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setSearchOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) {
              event.preventDefault();
              go(matches[0].href);
            }
            if (event.key === "Escape") {
              setSearchOpen(false);
              inputRef.current?.blur();
            }
          }}
          className="h-11 w-full min-w-0 rounded-full bg-white/10 pr-12 pl-9 text-sm text-white shadow-[0_0_0_1px_rgba(255,255,255,0.14)] outline-none placeholder:text-white/60 focus:bg-white/15 focus:shadow-[0_0_0_2px_var(--color-brand-pale)]"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-white/70 sm:inline">K</kbd>
        {searchOpen && needle && (
          <ul id={listId} role="listbox" className="absolute top-[calc(100%+6px)] z-40 w-full overflow-hidden rounded-2xl bg-surface py-1 text-ink shadow-pop">
            {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nothing matches.</li>}
            {matches.map((item) => (
              <li key={item.href} role="option" aria-selected={false}>
                <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-pale" onMouseDown={(event) => event.preventDefault()} onClick={() => go(item.href)}>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
      <Link href="/reports" className={`${ON_BACK_SECONDARY} whitespace-nowrap`}>Reports</Link>
      {adds.length === 1 && <Link href={adds[0]!.href} aria-label="Add new" className={`${ON_BACK_PRIMARY} whitespace-nowrap`}><Plus className="size-4" aria-hidden="true" /><span>Add new</span></Link>}
      {adds.length > 1 && (
        <div className="relative">
          <button type="button" className={`${ON_BACK_PRIMARY} whitespace-nowrap`} aria-label="Add new" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen((open) => !open)}>
            <Plus className="size-4" aria-hidden="true" /><span>Add new</span>
          </button>
          {menuOpen && (
            <ul role="menu" className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-40 overflow-hidden rounded-2xl bg-surface py-1 text-ink shadow-pop">
              {adds.map((item) => (
                <li key={item.href} role="none">
                  <Link href={item.href} role="menuitem" className="block px-3 py-2 text-sm hover:bg-brand-pale" onClick={() => setMenuOpen(false)}>{item.label}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {environment ? <span>{environment}</span> : null}
      </div>
      </div>
    </div>
  );
}
