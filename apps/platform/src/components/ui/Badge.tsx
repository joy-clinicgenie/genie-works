import type { ReactNode } from "react";

export type Tone = "good" | "warn" | "bad" | "info" | "neutral";

const tones: Record<Tone, string> = {
  good: "bg-good-bg text-good",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
  info: "bg-info-bg text-info",
  neutral: "bg-neutral-bg text-neutral",
};

/** Status badge. The text always carries the meaning; colour is reinforcement only. */
export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tones[tone]} ${className}`}>{children}</span>;
}

const NAMES: Record<string, string> = {
  medical_claim: "HCSA claim",
  medical_review: "HCSA",
  medical_review_decided: "HCSA decided",
};

export function label(value: string): string {
  return NAMES[value] ?? value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const TASK_STATUS_TONE: Record<string, Tone> = { open: "info", in_progress: "info", waiting: "warn", completed: "good", cancelled: "neutral" };
export const PRIORITY_TONE: Record<string, Tone> = { low: "neutral", medium: "info", high: "warn", critical: "bad" };
export const APPROVAL_TONE: Record<string, Tone> = { draft: "neutral", submitted: "warn", approved: "good", changes_requested: "bad", withdrawn: "neutral" };
export const ISSUE_TONE: Record<string, Tone> = { open: "warn", investigating: "info", resolved_pending_verification: "warn", verified_closed: "good", reopened: "bad" };
export const SEVERITY_TONE: Record<string, Tone> = { low: "neutral", medium: "info", high: "warn", critical: "bad" };
export const CLAIM_TONE: Record<string, Tone> = { draft: "neutral", under_review: "warn", approved: "good", rejected: "bad", withdrawn: "neutral" };
export const CONTENT_TONE: Record<string, Tone> = { planned: "neutral", drafting: "info", in_review: "warn", published: "good", needs_update: "warn", retired: "neutral" };
export const FLAG_TONE: Record<string, Tone> = { none: "neutral", duplicate_target: "warn", cannibalisation: "bad", missing_page: "warn", wrong_intent: "warn", thin_content: "warn", other: "warn" };
