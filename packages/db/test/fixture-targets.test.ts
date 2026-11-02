import { describe, expect, it } from "vitest";
import { assertMigrationTarget, assertSafeTarget, shouldStripImportedDirectory } from "../src/migrate";
import { assertDropTarget, assertEnquiryFixtureUrl, assertFixtureFetch, assertLocalWorkerDatabase, assertStagingEnquiryAdminUrl, rehearsalTargets, suiteEnquiryFixtureUrl } from "../src/testing/targets";
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
    expect(() => assertSafeTarget("postgresql://postgres:postgres@db.example.com:5432/clinic_genie")).toThrow(/local database/);
    expect(() => assertSafeTarget("postgresql://postgres:postgres@127.0.0.1:54329/clinic_genie")).toThrow(/54329/);
    const vercel = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    expect(() => assertSafeTarget("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie")).toThrow(/production/);
    if (vercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = vercel;
  });

  it("refuses a remote migration unless an explicit non-production opt-in is set", () => {
    const previous = process.env.MIGRATE_ALLOW_REMOTE;
    delete process.env.MIGRATE_ALLOW_REMOTE;
    expect(() => assertMigrationTarget("postgresql://postgres:postgres@db.example.com:5432/clinic_genie")).toThrow(/not local/);
    expect(() => assertMigrationTarget("postgresql://postgres:postgres@127.0.0.1:54329/clinic_genie")).toThrow(/54329/);
    process.env.MIGRATE_ALLOW_REMOTE = "1";
    expect(() => assertMigrationTarget("postgresql://postgres:postgres@db.example.com:5432/clinic_genie")).not.toThrow();
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    expect(() => assertMigrationTarget("postgresql://postgres:postgres@db.example.com:5432/clinic_genie")).toThrow(/production/);
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    if (previous === undefined) delete process.env.MIGRATE_ALLOW_REMOTE;
    else process.env.MIGRATE_ALLOW_REMOTE = previous;
    expect(shouldStripImportedDirectory(["0001_foundation.sql"])).toBe(true);
    expect(shouldStripImportedDirectory(["0035_rehearsal.sql"])).toBe(false);
  });

  it("rejects the platform database, the sibling port and a remote enquiry target before any reset", () => {
    expect(() => assertEnquiryFixtureUrl("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie")).toThrow(/platform database/);
    expect(() => assertEnquiryFixtureUrl("postgresql://postgres:postgres@127.0.0.1:54329/clinic_genie_enquiry_test")).toThrow(/54329/);
    expect(() => assertEnquiryFixtureUrl("postgresql://postgres:postgres@db.example.com:5432/clinic_genie_enquiry_test")).toThrow(/not local/);
    expect(assertEnquiryFixtureUrl("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie_enquiry_test").database).toBe("clinic_genie_enquiry_test");
    const suite = new URL(suiteEnquiryFixtureUrl("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie_rehearsal", "db"));
    expect(suite.pathname).toBe("/clinic_genie_enquiry_test_suite_db");
    expect(() => assertDropTarget("clinic_genie_enquiry_test", ["clinic_genie_enquiry_test_suite_db"])).toThrow(/shared/);
    expect(() => assertDropTarget("clinic_genie_rehearsal", ["clinic_genie_rehearsal_isolated"])).toThrow(/shared/);
  });

  it("chooses disposable rehearsal databases and checks them before a drop", () => {
    const targets = rehearsalTargets("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie");
    expect(targets.platform).toBe("clinic_genie_rehearsal_isolated");
    expect(targets.enquiry).toBe("clinic_genie_enquiry_test_isolated");
    expect(new URL(targets.platformUrl).pathname).toBe("/clinic_genie_rehearsal_isolated");
    expect(new URL(targets.enquiryUrl).pathname).toBe("/clinic_genie_enquiry_test_isolated");
    expect(() => rehearsalTargets("postgresql://postgres:postgres@db.example.com:5432/clinic_genie")).toThrow(/not local/);
    expect(() => rehearsalTargets("postgresql://postgres:postgres@127.0.0.1:54329/clinic_genie_rehearsal")).toThrow(/54329/);
    expect(() => rehearsalTargets("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie_rehearsal_isolated")).toThrow(/replaces/);
    const nodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(() => rehearsalTargets("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie")).toThrow(/production/);
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
    }
  });

  it("accepts only the remote staging enquiry database for setup", () => {
    expect(assertStagingEnquiryAdminUrl("postgresql://owner@db.example.com/clinic_genie_enquiry_staging").database).toBe("clinic_genie_enquiry_staging");
    expect(() => assertStagingEnquiryAdminUrl("postgresql://owner@127.0.0.1:54339/clinic_genie_enquiry_staging")).toThrow(/local/);
    expect(() => assertStagingEnquiryAdminUrl("postgresql://owner@db.example.com:54329/clinic_genie_enquiry_staging")).toThrow(/54329/);
    expect(() => assertStagingEnquiryAdminUrl("postgresql://owner@db.example.com/neondb")).toThrow(/neondb/);
    expect(() => assertStagingEnquiryAdminUrl("postgresql://owner@db.example.com/clinic_genie_enquiry_test")).toThrow(/clinic_genie_enquiry_test/);
    expect(() => assertStagingEnquiryAdminUrl("postgresql://owner@127.0.0.1:54339/clinic_genie_enquiry_test")).toThrow(/local/);
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
