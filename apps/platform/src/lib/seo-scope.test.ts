import { describe, expect, it } from "vitest";
import {
  acceptScopedResult,
  checkFollowUp,
  connectionDisplay,
  savedWebsiteId,
  scopeView,
  searchConsoleUrl,
  websiteChoiceLabel,
} from "@/lib/seo-scope";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("SEO website scope (SEO-01.1)", () => {
  it("labels each choice with organisation, website and environment", () => {
    expect(websiteChoiceLabel({ clientName: "CG-901 Fixture Clinic", name: "Main site", environment: "staging" })).toBe("CG-901 Fixture Clinic · Main site · Preview");
    expect(websiteChoiceLabel({ clientName: "CG-901 Fixture Clinic", name: "Main site", environment: "production" })).toBe("CG-901 Fixture Clinic · Main site · Production");
  });

  it("hides website A while a switch to B is loading, including a late A response", () => {
    expect(scopeView({ currentKey: A, requestedKey: null, pending: false })).toBe("content");
    // The staff member opens B before A has finished: A's content is replaced by a loading state.
    expect(scopeView({ currentKey: A, requestedKey: B, pending: true })).toBe("loading");
    // B arrives: only B is shown.
    expect(scopeView({ currentKey: B, requestedKey: B, pending: true })).toBe("content");
    expect(scopeView({ currentKey: B, requestedKey: B, pending: false })).toBe("content");
    // From no selection, the first website loads behind the same state.
    expect(scopeView({ currentKey: "", requestedKey: A, pending: true })).toBe("loading");
  });

  it("drops a check result that belongs to another website or connection", () => {
    expect(acceptScopedResult({ websiteId: B, connectionId: A }, { websiteId: B, connectionId: A })).toBe(true);
    expect(acceptScopedResult({ websiteId: B, connectionId: A }, { websiteId: A, connectionId: A })).toBe(false);
    expect(acceptScopedResult({ websiteId: B, connectionId: A }, { websiteId: B, connectionId: B })).toBe(false);
  });

  it("accepts only a well-formed remembered website id", () => {
    expect(savedWebsiteId(A.toUpperCase())).toBe(A);
    expect(savedWebsiteId("not-a-website")).toBeUndefined();
    expect(savedWebsiteId("")).toBeUndefined();
    expect(savedWebsiteId(undefined)).toBeUndefined();
  });
});

describe("SEO connection status words (SEO-08.1)", () => {
  const verifiedAt = new Date("2026-11-19T00:00:00Z");
  const later = new Date("2026-11-20T00:00:00Z");

  it("uses Connected only while access is verified", () => {
    expect(connectionDisplay({ state: "connected", verifiedAt, lastCheck: null }).label).toBe("Connected");
    expect(connectionDisplay({ state: "connected", verifiedAt, lastCheck: { at: later, outcome: "verified" } }).label).toBe("Connected");
    expect(connectionDisplay({ state: "connected", verifiedAt, lastCheck: { at: later, outcome: "ownership_required" } })).toMatchObject({ label: "Ownership verification required", tone: "warn" });
    expect(connectionDisplay({ state: "connected", verifiedAt, lastCheck: { at: later, outcome: "no_property_access" } }).label).toBe("Access not confirmed");
    // A provider outage does not take the status away.
    expect(connectionDisplay({ state: "connected", verifiedAt, lastCheck: { at: later, outcome: "provider_unavailable" } }).label).toBe("Connected");
    // An older failed check is superseded by a later verification.
    expect(connectionDisplay({ state: "connected", verifiedAt: later, lastCheck: { at: verifiedAt, outcome: "no_property_access" } }).label).toBe("Connected");
  });

  it("names every other state in words", () => {
    expect(connectionDisplay({ state: "reconnect_required", verifiedAt, lastCheck: null }).label).toBe("Reconnect required");
    expect(connectionDisplay({ state: "disconnected", verifiedAt, lastCheck: null }).label).toBe("Disconnected");
    expect(connectionDisplay({ state: "not_connected", verifiedAt: null, lastCheck: null }).label).toBe("Not connected");
    expect(connectionDisplay({ state: "pending", verifiedAt: null, lastCheck: null }).label).toBe("Not verified");
    expect(connectionDisplay({ state: "credential_issued", verifiedAt: null, lastCheck: null }).label).toBe("Credential issued, not verified");
  });

  it("offers Retry, Reconnect or Search Console by outcome", () => {
    expect(checkFollowUp("provider_unavailable", "ga4")).toBe("retry");
    expect(checkFollowUp("rate_limited", "gsc")).toBe("retry");
    expect(checkFollowUp("reconnect_required", "ga4")).toBe("reconnect");
    expect(checkFollowUp("ownership_required", "gsc")).toBe("search_console");
    expect(checkFollowUp("no_property_access", "gsc")).toBe("search_console");
    expect(checkFollowUp("no_property_access", "ga4")).toBeNull();
    expect(checkFollowUp("verified", "gsc")).toBeNull();
    expect(searchConsoleUrl("sc-domain:fixture.example.invalid")).toBe("https://search.google.com/search-console?resource_id=sc-domain%3Afixture.example.invalid");
  });
});
