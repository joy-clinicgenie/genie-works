import type { ChangeEvent, ReactNode } from "react";
import Link from "next/link";
import { Button, buttonClass } from "./Button";
import { PillSelect } from "./PillSelect";

/** GET form so filters live in the URL and can be shared or bookmarked. */
export function FilterBar({ children, action, clearHref, formKey }: { children: ReactNode; action?: string; clearHref?: string; formKey?: string }) {
  return (
    <form key={formKey} method="get" action={action} className="card mb-5 flex max-w-full flex-wrap items-end gap-3 p-4">
      {children}
      <Button type="submit" variant="secondary" size="sm">Apply</Button>
      {clearHref && <Link href={clearHref} className={buttonClass("ghost", "sm")}>Clear filters</Link>}
    </form>
  );
}

export function FilterSelect({ name, label, value, options, allLabel = "All", onChange }: { name: string; label: string; value?: string; options: Array<{ value: string; label: string }>; allLabel?: string; onChange?: (event: ChangeEvent<HTMLSelectElement>) => void }) {
  return (
    <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <PillSelect name={name} defaultValue={value ?? ""} onChange={onChange} className="w-full min-w-0 max-w-full sm:min-w-40">
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </PillSelect>
    </label>
  );
}

export function FilterInput({ name, label, value, type = "text", placeholder, className = "" }: { name: string; label: string; value?: string; type?: string; placeholder?: string; className?: string }) {
  return (
    <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <input name={name} type={type} defaultValue={value ?? ""} placeholder={placeholder} className={`min-h-10 w-full min-w-0 max-w-full rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink sm:min-w-36 ${className}`} />
    </label>
  );
}
