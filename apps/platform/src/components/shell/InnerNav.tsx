import Link from "next/link";
import type { ReactNode } from "react";

export function innerNavItemClass(active: boolean) {
  return `flex w-full items-center rounded-xl px-3 py-2 min-h-11 text-left text-sm font-medium leading-snug transition-colors ${active ? "bg-brand-pale text-ink" : "text-ink-soft hover:bg-brand-pale/70 hover:text-ink"}`;
}

export function InnerNavFrame({ label, nav, children }: { label: string; nav: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-4 -mt-6 -mb-6 flex min-h-[calc(100dvh-4rem)] flex-col lg:-mx-8 lg:-mt-8 lg:-mb-8 lg:flex-row">
      <nav aria-label={label} className="max-h-[40vh] shrink-0 overflow-y-auto border-b border-line bg-surface px-3 py-4 lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:max-h-none lg:w-56 lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-r">
        {nav}
      </nav>
      <div className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</div>
    </div>
  );
}

export function InnerNavGroup({ title, children, label }: { title?: string; children: ReactNode; label?: string }) {
  return (
    <div className="mb-6 last:mb-0">
      {title ? <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{title}</div> : null}
      <ul className="space-y-1" role={label ? "tablist" : undefined} aria-label={label}>{children}</ul>
    </div>
  );
}

export function InnerNavLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <li>
      <Link href={href} aria-current={current ? "page" : undefined} className={innerNavItemClass(current)}>{children}</Link>
    </li>
  );
}

export function InnerNavAnchor({ href, current = false, onClick, children }: { href: string; current?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <li>
      <a href={href} aria-current={current ? "page" : undefined} className={innerNavItemClass(current)} onClick={onClick}>{children}</a>
    </li>
  );
}
