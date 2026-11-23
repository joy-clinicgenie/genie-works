import { Notice } from "@/components/ui/Notice";
import type { QualityNote } from "@clinic-genie/db";

/**
 * Says, briefly, how far to trust the figures on the page: partial, out of date, truncated, rows left out, a provider
 * problem, no data, or a recorded zero. Each line starts with a word, so the meaning never depends on colour.
 * Shows nothing when there is nothing to say. Nothing here is provider text or a withheld value (Phase 2.3A).
 */
export function QualityNotices({ notes }: { notes: QualityNote[] | undefined }) {
  if (!notes || notes.length === 0) return null;
  const attention = notes.some((note) => note.severity === "attention");
  return (
    <Notice tone={attention ? "warn" : "neutral"} title="Data notes">
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {notes.map((note) => (
          <li key={`${note.state}-${note.text}`}>
            <span className="font-semibold">{note.label}:</span> {note.text}
          </li>
        ))}
      </ul>
    </Notice>
  );
}
