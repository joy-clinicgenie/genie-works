import type { ReactNode } from "react";
import type { Tone } from "./Badge";

const tones: Record<Tone, string> = {
  good: "bg-good-bg border-good/30 text-good",
  warn: "bg-warn-bg border-warn/30 text-warn",
  bad: "bg-bad-bg border-bad/30 text-bad",
  info: "bg-info-bg border-action/20 text-ink",
  neutral: "bg-neutral-bg border-line text-ink",
};

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: ReactNode; children: ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`rounded-2xl px-4 py-3 text-sm ${tones[tone]}`}>
      {title && <div className="font-semibold">{title}</div>}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card p-8 text-center">
      <h3 className="font-semibold">{title}</h3>
      {children && <p className="text-sm text-muted mt-1 max-w-md mx-auto">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
