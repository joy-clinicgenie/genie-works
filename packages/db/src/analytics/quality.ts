import type { PublishedReport } from "./read";

/**
 * Report quality (Phase 2.3A). Turns what is stored about a report into a short list of plain statements.
 *
 * The reading layer could already say a figure was available or unavailable. It could not say WHY a figure is
 * missing or limited, so people could not tell these apart:
 *
 *   complete        everything expected is here
 *   partial         part of the period is missing, or the provider limited the report (sampling, thresholding)
 *   stale           the last successful sync is old, so the figures may be out of date
 *   truncated       a list stopped at the limit the system reads; more rows exist
 *   withheld        rows were left out because they carried personal identifiers or access tokens
 *   provider_error  the provider could not be reached, or access needs to be reconnected
 *   no_data         the provider answered and has nothing for this period
 *   genuine_zero    the site was measured and the count is 0
 *
 * A figure with no explanation here is simply "not synced yet", which the pages already say.
 * Messages are built from these states and numbers only. They never contain provider text or any withheld value.
 */

export type QualityState = "complete" | "partial" | "stale" | "truncated" | "withheld" | "provider_error" | "no_data" | "genuine_zero";

export interface QualityFinding {
  state: QualityState;
  /** `attention` for something that changes how far to trust the figure; `info` for an explanation. */
  severity: "info" | "attention";
  /** What it is about: "Landing pages", "Sessions". */
  subject: string;
  message: string;
}

/** Hours without a successful sync before figures are called out of date. The worker refreshes daily. */
export const STALE_AFTER_HOURS = 48;

export interface SyncReading {
  /** `connected`, `reconnect_required`, or another connection status. */
  status: string | null;
  lastSuccessAt: Date | null;
  /** Safe code of the latest failure, never provider text. */
  safeError: string | null;
}

export interface QualityInput {
  subject: string;
  /** The published report for the period, or null when none is stored. */
  report: PublishedReport | null;
  now: Date;
  /** Daily coverage of the period: days recorded and days expected. */
  coverage?: { covered: number; expected: number };
  /** The headline figure for the subject, to tell a real zero from a missing value. */
  figure?: { value: number | null; state: "available" | "unavailable"; noun: string };
  sync?: SyncReading | null;
  /** The provider's name for messages: "Google Analytics", "Search Console", "Wix". */
  source: string;
}

const ERROR_TEXT: Record<string, string> = {
  rate_limited: "was limiting requests",
  provider_unavailable: "could not be reached",
  invalid_response: "sent an answer that could not be used",
  provider_rejected: "rejected the request",
  page_failed: "stopped part-way through a report",
  lease_expired: "did not finish in time",
  unsupported: "does not offer this report",
  not_configured: "is not set up on the server",
};

const n = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const count = (value: number) => value.toLocaleString("en-US");
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

