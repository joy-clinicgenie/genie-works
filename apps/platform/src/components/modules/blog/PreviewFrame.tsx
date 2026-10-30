"use client";

import { useState, type ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";

export function PreviewFrame({ children }: { children: ReactNode }) {
  const [mobile, setMobile] = useState(false);
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Preview width">
        <button type="button" aria-pressed={!mobile} className={buttonClass(mobile ? "secondary" : "primary", "sm")} onClick={() => setMobile(false)}>Desktop</button>
        <button type="button" aria-pressed={mobile} className={buttonClass(mobile ? "primary" : "secondary", "sm")} onClick={() => setMobile(true)}>Mobile</button>
      </div>
      <div className={mobile ? "mx-auto max-w-sm overflow-x-hidden rounded-2xl border border-line p-4" : "max-w-3xl"}>
        {children}
      </div>
    </div>
  );
}
