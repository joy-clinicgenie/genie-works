import { describe, expect, it } from "vitest";
import {
  FIXTURE_CLIENTS,
  FIXTURE_MEMBERSHIPS,
  FIXTURE_SECOND_ADMIN,
  FIXTURE_VERSION,
  FIXTURE_WEBSITES,
  FIXTURE_WIX_BINDING,
  anchorDateSgt,
  fixtureWindows,
  loadPerfFixture,
} from "../src/testing/perf-fixture";
import { PERF_ENQUIRY_COUNTS, perfEnquiryRows, resetPerfEnquiryFixture } from "../src/testing/perf-enquiry-fixture";

describe("performance fixture shape", () => {
  it("is versioned", () => {
    expect(FIXTURE_VERSION).toMatch(/^perf-\d+$/);
  });

  it("computes the same windows the analytics presets ask for", () => {
    const windows = fixtureWindows("2026-11-03");
    expect(windows.last7).toEqual({ start: "2026-10-28", end: "2026-11-03" });
    expect(windows.last7Previous).toEqual({ start: "2026-10-21", end: "2026-10-27" });
    expect(windows.last30).toEqual({ start: "2026-10-05", end: "2026-11-03" });
    expect(windows.last30Previous).toEqual({ start: "2026-09-05", end: "2026-10-04" });
    expect(windows.last90).toEqual({ start: "2026-08-06", end: "2026-11-03" });
    expect(windows.last90Previous).toEqual({ start: "2026-05-08", end: "2026-08-05" });
  });

  it("anchors to the Singapore day, which is the platform's operational day", () => {
    // 16:30 UTC is already the next day in Singapore.
    expect(anchorDateSgt(new Date("2026-11-02T16:30:00Z"))).toBe("2026-11-03");
    expect(anchorDateSgt(new Date("2026-11-02T15:30:00Z"))).toBe("2026-11-02");
  });

  it("names two demonstration clinics and one with no data", () => {
    expect([FIXTURE_CLIENTS.a.slug, FIXTURE_CLIENTS.b.slug, FIXTURE_CLIENTS.empty.slug])
      .toEqual(["demo-clinic-a", "demo-clinic-b", "demo-clinic-empty"]);
    for (const client of Object.values(FIXTURE_CLIENTS)) {
      expect(client.name.toLowerCase()).toContain("fictional");
    }
  });

  it("scopes the two specialists to different clinics and keeps a separate administrator", () => {
    const byEmail = new Map(FIXTURE_MEMBERSHIPS.map((m) => [m.email, m.clientId]));
    expect(byEmail.get("specialist-a@example.invalid")).toBe(FIXTURE_CLIENTS.a.id);
    expect(byEmail.get("specialist-b@example.invalid")).toBe(FIXTURE_CLIENTS.b.id);
    expect(byEmail.get("specialist-a@example.invalid")).not.toBe(byEmail.get("specialist-b@example.invalid"));
    expect(FIXTURE_SECOND_ADMIN.email).toBe("perf-admin@example.invalid");
    for (const membership of FIXTURE_MEMBERSHIPS) {
      expect(membership.email).toMatch(/@example\.invalid$/);
    }
  });

  it("binds the Wix form to Clinic B's website with the namespace the schema requires", () => {
    expect(FIXTURE_WIX_BINDING.websiteId).toBe(FIXTURE_WEBSITES.bProduction.id);
    expect(FIXTURE_WIX_BINDING.namespace).toBe("wix.form_app.form");
    expect(FIXTURE_WIX_BINDING.instanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(FIXTURE_WIX_BINDING.formId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("keeps every website URL on example.invalid", () => {
    for (const site of Object.values(FIXTURE_WEBSITES)) {
      expect(site.url).toMatch(/\.example\.invalid$/);
    }
  });

  it("refuses to load into a database whose name does not contain perf", async () => {
    await expect(loadPerfFixture("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie")).rejects.toThrow(/does not contain perf/);
    await expect(loadPerfFixture("postgresql://postgres:postgres@127.0.0.1:54339/neondb")).rejects.toThrow(/does not contain perf/);
  });
});

describe("performance enquiry fixture shape", () => {
  const rows = perfEnquiryRows("2026-11-03");

  it("is large enough to page at 25 per page", () => {
    expect(rows).toHaveLength(PERF_ENQUIRY_COUNTS.a);
    expect(rows.length).toBeGreaterThan(50);
  });

  it("keeps database enquiries to the database-sourced clinic only", () => {
    // D31 gives a website one enquiry source. Clinic B's website is Wix-bound, so its enquiries come
    // from the mock, not from this database.
    expect(new Set(rows.map((row) => row.clinicId))).toEqual(new Set([FIXTURE_CLIENTS.a.slug]));
  });

  it("covers every follow-up status", () => {
    const statuses = new Set(rows.map((row) => row.status));
    expect([...statuses].sort()).toEqual(["acknowledged", "closed", "new"]);
  });

  it("covers every notification state the platform can show, including the derived processing state", () => {
    const kinds = new Set(rows.map((row) => row.state.kind));
    expect([...kinds].sort()).toEqual(["exhausted", "failed", "none", "pending", "processing", "sent", "unconfigured"]);
    // "processing" is derived from a pending row whose lease has not expired, not from a stored status.
    const processing = rows.filter((row) => row.state.kind === "processing");
    expect(processing.length).toBeGreaterThan(0);
    for (const row of processing) {
      expect(row.state.status).toBe("pending");
      expect(row.state.leased).toBe(true);
    }
  });

  it("spreads rows over the current and the comparison window", () => {
    const dates = rows.map((row) => row.createdAt.slice(0, 10)).sort();
    // The earliest row sits before the 30-day window starts, so the comparison window has data too.
    expect(dates[0]! < "2026-10-05").toBe(true);
    expect(dates[dates.length - 1]!).toBe("2026-11-03");
  });

  it("keeps every contact synthetic and every reference labelled", () => {
    for (const row of rows) {
      expect(row.reference.startsWith("TEST-")).toBe(true);
      if (row.email) expect(row.email).toMatch(/@example\.invalid$/);
      expect(row.contactNumber).toBe("00000000");
    }
    // Some rows deliberately have no email, so the unavailable case is covered.
    expect(rows.some((row) => row.email === null)).toBe(true);
  });

  it("spreads rows across both of Clinic A's website keys, so the website filter has options", () => {
    const keys = new Set(rows.map((row) => row.websiteKey));
    expect(keys).toEqual(new Set([FIXTURE_WEBSITES.aProduction.enquiryKey, FIXTURE_WEBSITES.aStaging.enquiryKey]));
  });

  it("refuses a database that is not an isolated perf fixture", async () => {
    await expect(resetPerfEnquiryFixture("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie_enquiry_test"))
      .rejects.toThrow(/does not contain perf/);
    // clinic_genie is refused as the platform database, before the naming rule is even reached.
    await expect(resetPerfEnquiryFixture("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie"))
      .rejects.toThrow(/that database is the platform database/);
    await expect(resetPerfEnquiryFixture("postgresql://postgres:postgres@127.0.0.1:54339/clinic_genie_perf_only"))
      .rejects.toThrow(/enquiry and test/);
    await expect(resetPerfEnquiryFixture("postgresql://user:pass@db.example.invalid:5432/clinic_genie_enquiry_test_perf"))
      .rejects.toThrow(/not local/);
  });

  it("is deterministic for a given anchor", () => {
    const again = perfEnquiryRows("2026-11-03");
    expect(again.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(again.map((row) => row.createdAt)).toEqual(rows.map((row) => row.createdAt));
  });
});
