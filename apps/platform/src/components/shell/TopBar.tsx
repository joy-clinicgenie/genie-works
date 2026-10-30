"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { buttonClass } from "@/components/ui/Button";

export interface TopLink {
  href: string;
  label: string;
  keywords?: string;
}

export function TopBar({
  staffName,
  pages,
  clients,
  adds,
}: {
  staffName: string;
  pages: TopLink[];
  clients: TopLink[];
  adds: TopLink[];
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
  const Greeting = pathname === "/" ? "h1" : "p";

  function go(href: string) {
    setSearchOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Greeting className="hidden shrink-0 text-lg font-semibold tracking-tight text-ink sm:block lg:text-[1.35rem]">
        Hey {staffName}, glad to have you back
      </Greeting>
      <div className="relative ml-auto w-full max-w-md min-w-[9rem]">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
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
          className="h-11 w-full rounded-xl bg-surface pr-12 pl-9 text-sm text-ink shadow-[0_0_0_1px_var(--color-line)] outline-none placeholder:text-muted focus:shadow-[0_0_0_2px_var(--color-action)]"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-muted sm:inline">K</kbd>
        {searchOpen && needle && (
          <ul id={listId} role="listbox" className="absolute top-[calc(100%+6px)] z-40 w-full overflow-hidden rounded-2xl bg-surface py-1 shadow-pop">
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
      <Link href="/reports" className={`${buttonClass("secondary", "sm")} hidden whitespace-nowrap sm:inline-flex`}>Reports</Link>
      {adds.length === 1 && <Link href={adds[0]!.href} className={`${buttonClass("primary", "sm")} whitespace-nowrap`}><Plus className="size-4" aria-hidden="true" />Add new</Link>}
      {adds.length > 1 && (
        <div className="relative">
          <button type="button" className={`${buttonClass("primary", "sm")} whitespace-nowrap`} aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen((open) => !open)}>
            <Plus className="size-4" aria-hidden="true" />Add new
          </button>
          {menuOpen && (
            <ul role="menu" className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-40 overflow-hidden rounded-2xl bg-surface py-1 shadow-pop">
              {adds.map((item) => (
                <li key={item.href} role="none">
                  <Link href={item.href} role="menuitem" className="block px-3 py-2 text-sm hover:bg-brand-pale" onClick={() => setMenuOpen(false)}>{item.label}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
