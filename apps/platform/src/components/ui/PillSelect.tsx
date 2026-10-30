import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

export const pillSelectClass =
  "min-h-10 cursor-pointer appearance-none rounded-full border border-line bg-surface py-2 pl-4 pr-10 text-sm font-medium text-ink outline-none focus-visible:border-action focus-visible:shadow-[0_0_0_3px_rgba(19,108,114,0.16)] disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted";

export function PillSelect({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const wide = /(^|\s)w-full(\s|$)/.test(className);
  return (
    <span className={`relative inline-flex max-w-full ${wide ? "w-full" : ""}`}>
      <select {...props} className={`${pillSelectClass} ${className}`}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
    </span>
  );
}
