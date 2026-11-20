import type { FindingType, RedirectEvaluation } from "@clinic-genie/db";

/* Plain words for SEO-04 screens (D62). Client-safe: no server imports. */

const FETCH_REASONS: Record<string, string> = {
  timeout: "did not respond in time",
  network: "could not be reached",
  dns_failed: "address could not be found",
  refused_scheme: "is not HTTPS, so it was not read",
  refused_host: "is not on this website, so it was not read",
  refused_address: "resolves to a private network, so it was not read",
  bad_redirect: "sent an unusable redirect",
  too_many_redirects: "redirected too many times",
  too_large: "is larger than the 5 MB read limit",
  compressed: "is compressed (.gz) and was not read",
  nested_index: "is another sitemap index, which this check does not open",
  limit: "is over the limit for one check",
  time_budget: "was not reached within the time limit",
  missing_url: "has no public address",
  not_sitemap: "is not a sitemap file",
  invalid_xml: "is not complete XML",
  missing_loc: "has an entry without a <loc>",
  relative_loc: "lists a URL that is not absolute",
  other_host: "lists a URL on another host",
  too_many_entries: "lists more than 50,000 entries",
  children_unread: "has files that were not read",
  check_error: "could not be checked because the check stopped unexpectedly",
};

/** "The file …" / "The page …" followed by this reason. */
export function fetchReason(code: string | null): string {
  if (!code) return "";
  if (/^http_\d{3}$/.test(code)) return `answered with HTTP status ${code.slice(5)}`;
  return FETCH_REASONS[code] ?? "could not be read";
}

export function findingLabel(type: FindingType): string {
  return { http_error: "Page returns an error", missing_title: "Missing title", missing_description: "Missing meta description" }[type];
}

const REDIRECT_FAILURES: Record<NonNullable<RedirectEvaluation["failure"]>, string> = {
  missing_redirect: "No redirect: the old URL answered directly.",
  loop: "Redirect loop: this hop points back to an earlier URL.",
  wrong_destination: "Wrong destination: this hop sends visitors to a different page.",
  left_site: "Leaves the website: this hop points to another host, which is not checked.",
  too_many_hops: "Too many redirects: the check stopped at this hop.",
  final_error: "The destination answers with an error.",
  unreachable: "This URL could not be reached.",
  bad_location: "This redirect has no usable Location.",
};

export function redirectFailureText(failure: RedirectEvaluation["failure"]): string {
  return failure ? REDIRECT_FAILURES[failure] : "Passed.";
}
