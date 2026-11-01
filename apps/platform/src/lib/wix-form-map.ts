const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WixSubmissionRecord {
  id: string;
  formId: string;
  namespace?: string;
  createdDate: string;
  answers: Record<string, unknown>;
}

export interface WixMappedAnswers {
  name: string;
  email: string | null;
  phone: string | null;
  reason: string;
  message: string | null;
}

export function canonicalUuid(value: string): string | null {
  return UUID.test(value) ? value.toLowerCase() : null;
}

export function wixEnquiryReference(id: string): string {
  return `WIX-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** Inclusive Singapore dates become an exclusive end at the next midnight. */
export function wixCreatedRange(from: string, nextDay: string): { start: string; end: string } {
  return { start: `${from}T00:00:00.000+08:00`, end: `${nextDay}T00:00:00.000+08:00` };
}

export function labelsByTarget(schema: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  walkLabels(schema, labels, undefined);
  return labels;
}

function walkLabels(node: unknown, labels: Map<string, string>, target: string | undefined): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkLabels(item, labels, target);
    return;
  }
  const record = node as Record<string, unknown>;
  const next = typeof record.target === "string" ? record.target : target;
  const label = ["label", "title", "displayName"]
    .map((key) => record[key])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (next && label && !labels.has(next)) labels.set(next, label.trim());
  for (const value of Object.values(record)) walkLabels(value, labels, next);
}

export function parseWixSubmissionList(body: unknown): { submissions: WixSubmissionRecord[]; next: string | null } {
  if (!body || typeof body !== "object") return { submissions: [], next: null };
  const record = body as Record<string, unknown>;
  const submissions = Array.isArray(record.submissions) ? record.submissions.flatMap((item) => {
    const parsed = parseWixSubmission(item);
    return parsed ? [parsed] : [];
  }) : [];
  return { submissions, next: nextCursor(record.metadata ?? record.pagingMetadata) };
}

export function parseWixSubmission(body: unknown): WixSubmissionRecord | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const source = record.submission && typeof record.submission === "object" ? record.submission as Record<string, unknown> : record;
  const id = typeof source.id === "string" ? canonicalUuid(source.id) : null;
  const formId = typeof source.formId === "string" ? canonicalUuid(source.formId) : null;
  const createdDate = typeof source.createdDate === "string" ? source.createdDate : null;
  if (!id || !formId || !createdDate) return null;
  const answers = source.submissions && typeof source.submissions === "object" && !Array.isArray(source.submissions)
    ? source.submissions as Record<string, unknown>
    : {};
  return {
    id,
    formId,
    namespace: typeof source.namespace === "string" ? source.namespace : undefined,
    createdDate,
    answers,
  };
}

function nextCursor(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const record = meta as Record<string, unknown>;
  if (record.hasNext === false) return null;
  const cursors = record.cursors;
  if (!cursors || typeof cursors !== "object") return null;
  const next = (cursors as Record<string, unknown>).next;
  return typeof next === "string" && next ? next : null;
}

/**
 * Maps a Wix answer object onto the enquiry fields.
 * Wix submission status is ignored. It is not follow-up.
 */
export function mapWixAnswers(answers: Record<string, unknown>, labels?: Map<string, string>): WixMappedAnswers {
  const first: string[] = [];
  const last: string[] = [];
  let email: string | null = null;
  let phone: string | null = null;
  let reason = "";
  const message: string[] = [];
  for (const [target, raw] of Object.entries(answers)) {
    const text = answerText(raw);
    if (!text) continue;
    const kind = fieldKind(target);
    if (kind === "first") first.push(text);
    else if (kind === "last") last.push(text);
    else if (kind === "email" && !email) email = text;
    else if (kind === "phone" && !phone) phone = text;
    else if (kind === "choice" && !reason) reason = text;
    else if (kind !== "ignore") message.push(line(target, text, labels));
  }
  const name = [...first, ...last].join(" ").replace(/\s+/g, " ").trim();
  return {
    name: name || "Not recorded",
    email,
    phone,
    reason,
    message: message.length ? message.join("\n\n") : null,
  };
}

function line(target: string, text: string, labels?: Map<string, string>): string {
  const label = labels?.get(target);
  return label ? `${label}\n${text}` : text;
}

function fieldKind(target: string): "first" | "last" | "email" | "phone" | "choice" | "text" | "ignore" {
  const key = target.toLowerCase();
  if (key.startsWith("first_name") || key.startsWith("firstname") || key.startsWith("first-name")) return "first";
  if (key.startsWith("last_name") || key.startsWith("lastname") || key.startsWith("last-name")) return "last";
  if (key.startsWith("email")) return "email";
  if (key.startsWith("phone") || key.startsWith("mobile") || key.includes("phone")) return "phone";
  if (key.startsWith("dropdown") || key.startsWith("radio") || key.startsWith("checkbox") || key.startsWith("select")) return "choice";
  if (key.startsWith("submit") || key === "button") return "ignore";
  return "text";
}

function answerText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((item) => answerText(item)).filter((item): item is string => Boolean(item));
    return parts.length ? parts.join(", ") : null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "text", "label", "selectedOption", "choice"]) {
      const text = answerText(record[key]);
      if (text) return text;
    }
    for (const key of ["selectedOptions", "values", "choices"]) {
      const text = answerText(record[key]);
      if (text) return text;
    }
  }
  return null;
}
