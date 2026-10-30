"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Menu, PanelLeft, X, LayoutDashboard, ListChecks, Building2, CheckSquare, Inbox, ClipboardList, Search, Megaphone, AlertTriangle, Stethoscope, BarChart3, LineChart, History, Settings, Shield } from "lucide-react";
import { TopBar, type TopLink } from "./TopBar";

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
}

const ICONS = { LayoutDashboard, ListChecks, Building2, CheckSquare, Inbox, ClipboardList, Search, Megaphone, AlertTriangle, Stethoscope, BarChart3, LineChart, History, Settings, Shield };

function ProductName({ mark = 28, subtitle = true }: { mark?: number; subtitle?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <img src="/brandmark.svg" alt="" width={mark} height={mark} className="shrink-0" />
      <span className="min-w-0 leading-tight">
        <span className="block whitespace-nowrap font-semibold text-ink">Genie Works</span>
        {subtitle && <span className="block text-[11px] italic font-normal text-muted">Internal Platform for Genies</span>}
      </span>
    </span>
  );
}

function NavGroup({ title, items, pathname, collapsed }: { title: string; items: NavItem[]; pathname: string; collapsed: boolean }) {
  if (!items.length) return null;
  return (
    <div className={collapsed ? "" : "mb-6"}>
      {collapsed ? <h2 className="sr-only">{title}</h2> : <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{title}</div>}
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = item.href === "/"
            ? pathname === "/"
            : item.href === "/enquiries"
              ? pathname.startsWith("/enquiries") || pathname.startsWith("/forms")
              : pathname.startsWith(item.href) || (item.href === "/my-tasks" && pathname.startsWith("/tasks"));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={collapsed
                  ? `mx-auto grid size-11 place-items-center rounded-xl transition-colors ${active ? "bg-brand-pale text-action" : "text-ink-soft hover:bg-brand-pale/70 hover:text-ink"}`
                  : `flex items-center gap-3 rounded-xl px-3 min-h-11 text-sm font-medium transition-colors ${active ? "bg-brand-pale text-ink" : "text-ink-soft hover:bg-brand-pale/70 hover:text-ink"}`}
              >
                <Icon className={`size-[18px] shrink-0 ${active ? "text-action" : ""}`} aria-hidden="true" />
                <span className={collapsed ? "sr-only" : ""}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Navigation({ workspace, modules, platform, pathname, collapsed }: { workspace: NavItem[]; modules: NavItem[]; platform: NavItem[]; pathname: string; collapsed: boolean }) {
  const groups = [
    { title: "Main Menu", items: workspace },
    { title: "Work", items: modules },
    { title: "Others", items: platform },
  ].filter((group) => group.items.length > 0);
  return (
    <nav aria-label="Main" className={collapsed ? "px-2 py-3" : "px-3 py-4"}>
      {groups.map((group, index) => (
        <div key={group.title}>
          {collapsed && index > 0 && <div className="mx-auto my-2.5 h-px w-6 bg-line" aria-hidden="true" />}
          <NavGroup title={group.title} items={group.items} pathname={pathname} collapsed={collapsed} />
        </div>
      ))}
    </nav>
  );
}

const NAV_KEY = "gw-nav";
const SIDEBAR_WIDTH = 260;
const RAIL_WIDTH = 72;

function subscribeNav(onStoreChange: () => void) {
  window.addEventListener("gw-nav", onStoreChange);
  return () => window.removeEventListener("gw-nav", onStoreChange);
}

function navCollapsed() {
  return localStorage.getItem(NAV_KEY) === "closed";
}

export function Shell({ workspace, modules, platform, header, account, staffName, clients, adds, children }: { workspace: NavItem[]; modules: NavItem[]; platform: NavItem[]; header: ReactNode; account: ReactNode; staffName: string; clients: TopLink[]; adds: TopLink[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeNav, navCollapsed, () => false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  function toggleNav() {
    localStorage.setItem(NAV_KEY, collapsed ? "open" : "closed");
    window.dispatchEvent(new Event("gw-nav"));
  }

  const brand = (mark: number, onClose?: () => void, rail = false) => (
    <div className={`flex items-center ${rail && collapsed ? "justify-center px-2 pt-4 pb-1" : "gap-2 px-5 pt-5 pb-1"}`}>
      {rail && collapsed ? <img src="/brandmark.svg" alt="Genie Works" width={mark} height={mark} className="shrink-0" /> : <ProductName mark={mark} />}
      {rail && !collapsed && <PanelLeft className="ml-auto size-[18px] shrink-0 text-muted" strokeWidth={1.5} aria-hidden="true" />}
      {onClose && (
        <button className="ml-auto inline-flex size-11 items-center justify-center rounded-xl text-ink-soft hover:bg-brand-pale" aria-label="Close menu" onClick={onClose}>
          <X className="size-5" aria-hidden="true" />
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:transition-[grid-template-columns] lg:duration-300 lg:ease-out" style={{ gridTemplateColumns: collapsed ? `${RAIL_WIDTH}px minmax(0,1fr)` : `${SIDEBAR_WIDTH}px minmax(0,1fr)` }}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:rounded-md">Skip to main content</a>
      <aside className="sticky top-0 hidden h-dvh min-w-0 overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col">
        <div className="flex h-full w-full shrink-0 flex-col">
          {brand(32, undefined, true)}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Navigation workspace={workspace} modules={modules} platform={platform} pathname={pathname} collapsed={collapsed} />
          </div>
          <div className={`group/rail border-t border-line ${collapsed ? "px-2 py-3" : "px-4 py-4"}`} data-collapsed={collapsed ? "true" : "false"}>{account}</div>
        </div>
      </aside>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <button className="absolute inset-0 bg-ink/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-pop" aria-label="Main menu">
            {brand(28, () => setOpen(false))}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Navigation workspace={workspace} modules={modules} platform={platform} pathname={pathname} collapsed={false} />
            </div>
            <div className="border-t border-line px-4 py-4">{account}</div>
          </aside>
        </div>
      )}
      <div className="flex min-h-dvh flex-col min-w-0">
        <header className="sticky top-0 z-30 flex min-h-16 w-full items-center gap-3 border-b border-line-strong bg-surface px-4 py-3 lg:px-8">
          <button className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-brand-pale lg:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <TopBar staffName={staffName} pages={[...workspace, ...modules, ...platform]} clients={clients} adds={adds} />
          <div className="shrink-0 lg:hidden">{header}</div>
        </header>
        <main id="main" className="w-full min-w-0 max-w-none flex-1 px-4 pt-6 pb-6 lg:px-8 lg:pt-8 lg:pb-8">{children}</main>
      </div>
      <button
        type="button"
        className="fixed top-[1.35rem] z-40 hidden size-7 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-sm transition-[left] duration-300 ease-out hover:text-ink lg:inline-flex"
        style={{ left: collapsed ? RAIL_WIDTH : SIDEBAR_WIDTH }}
        aria-pressed={!collapsed}
        aria-label={collapsed ? "Open navigation" : "Close navigation"}
        onClick={toggleNav}
      >
        {collapsed ? <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" /> : <ChevronLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />}
      </button>
    </div>
  );
}
