import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Button, buttonClass } from "./Button";

/** GET form so filters live in the URL and can be shared or bookmarked. */
export function FilterBar({ children, action, clearHref, formKey }: { children: ReactNode; action?: string; clearHref?: string; formKey?: string }) {
  return (
    <form key={formKey} method="get" action={action} className="card mb-5 flex flex-wrap items-end gap-3 p-4">
      {children}
      <Button type="submit" variant="secondary" size="sm">Apply</Button>
      {clearHref && <Link href={clearHref} className={buttonClass("ghost", "sm")}>Clear filters</Link>}
    </form>
  );
}

export function FilterSelect({ name, label, value, options, allLabel = "All" }: { name: string; label: string; value?: string; options: Array<{ value: string; label: string }>; allLabel?: string }) {
  return (
    <label className="flex max-w-full flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <span className="relative inline-flex max-w-full">
        <select name={name} defaultValue={value ?? ""} className="min-h-10 w-full min-w-40 max-w-full appearance-none rounded-full border border-line bg-surface py-2 pl-4 pr-11 text-sm text-ink">
          <option value="">{allLabel}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
      </span>
    </label>
  );
}

export function FilterInput({ name, label, value, type = "text", placeholder, className = "" }: { name: string; label: string; value?: string; type?: string; placeholder?: string; className?: string }) {
  return (
    <label className="text-xs font-medium text-muted flex flex-col gap-1">
      {label}
      <input name={name} type={type} defaultValue={value ?? ""} placeholder={placeholder} className={`min-h-9 min-w-36 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink ${className}`} />
    </label>
  );
}
