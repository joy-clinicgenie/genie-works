import { PermissionDeniedError } from "@clinic-genie/db";

export type ActionState = { ok: true; message?: string; id?: string } | { ok: false; error: string; field?: string; issues?: { field: string; message: string }[] } | null;

/** Converts domain and permission errors into a form state without leaking internals. */
export function toActionError(err: unknown): ActionState {
  if (err instanceof PermissionDeniedError) return { ok: false, error: err.message };
  const e = err as { name?: string; message?: string; field?: string; code?: string; issues?: { field: string; message: string }[] };
  if (e?.name?.endsWith("RuleError")) return { ok: false, error: e.message ?? "That change is not allowed.", field: e.field, issues: e.issues };
  if (e?.code === "23505") return { ok: false, error: "A record with the same key already exists." };
  if (e?.code === "23514" || e?.code === "23503") return { ok: false, error: "The record failed a database rule. Check the fields and try again." };
  if (e?.code === "42501") return { ok: false, error: "You do not have permission for this action." };
  if (e?.code === "insufficient_privilege" || e?.message?.includes("append-only") || e?.message?.includes("immutable")) return { ok: false, error: "That record is append-only and cannot be changed." };
  console.error("Unhandled action error", { name: e?.name, code: e?.code });
  return { ok: false, error: "Something went wrong. Nothing was saved." };
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function optional(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v ? v : null;
}

export function bool(form: FormData, key: string): boolean {
  const v = form.get(key);
  return v === "on" || v === "true" || v === "1";
}

export function list(form: FormData, key: string): string[] {
  return form.getAll(key).filter((v): v is string => typeof v === "string" && v.length > 0);
}

export function numberOrNull(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
