"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { buttonClass } from "@/components/ui/Button";
import { pageBackTarget, rememberPage } from "@/lib/page-history";

const STORAGE_KEY = "gw-page-stack";

const BackSlotContext = createContext<{
  slot: HTMLElement | null;
  setSlot: (node: HTMLElement | null) => void;
} | null>(null);

export function BackSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlotState] = useState<HTMLElement | null>(null);
  const setSlot = useCallback((node: HTMLElement | null) => {
    setSlotState((current) => (current === node ? current : node));
  }, []);
  const value = useMemo(() => ({ slot, setSlot }), [slot, setSlot]);
  return <BackSlotContext.Provider value={value}>{children}</BackSlotContext.Provider>;
}

/** Marks the section menu that should hold Back when this page has one. */
export function BackSlot() {
  const setSlot = useContext(BackSlotContext)?.setSlot;
  const ref = useCallback((node: HTMLDivElement | null) => setSlot?.(node), [setSlot]);
  return <div ref={ref} className="empty:hidden" />;
}

const stackListeners = new Set<() => void>();
let committedHere: string | null = null;

function subscribeStack(onChange: () => void) {
  stackListeners.add(onChange);
  return () => {
    stackListeners.delete(onChange);
  };
}

function notifyStack() {
  for (const listener of stackListeners) listener();
}

function readStack(): string[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function BackButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const search = searchParams?.toString() ?? "";
  const here = search ? `${pathname}?${search}` : pathname;
  const slot = useContext(BackSlotContext)?.slot ?? null;
  const target = useSyncExternalStore(
    subscribeStack,
    () => (committedHere === here ? pageBackTarget(pathname, readStack()) : null),
    () => null,
  );

  useEffect(() => {
    const stack = rememberPage(readStack(), here);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stack));
    committedHere = here;
    notifyStack();
  }, [here, pathname]);

  if (!target) return null;

  const button = (
    <button
      type="button"
      onClick={() => router.back()}
      className={slot ? "mb-3 flex w-full items-center justify-start gap-1 rounded-xl px-3 min-h-11 text-left text-sm font-medium text-action hover:bg-brand-pale" : `${buttonClass("ghost", "sm")} mb-4`}
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      Back
    </button>
  );

  return slot ? createPortal(button, slot) : button;
}
