import Link from "next/link";
import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Detail drawer rendered beside a list. Opening and closing are plain links that change a search
 * parameter without scrolling, so the user keeps their place in the list.
 */
export function Drawer({ title, closeHref, children, eyebrow }: { title: ReactNode; closeHref: string; children: ReactNode; eyebrow?: ReactNode }) {
  return (
    <aside className="card p-5 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto" aria-label={typeof title === "string" ? title : "Details"}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          {eyebrow && <div className="text-xs font-semibold uppercase tracking-wide text-muted">{eyebrow}</div>}
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        </div>
        <Link href={closeHref} scroll={false} className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-brand-pale" aria-label="Close details">
          <X className="size-5" aria-hidden="true" />
        </Link>
      </div>
      {children}
    </aside>
  );
}

export function SplitLayout({ list, detail }: { list: ReactNode; detail?: ReactNode }) {
  return (
    <div className={detail ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] items-start" : ""}>
      <div className="min-w-0">{list}</div>
      {detail}
    </div>
  );
}
