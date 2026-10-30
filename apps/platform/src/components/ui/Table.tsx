import type { ReactNode } from "react";

export function Table({ children, caption, className = "" }: { children: ReactNode; caption?: string; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`} tabIndex={0} aria-label={caption}>
      <table className="w-full text-sm border-collapse">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({ children, align = "left", className = "" }: { children?: ReactNode; align?: "left" | "right"; className?: string }) {
  return <th scope="col" className={`text-xs font-semibold uppercase tracking-[0.12em] text-muted px-5 py-3 border-b border-line/80 text-${align} ${className}`}>{children}</th>;
}

export function Td({ children, align = "left", className = "" }: { children?: ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-5 py-3.5 border-b border-line/70 align-top text-${align} ${align === "right" ? "num" : ""} ${className}`}>{children}</td>;
}
