"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Menu, X, LayoutDashboard, Building2, Inbox, ClipboardList, Search, BarChart3, LineChart, Settings, Shield } from "lucide-react";
import { BackButton, BackSlotProvider } from "./BackButton";
import { TopBar, type TopLink } from "./TopBar";
import { GREETED_COOKIE } from "@/lib/greeting";

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

const ICONS = { LayoutDashboard, Building2, Inbox, ClipboardList, Search, BarChart3, LineChart, Settings, Shield };

function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  if (item.href === "/enquiries") return pathname.startsWith("/enquiries") || pathname.startsWith("/forms");
  return pathname.startsWith(item.href) || (item.href === "/my-tasks" && pathname.startsWith("/tasks"));
}

/** The section title shown in the top bar: the current main-menu section, otherwise the first path segment. */
export function sectionTitle(items: NavItem[], pathname: string): string {
  const current = items.filter((item) => isActive(item, pathname)).sort((a, b) => b.href.length - a.href.length)[0];
  if (current) return current.label;
  const segment = pathname.split("/").filter(Boolean)[0] ?? "";
  const words = segment.replace(/-/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Genie Works";
}

/**
 * Main navigation on the dark back layer (D77). On the desktop rail each item is an icon in a round tile with its
 * label beneath, after the reference; collapsed, only the icon shows. In the phone drawer items run in a row.
 */
function NavGroup({ title, items, pathname, mode }: { title: string; items: NavItem[]; pathname: string; mode: "rail" | "icons" | "drawer" }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="sr-only">{title}</p>
      {mode === "drawer" && <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">{title}</div>}
      <ul className={mode === "drawer" ? "space-y-1" : "space-y-0.5"}>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(item, pathname);
          const tile = `grid size-10 shrink-0 place-items-center rounded-full transition-colors ${active ? "bg-brand-pale text-back" : "bg-white/[0.06] text-white/80 group-hover/item:bg-white/15 group-hover/item:text-white"}`;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={mode === "icons" ? item.label : undefined}
                className={mode === "drawer"
                  ? `group/item flex min-h-12 items-center gap-3 rounded-2xl px-2 text-sm font-medium ${active ? "bg-white/10 text-white" : "text-white/75 hover:bg-white/[0.06] hover:text-white"}`
                  : `group/item flex flex-col items-center gap-1 rounded-2xl px-1 py-1.5 text-center text-[11px] font-medium leading-tight ${active ? "text-white" : "text-white/70 hover:text-white"}`}
              >
                <span aria-hidden="true" className={tile}><Icon className="size-[18px]" strokeWidth={1.75} /></span>
                <span className={mode === "icons" ? "sr-only" : ""}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Navigation({ workspace, modules, platform, pathname, mode }: { workspace: NavItem[]; modules: NavItem[]; platform: NavItem[]; pathname: string; mode: "rail" | "icons" | "drawer" }) {
  const groups = [
    { title: "Main Menu", items: workspace },
    { title: "Work", items: modules },
    { title: "Others", items: platform },
  ].filter((group) => group.items.length > 0);
  return (
    <nav aria-label="Main" className={mode === "drawer" ? "space-y-6 px-3 py-4" : "px-2 py-3"}>
      {groups.map((group, index) => (
        <div key={group.title}>
          {mode !== "drawer" && index > 0 && <div className="mx-auto my-2 h-px w-8 bg-white/15" aria-hidden="true" />}
          <NavGroup title={group.title} items={group.items} pathname={pathname} mode={mode} />
        </div>
      ))}
    </nav>
  );
}

const NAV_KEY = "gw-nav";
const RAIL_WIDTH = 104;
const ICON_RAIL_WIDTH = 72;

function subscribeNav(onStoreChange: () => void) {
  window.addEventListener("gw-nav", onStoreChange);
  return () => window.removeEventListener("gw-nav", onStoreChange);
}

function cookieCollapsed() {
  return document.cookie.split("; ").includes(`${NAV_KEY}=closed`);
}

function writeNavCookie(value: "open" | "closed") {
  document.cookie = `${NAV_KEY}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
  localStorage.setItem(NAV_KEY, value);
  window.dispatchEvent(new Event("gw-nav"));
}

export function Shell({ workspace, modules, platform, header, account, staffName, clients, adds, navCollapsed = false, greet = false, children }: { workspace: NavItem[]; modules: NavItem[]; platform: NavItem[]; header: ReactNode; account: ReactNode; staffName: string; clients: TopLink[]; adds: TopLink[]; navCollapsed?: boolean; greet?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const collapsed = useSyncExternalStore(subscribeNav, cookieCollapsed, () => navCollapsed);
  const [greeting, setGreeting] = useState(greet);
  useEffect(() => {
    if (document.cookie.includes(`${NAV_KEY}=`)) return;
    const stored = localStorage.getItem(NAV_KEY);
    if (stored === "closed" || stored === "open") writeNavCookie(stored);
  }, []);
  useEffect(() => {
    // Remember for this browser session that the greeting was shown; a reload or a later visit shows the title.
    if (greet) document.cookie = `${GREETED_COOKIE}=1; Path=/; SameSite=Lax`;
  }, [greet]);
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      menuButtonRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
    // The greeting belongs to arrival only: the first navigation replaces it with the section title.
    setGreeting(false);
  }

  function toggleNav() {
    writeNavCookie(collapsed ? "open" : "closed");
  }

  const pages = [...workspace, ...modules, ...platform];
  const heading = greeting ? `Hey ${staffName}, glad to have you back` : sectionTitle(pages, pathname);
  const railWidth = collapsed ? ICON_RAIL_WIDTH : RAIL_WIDTH;

  return (
    <BackSlotProvider>
    <div className="flex h-dvh flex-col overflow-hidden bg-back lg:grid lg:grid-rows-[minmax(0,1fr)] lg:transition-[grid-template-columns] lg:duration-300 lg:ease-out" style={{ gridTemplateColumns: `${railWidth}px minmax(0,1fr)` }}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:rounded-md focus:text-ink">Skip to main content</a>
      <aside className="on-back hidden h-full min-h-0 min-w-0 overflow-hidden text-white lg:flex lg:flex-col" aria-label="Main navigation">
        <div className="flex justify-center px-2 pt-4 pb-1">
          <Image src="/brandmark.svg" alt="Genie Works" width={36} height={36} unoptimized className="shrink-0 rounded-xl bg-white p-1" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgba(255,255,255,0.2)_transparent] [scrollbar-width:thin]">
          <Navigation workspace={workspace} modules={modules} platform={platform} pathname={pathname} mode={collapsed ? "icons" : "rail"} />
        </div>
        <div className="group/rail border-t border-white/10 px-2 py-3" data-collapsed="true">{account}</div>
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-ink/50" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside ref={menuRef} className="on-back absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col rounded-r-[28px] bg-back text-white shadow-pop" aria-label="Main menu">
            <div className="flex items-center gap-2 px-5 pt-5 pb-1">
              <Image src="/brandmark.svg" alt="" width={30} height={30} unoptimized className="shrink-0 rounded-lg bg-white p-0.5" />
              <span className="font-semibold">Genie Works</span>
              <button className="ml-auto inline-flex size-11 items-center justify-center rounded-xl text-white/80 hover:bg-white/10" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Navigation workspace={workspace} modules={modules} platform={platform} pathname={pathname} mode="drawer" />
            </div>
            <div className="group/rail border-t border-white/10 px-4 py-4" data-collapsed="false">{account}</div>
          </aside>
        </div>
      )}
      {/* D78: the frame is locked to the viewport height; only the content sheet scrolls. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="on-back z-30 flex w-full shrink-0 min-w-0 flex-wrap items-start gap-2 lg:items-center bg-back px-3 py-3 text-white md:min-h-20 lg:flex-nowrap lg:gap-3 lg:pr-8 lg:pl-6">
          <button ref={menuButtonRef} type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-white/10 lg:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <TopBar heading={heading} greeting={greeting} pages={pages} clients={clients} adds={adds} environment={header} />
        </header>
        {/* The raised content sheet: rounded and lighter, on the back layer. */}
        <main id="main" className="sheet min-h-0 w-full min-w-0 max-w-none flex-1 overflow-y-auto overscroll-contain rounded-t-[24px] px-4 pt-6 pb-6 shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.35)] lg:mr-4 lg:mb-4 lg:w-auto lg:rounded-[28px] lg:px-8 lg:pt-8 lg:pb-8">
          <BackButton />
          {children}
        </main>
      </div>
      <button
        type="button"
        className="on-back fixed top-[1.6rem] z-40 hidden size-7 -translate-x-1/2 items-center justify-center rounded-full border border-white/20 bg-back-raised text-white/80 shadow-sm transition-[left] duration-300 ease-out hover:text-white lg:inline-flex"
        style={{ left: railWidth }}
        aria-pressed={!collapsed}
        aria-label={collapsed ? "Show menu labels" : "Hide menu labels"}
        onClick={toggleNav}
      >
        {collapsed ? <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" /> : <ChevronLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />}
      </button>
    </div>
    </BackSlotProvider>
  );
}
