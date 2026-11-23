import Link from "next/link";
import type { ReactNode } from "react";
import { BackSlot } from "@/components/shell/BackButton";

export function innerNavItemClass(active: boolean) {
  // Every item is the same fixed height on one line (D80); a label too long for the menu ends in an ellipsis.
  return `flex h-11 w-full min-w-0 items-center whitespace-nowrap rounded-2xl px-3 text-left text-sm font-medium transition-colors ${active ? "bg-brand-pale text-ink shadow-[inset_0_0_0_1px_var(--color-brand-pale-strong)]" : "text-ink-soft hover:bg-brand-pale/60 hover:text-ink"}`;
}

/**
 * A section menu beside the page. On desktop it is one fixed-height panel in the same place on every page (D80): the
 * sticky offset cancels the sheet's 2rem top padding (sticky positions are measured inside it), so the panel never
 * shifts down on long pages, and its height is the visible sheet minus its 0.75rem margins.
 */
export function InnerNavFrame({ label, nav, children }: { label: string; nav: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-4 -mt-6 -mb-6 flex flex-col lg:-mx-8 lg:-mt-8 lg:-mb-8 lg:min-h-[calc(100dvh-6rem)] lg:flex-row">
      <nav aria-label={label} className="max-h-[40vh] shrink-0 overflow-y-auto border-b border-white/70 bg-white/45 px-3 py-4 lg:sticky lg:top-[-1.25rem] lg:m-3 lg:mr-0 lg:h-[calc(100dvh-7.5rem)] lg:max-h-none lg:w-60 lg:self-start lg:overflow-y-auto lg:rounded-[22px] lg:border lg:border-white/80 lg:bg-white/60">
        <BackSlot />
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
      <Link href={href} aria-current={current ? "page" : undefined} className={innerNavItemClass(current)} title={typeof children === "string" ? children : undefined}><span className="truncate">{children}</span></Link>
    </li>
  );
}

export function InnerNavAnchor({ href, current = false, onClick, children }: { href: string; current?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <li>
      <a href={href} aria-current={current ? "page" : undefined} className={innerNavItemClass(current)} onClick={onClick} title={typeof children === "string" ? children : undefined}><span className="truncate">{children}</span></a>
    </li>
  );
}
