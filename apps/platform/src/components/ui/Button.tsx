import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base = "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 min-h-11 px-4 text-sm";
const variants: Record<Variant, string> = {
  primary: "bg-action text-white hover:bg-action-hover",
  secondary: "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)] hover:bg-brand-pale",
  ghost: "bg-transparent text-action hover:bg-brand-pale",
  danger: "bg-bad-bg text-bad hover:bg-bad/10",
};
const sizes: Record<Size, string> = { sm: "min-h-9 px-3 text-sm", md: "" };

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = ""): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({ variant = "primary", size = "md", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button {...rest} className={buttonClass(variant, size, className)} />;
}

export function LinkButton({ href, variant = "primary", size = "md", className = "", children, scroll = true }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode; scroll?: boolean }) {
  return (
    <Link href={href} scroll={scroll} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}
