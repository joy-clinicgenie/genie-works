import type { InspectionDetail, PageSource, ValueSource } from "@clinic-genie/db";

/* Plain words for SEO-03 screens (D61). Client-safe: no server imports. */

export function valueSourceLabel(source: ValueSource): string {
  if (source === "override") return "Page override";
  if (source === "blog") return "Inherited from the blog article";
  return "Inherited from the website default";
}

export function pageSourceLabel(source: PageSource): string {
  return { home: "Home", mapped: "Mapped page", setting: "Page settings", blog: "Blog article" }[source];
}

export function indexingLabel(value: boolean | null): string {
  if (value === null) return "Website default (not visible to Genie Works)";
  return value ? "Allow indexing" : "Do not index (noindex)";
}

/** Google's verdict in its own Search Console terms. */
export function verdictLabel(verdict: InspectionDetail["verdict"]): string {
  switch (verdict) {
    case "PASS":
      return "Valid";
    case "NEUTRAL":
      return "Excluded";
    case "FAIL":
      return "Error";
    case "PARTIAL":
      return "Partial";
    default:
      return "Unknown";
  }
}

export function verdictTone(verdict: InspectionDetail["verdict"]): "good" | "warn" | "bad" | "neutral" {
  if (verdict === "PASS") return "good";
  if (verdict === "FAIL") return "bad";
  if (verdict === "NEUTRAL" || verdict === "PARTIAL") return "warn";
  return "neutral";
}

const INSPECTION_ERRORS: Record<string, string> = {
  outside_property: "This URL is not inside the mapped Search Console property, so it was not sent to Google.",
  not_connected: "No Search Console property is connected for this website and environment.",
  reconnect_required: "The Search Console connection needs to be reconnected.",
  inspection_forbidden: "Google refused the request for this property. The connected account may lack access or ownership.",
  token_rejected: "The Search Console connection needs to be reconnected.",
  token_unreadable: "The stored Search Console authorisation could not be read. Reconnect it.",
  not_configured: "A server setting for Google is missing, so the URL could not be inspected.",
  rate_limited: "Google asked us to wait. Try the recheck later.",
  provider_unavailable: "Google did not respond. Try the recheck again.",
  timed_out: "Google did not respond in time. Try the recheck again.",
  provider_rejected: "Google rejected the request.",
  missing_url: "This website has no public address recorded, so the page URL cannot be built.",
};

export function inspectionErrorText(code: string | null): string {
  return (code && INSPECTION_ERRORS[code]) || "The inspection did not complete.";
}

/** Failures that Website Connections, not a recheck, can fix. */
export function isConnectionProblem(code: string | null): boolean {
  return code === "outside_property" || code === "not_connected" || code === "reconnect_required" || code === "inspection_forbidden"
    || code === "token_rejected" || code === "token_unreadable" || code === "not_configured";
}

const LIVE_ERRORS: Record<string, string> = {
  refused_scheme: "The website address is not HTTPS, so it was not read.",
  refused_host: "The page is not on the website's own host, so it was not read.",
  refused_address: "The website address resolves to a private network, so it was not read.",
  dns_failed: "The website address could not be found.",
  timeout: "The website did not respond in time.",
  network: "The website could not be reached.",
  bad_redirect: "The website sent an unusable redirect.",
  too_many_redirects: "The website redirected too many times.",
  not_html: "The address did not return an HTML page.",
  missing_url: "This website has no public address recorded.",
};

export function liveErrorText(code: string | null): string {
  if (code && /^http_\d{3}$/.test(code)) return `The page answered with HTTP status ${code.slice(5)}.`;
  return (code && LIVE_ERRORS[code]) || "The page could not be read.";
}