export function assessReport(input: QualityInput): QualityFinding[] {
  const out: QualityFinding[] = [];
  const add = (state: QualityState, severity: QualityFinding["severity"], message: string) => out.push({ state, severity, subject: input.subject, message });
  const { report, sync, source } = input;

  if (sync?.status === "reconnect_required") {
    add("provider_error", "attention", `${source} access needs to be reconnected. Figures shown are the last ones stored.`);
  } else if (sync?.safeError) {
    const old = !sync.lastSuccessAt || input.now.getTime() - sync.lastSuccessAt.getTime() > 24 * 3_600_000;
    if (old) add("provider_error", "attention", `The last sync did not complete: ${source} ${ERROR_TEXT[sync.safeError] ?? "returned an error"}. Figures shown are the last ones stored.`);
  }

  if (sync && sync.status !== "reconnect_required" && sync.lastSuccessAt) {
    const hours = (input.now.getTime() - sync.lastSuccessAt.getTime()) / 3_600_000;
    if (hours > STALE_AFTER_HOURS) add("stale", "attention", `The last successful sync was ${Math.floor(hours / 24)} days ago. Figures may be out of date.`);
  }

  if (report?.completeness === "empty") {
    add("no_data", "info", `${source} returned no data for this period. That is a recorded absence, not an error.`);
  }

  const quality = asRecord(report?.quality);
  if (input.coverage && input.coverage.covered < input.coverage.expected) {
    add("partial", "attention", `${input.coverage.covered} of ${input.coverage.expected} days are recorded. Totals cover only those days.`);
  } else if (report?.completeness === "partial") {
    add("partial", "attention", "This report covers only part of the period.");
  }
  const sampled = n(quality.sampledShare);
  if (sampled !== null && sampled < 1) add("partial", "attention", `${source} sampled this report: about ${Math.round(sampled * 100)}% of events were used.`);
  if (quality.subjectToThresholding === true) add("partial", "attention", `${source} withheld small groups of users from this report (thresholding), so some figures are lower than the true count.`);
  if (quality.otherRowRolledUp === true) add("partial", "info", `${source} grouped the smallest rows into one "(other)" row.`);
  const mismatch = asRecord(quality.timezoneMismatch);
  if (typeof mismatch.property === "string") add("partial", "attention", `${source} reports days in its own time zone, which differs from the one set for this website. Days may not line up.`);

  if (quality.truncated === true) add("truncated", "attention", "This list stopped at the number of rows the system reads. More rows exist and are not shown.");

  const withheld = asRecord(quality.withheldByPrivacyFilter);
  const rows = n(withheld.rows);
  if (rows !== null && rows > 0) {
    const measure = n(withheld.clicks) !== null ? `${count(n(withheld.clicks)!)} clicks` : n(withheld.sessions) !== null ? `${count(n(withheld.sessions)!)} sessions` : null;
    add("withheld", "info", `${count(rows)} ${rows === 1 ? "row was" : "rows were"} left out${measure ? ` (${measure})` : ""} because ${rows === 1 ? "it carried" : "they carried"} personal identifiers or access tokens. Lists exclude them; totals do not.`);
  }
  const stripped = asRecord(quality.queryStringsStripped);
  if (n(stripped.withPersonalData) !== null && n(stripped.withPersonalData)! > 0) {
    add("withheld", "info", `${count(n(stripped.withPersonalData)!)} page ${n(stripped.withPersonalData) === 1 ? "address" : "addresses"} had personal details after the "?" removed. The page is shown without them.`);
  }

  if (input.figure) {
    if (input.figure.state === "available" && input.figure.value === 0) {
      add("genuine_zero", "info", `${source} measured this period and counted 0 ${input.figure.noun}. This is a recorded zero, not missing data.`);
    }
  }

  if (out.length === 0 && report) add("complete", "info", "Complete for this period.");
  return out;
}

// ---------------------------------------------------------------------------------------------
// Presentation: concise, grouped by state, with a word for each so colour is never the only signal.

export interface QualityNote {
  state: QualityState;
  severity: "info" | "attention";
  /** The word shown first: "Partial", "Out of date", ... */
  label: string;
  text: string;
}

const LABEL: Record<QualityState, string> = {
  complete: "Complete",
  partial: "Partial",
  stale: "Out of date",
  truncated: "Truncated",
  withheld: "Rows left out",
  provider_error: "Provider problem",
  no_data: "No data",
  genuine_zero: "Recorded zero",
};

const ORDER: QualityState[] = ["provider_error", "stale", "partial", "truncated", "withheld", "no_data", "genuine_zero", "complete"];

/** One note per state and message, listing the subjects it applies to. `complete` is never shown on its own. */
export function summariseQuality(findings: QualityFinding[]): QualityNote[] {
  const grouped = new Map<string, { finding: QualityFinding; subjects: string[] }>();
  for (const finding of findings) {
    if (finding.state === "complete") continue;
    const key = `${finding.state}|${finding.message}`;
    const entry = grouped.get(key) ?? { finding, subjects: [] };
    if (!entry.subjects.includes(finding.subject)) entry.subjects.push(finding.subject);
    grouped.set(key, entry);
  }
  return [...grouped.values()]
    .sort((a, b) => ORDER.indexOf(a.finding.state) - ORDER.indexOf(b.finding.state))
    .map(({ finding, subjects }) => ({
      state: finding.state,
      severity: finding.severity,
      label: LABEL[finding.state],
      text: subjects.length > 0 ? `${subjects.join(", ")}: ${finding.message}` : finding.message,
    }));
}
