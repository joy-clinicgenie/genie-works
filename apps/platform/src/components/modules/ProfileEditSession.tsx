"use client";

import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { Button } from "@/components/ui/Button";

/**
 * One Save for a client's Edit profile (D83). Forms marked `data-edit-form` become "changed" as soon as someone types
 * in them, and their own save buttons are hidden. Forms marked `data-staged` (removals, deactivation) only mark the
 * item on click; the button turns into Undo. Nothing is sent until **Save changes**, which saves every changed form
 * in page order, then applies the staged actions; Discard reloads the saved values. Each form keeps its own server
 * action, permission check and error message, so a failed form stays marked and shows why.
 */
export function ProfileEditSession({ children }: { children: ReactNode }) {
  const dirty = useRef(new Set<HTMLFormElement>());
  const staged = useRef(new Set<HTMLFormElement>());
  const allowSubmit = useRef(false);
  const [counts, setCounts] = useState({ edits: 0, staged: 0 });
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error" | "invalid">("idle");
  const pending = counts.edits + counts.staged;

  const sync = () => {
    for (const form of [...dirty.current]) if (!form.isConnected) dirty.current.delete(form);
    for (const form of [...staged.current]) if (!form.isConnected) staged.current.delete(form);
    setCounts({ edits: dirty.current.size, staged: staged.current.size });
  };

  useEffect(() => {
    if (!pending || status === "saving") return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!allowSubmit.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending, status]);

  function markChanged(event: SyntheticEvent) {
    const form = (event.target as Element).closest?.("form[data-edit-form]") as HTMLFormElement | null;
    if (!form || dirty.current.has(form)) return;
    dirty.current.add(form);
    form.setAttribute("data-dirty", "");
    setStatus("idle");
    sync();
  }

  function onClickCapture(event: SyntheticEvent) {
    const button = (event.target as Element).closest?.("button[type=submit]") as HTMLButtonElement | null;
    const form = button?.form;
    if (!form || !form.hasAttribute("data-staged") || allowSubmit.current) return;
    event.preventDefault();
    if (staged.current.has(form)) {
      staged.current.delete(form);
      form.removeAttribute("data-staged-on");
    } else {
      staged.current.add(form);
      form.setAttribute("data-staged-on", "");
    }
    setStatus("idle");
    sync();
  }

  function onSubmitCapture(event: SyntheticEvent) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (allowSubmit.current || submitter?.hasAttribute("data-direct")) return;
    // Enter in a field would save that one form on its own: hold it for the page Save instead.
    event.preventDefault();
    markChanged(event);
  }

  async function settle(form: HTMLFormElement) {
    const started = Date.now();
    await wait(150);
    while (Date.now() - started < 15_000) {
      if (!form.isConnected || !form.querySelector('[aria-busy="true"]')) break;
      await wait(100);
    }
    if (!form.querySelector("[aria-busy]")) await wait(700);
  }

  async function save() {
    const removals = [...staged.current].map((form) => form.getAttribute("data-staged") ?? "");
    if (removals.length && !window.confirm(`Save changes?\n\nThis will also apply:\n${removals.map((item) => `• ${item}`).join("\n")}\n\nRemoved websites, staff and file links keep their history; a removed website can be restored.`)) return;
    setStatus("saving");
    allowSubmit.current = true;
    const order = (forms: Set<HTMLFormElement>) => [...forms].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    // Edits first, then staged actions; deactivating the client goes last because it leaves the page.
    const stagedForms = order(staged.current).sort((a, b) => Number(a.getAttribute("data-staged") === "Deactivate client") - Number(b.getAttribute("data-staged") === "Deactivate client"));
    const invalid = new Set<HTMLFormElement>();
    try {
      for (const form of [...order(dirty.current), ...stagedForms]) {
        if (!form.isConnected) continue;
        // The browser silently refuses to submit a form with an invalid field, so check first and point at it.
        if (!form.checkValidity()) {
          if (!invalid.size) form.reportValidity();
          invalid.add(form);
          continue;
        }
        const submitter = form.querySelector<HTMLButtonElement>("[data-form-submit]") ?? form.querySelector<HTMLButtonElement>("button[type=submit]");
        form.requestSubmit(submitter ?? undefined);
        await settle(form);
      }
    } finally {
      allowSubmit.current = false;
    }
    await wait(400);
    let failed = invalid.size;
    for (const form of [...dirty.current, ...staged.current]) {
      if (invalid.has(form)) continue;
      if (form.isConnected && form.querySelector('[role="alert"]')) {
        failed += 1;
        continue;
      }
      form.removeAttribute("data-dirty");
      form.removeAttribute("data-staged-on");
      dirty.current.delete(form);
      staged.current.delete(form);
    }
    sync();
    setStatus(invalid.size ? "invalid" : failed ? "error" : "saved");
  }

  return (
    <div data-edit-session onInputCapture={markChanged} onChangeCapture={markChanged} onClickCapture={onClickCapture} onSubmitCapture={onSubmitCapture}>
      {children}
      {(pending > 0 || status !== "idle") && (
        <div className="sticky bottom-0 z-20 mt-6 pb-1" data-save-bar>
          <div role="status" aria-live="polite" className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3 shadow-pop">
            <p className="text-sm font-medium">
              {status === "saving" ? "Saving changes…"
                : status === "invalid" ? "Some changes were not saved: a required field is empty or invalid. Fix the highlighted field, then save again."
                : status === "error" ? "Some changes were not saved. Check the messages on the page."
                  : pending ? `Unsaved changes: ${summary(counts)}`
                    : "All changes saved."}
            </p>
            {pending > 0 && (
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" disabled={status === "saving"} onClick={() => { allowSubmit.current = true; window.location.reload(); }}>Discard</Button>
                <Button type="button" size="sm" disabled={status === "saving"} aria-busy={status === "saving"} onClick={save}>{status === "saving" ? "Saving…" : "Save changes"}</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function summary(counts: { edits: number; staged: number }): string {
  const parts = [];
  if (counts.edits) parts.push(`${counts.edits} edited section${counts.edits === 1 ? "" : "s"}`);
  if (counts.staged) parts.push(`${counts.staged} removal${counts.staged === 1 ? "" : "s"} or status change${counts.staged === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
