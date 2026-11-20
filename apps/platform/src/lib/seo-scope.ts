import type { ConnectionCheckOutcome, WebsiteConnectionCard } from "@clinic-genie/db";

/**
 * Client-safe SEO scope rules (SEO-01.1, SEO-08.1, D60). No server imports: the selector and connection
 * buttons run in the browser.
 */

/** The last opened SEO website. A request only: the server re-resolves it against readable websites. */
export const SEO_WEBSITE_COOKIE = "gw-seo-website";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWebsiteId(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** A saved cookie value, or undefined when it is missing or malformed. */
export function savedWebsiteId(value: string | undefined | null): string | undefined {
  return isWebsiteId(value) ? value.toLowerCase() : undefined;
}

/**
 * Whether the SEO content area may show the rendered website. While a switch is loading, content from any
 * website other than the latest request is hidden, so a late or previous response never appears.
 */
export function scopeView(input: { currentKey: string; requestedKey: string | null; pending: boolean }): "content" | "loading" {
  return input.pending && input.requestedKey !== null && input.requestedKey !== input.currentKey ? "loading" : "content";
}

/** A result belongs on screen only if it was requested for the website and connection still shown. */
export function acceptScopedResult(current: { websiteId: string; connectionId: string }, result: { websiteId: string; connectionId: string }): boolean {
  return current.websiteId === result.websiteId && current.connectionId === result.connectionId;
}

export function environmentName(environment: "production" | "staging" | "development"): "Production" | "Preview" | "Development" {
  if (environment === "production") return "Production";
  if (environment === "staging") return "Preview";
  return "Development";
}

/** Organisation · Website · Environment, the one label used for every SEO website choice. */
export function websiteChoiceLabel(site: { clientName: string; name: string; environment: "production" | "staging" | "development" }): string {
  return `${site.clientName} · ${site.name} · ${environmentName(site.environment)}`;
}

export type ConnectionTone = "good" | "warn" | "bad" | "neutral" | "info";

export interface ConnectionDisplay {
  label: string;
  tone: ConnectionTone;
  icon: "check" | "alert" | "minus" | "clock";
}

const ACCESS_FAILURES: ReadonlySet<ConnectionCheckOutcome> = new Set(["ownership_required", "no_property_access", "provider_rejected"]);

/**
 * The status shown on a connection card. Connected is used only when access is verified: a later check that
 * Google refused for the property replaces it with Access not confirmed. A provider outage does not.
 */
export function connectionDisplay(card: Pick<WebsiteConnectionCard, "state" | "verifiedAt" | "lastCheck">): ConnectionDisplay {
  switch (card.state) {
    case "not_connected":
      return { label: "Not connected", tone: "neutral", icon: "minus" };
    case "disconnected":
      return { label: "Disconnected", tone: "neutral", icon: "minus" };
    case "reconnect_required":
      return { label: "Reconnect required", tone: "bad", icon: "alert" };
    case "pending":
      return { label: "Not verified", tone: "warn", icon: "clock" };
    case "credential_issued":
      return { label: "Credential issued, not verified", tone: "info", icon: "clock" };
    case "connected": {
      const check = card.lastCheck;
      const newer = check && (!card.verifiedAt || check.at.getTime() > card.verifiedAt.getTime());
      if (check && newer && ACCESS_FAILURES.has(check.outcome)) {
        return { label: check.outcome === "ownership_required" ? "Ownership verification required" : "Access not confirmed", tone: "warn", icon: "alert" };
      }
      return { label: "Connected", tone: "good", icon: "check" };
    }
  }
}

/** Plain words for a check outcome. Never provider error text. */
export function checkOutcomeText(outcome: ConnectionCheckOutcome, provider: string | null): string {
  switch (outcome) {
    case "verified":
      return "Access verified. A check does not fetch reports, so the last successful sync is unchanged.";
    case "ownership_required":
      return "Google lists this property, but ownership is not verified for the connected account. Verify ownership in Search Console, then check again.";
    case "no_property_access":
      return provider === "gsc"
        ? "The connected Google account cannot open this Search Console property. Add the account as a user or verify ownership in Search Console, then check again."
        : "The connected Google account cannot open this analytics property. Ask the property owner to add it, then check again.";
    case "reconnect_required":
      return "The stored authorisation was rejected or is missing. An administrator needs to reconnect.";
    case "not_configured":
      return "A server setting for this provider is missing, so access could not be checked. Reconnecting will not help; an administrator must add the setting.";
    case "rate_limited":
      return "The provider asked us to wait. The status is unchanged. Retry the check later.";
    case "provider_unavailable":
      return "The provider did not respond. The status is unchanged. Retry the check.";
    case "provider_rejected":
      return "The provider rejected the check request. The status is unchanged.";
  }
}

/** Retry suits a temporary failure; Reconnect suits a rejected credential; Search Console handles ownership. */
export function checkFollowUp(outcome: ConnectionCheckOutcome, provider: string | null): "retry" | "reconnect" | "search_console" | null {
  if (outcome === "rate_limited" || outcome === "provider_unavailable") return "retry";
  if (outcome === "reconnect_required") return "reconnect";
  if (outcome === "ownership_required" || (outcome === "no_property_access" && provider === "gsc")) return "search_console";
  return null;
}

/** Search Console opened on the mapped property. */
export function searchConsoleUrl(property: string | null): string {
  if (!property) return "https://search.google.com/search-console";
  return `https://search.google.com/search-console?resource_id=${encodeURIComponent(property)}`;
}
