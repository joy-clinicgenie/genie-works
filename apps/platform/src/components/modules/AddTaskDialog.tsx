"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function AddTaskDialog({ closeHref, children }: { closeHref: string; children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") router.push(closeHref);
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [closeHref, router]);

  return (
    <div className="fixed inset-0 z-50">
      <Link href={closeHref} className="absolute inset-0 bg-ink/40" aria-label="Cancel" />
      <div className="relative z-10 mx-auto mt-8 w-full max-w-lg px-4 pb-8">
        <div role="dialog" aria-modal="true" aria-labelledby="add-task-title" className="max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-2xl bg-surface p-5 shadow-pop">
          <h2 id="add-task-title" className="text-lg font-semibold text-ink">Add task</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
