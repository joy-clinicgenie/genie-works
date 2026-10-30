import { describe, expect, it } from "vitest";
import { assertSafeTarget } from "../src/migrate";
import { assertEnquiryFixtureUrl, assertFixtureFetch, assertLocalWorkerDatabase } from "../src/testing/targets";
import { bearerMatches } from "../src/analytics/crypto";
import { syncIsStale, PROVIDER_FIXTURE_SCENARIOS } from "../src/testing/provider-fixtures";
import { WEBSITE_CAPABILITIES, capabilityCountsAsPassed } from "../src/testing/consumers";

describe("fixture target guards", () => {
  it("rejects a production environment and a database outside the seed marker", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    expect(() => assertSafeTarget("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie")).toThrow(/production/);
    process.env.NODE_ENV = previous;
    expect(() => assertSafeTarget("postgresql://postgres:postgres@127.0.0.1:54339/production")).toThrow(/Refusing/);
  });

  it("rejects the platform database, the sibling port and a remote enquiry target before any reset", () => {
    expect(() => assertEnquiryFixtureUrl("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie")).toThrow(/platform database/);
    expect(() => assertEnquiryFixtureUrl("postgresql://postgres:postgres@127.0.0.1:54329/clinic_genie_enquiry_test")).toThrow(/54329/);
    expect(() => assertEnquiryFixtureUrl("postgresql://postgres:postgres@db.example.com:5432/clinic_genie_enquiry_test")).toThrow(/not local/);
    expect(assertEnquiryFixtureUrl("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie_enquiry_test").database).toBe("clinic_genie_enquiry_test");
  });

  it("rejects a remote worker database and a fixture fetch to a provider host", () => {
    expect(() => assertLocalWorkerDatabase("postgresql://postgres:postgres@db.example.com:5432/clinic_genie")).toThrow(/not local/);
    process.env.ANALYTICS_FIXTURE_MODE = "1";
    expect(() => assertFixtureFetch("https://analyticsdata.googleapis.com/v1beta/properties/1:runReport")).toThrow(/refused/);
    expect(() => assertFixtureFetch("https://www.wixapis.com/oauth2/token")).toThrow(/refused/);
    delete process.env.ANALYTICS_FIXTURE_MODE;
    expect(() => assertFixtureFetch("https://www.wixapis.com/oauth2/token")).not.toThrow();
  });

  it("rejects an unauthenticated worker secret and names every provider scenario", () => {
    const secret = "worker-fixture-secret";
    expect(bearerMatches(null, secret)).toBe(false);
    expect(bearerMatches("Bearer wrong-secret-value", secret)).toBe(false);
    expect(bearerMatches(`Bearer ${secret}`, secret)).toBe(true);
    expect(bearerMatches(`Bearer ${secret}`, undefined)).toBe(false);
    expect(PROVIDER_FIXTURE_SCENARIOS.map((item) => item.id)).toEqual([
      "success", "empty", "expired-credentials", "provider-error", "rate-limit", "stale", "multiple-websites", "overlapping-sources",
    ]);
    expect(syncIsStale(null, new Date("2026-10-28T00:00:00.000Z"))).toBe(true);
    expect(syncIsStale(new Date("2026-10-27T00:00:00.000Z"), new Date("2026-10-28T00:00:00.000Z"), 36)).toBe(false);
    expect(syncIsStale(new Date("2026-10-20T00:00:00.000Z"), new Date("2026-10-28T00:00:00.000Z"), 36)).toBe(true);
  });

  it("does not count blocked or excluded website capabilities as passed", () => {
    for (const item of WEBSITE_CAPABILITIES) {
      if (item.state !== "testable") expect(capabilityCountsAsPassed(item.state, true)).toBe(false);
    }
    expect(WEBSITE_CAPABILITIES.find((item) => item.id === "wix-blog-publishing")?.state).toBe("excluded");
    expect(WEBSITE_CAPABILITIES.find((item) => item.id === "blog-performance")?.state).toBe("excluded");
  });
});
