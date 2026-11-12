/**
 * The isolated suite guards. These run before any maintenance connection opens, so a mistake here is
 * what stands between a prepare command and a shared database.
 */
import { describe, expect, it } from "vitest";
import {
  SUITES,
  adminUrl,
  appUrl,
  assertBatchDatabase,
  isSuiteName,
  suiteDatabases,
  suiteName,
  suiteTargets,
} from "../../../e2e-batch08/targets";

describe("isolated suite targets", () => {
  it("knows the two suites and defaults to the batch-08 one", () => {
    expect(Object.keys(SUITES)).toEqual(["b08", "perf"]);
    expect(suiteName(undefined)).toBe("b08");
    expect(suiteName("nonsense")).toBe("b08");
    expect(suiteName("perf")).toBe("perf");
    expect(isSuiteName("perf")).toBe(true);
    expect(isSuiteName("prod")).toBe(false);
  });

  it("gives each suite its own databases and ports, with no overlap", () => {
    const b08 = suiteTargets("b08");
    const perf = suiteTargets("perf");
    expect(b08.platformDb).not.toBe(perf.platformDb);
    expect(b08.enquiryDb).not.toBe(perf.enquiryDb);
    expect(new Set([b08.prodPort, b08.devPort, perf.prodPort, perf.devPort]).size).toBe(4);
    // Nothing may collide with the development server on 3400.
    for (const port of [b08.prodPort, b08.devPort, perf.prodPort, perf.devPort]) expect(port).not.toBe(3400);
    expect(suiteDatabases()).toHaveLength(4);
  });

  it("keeps every suite enquiry database acceptable to the enquiry fixture guard", async () => {
    const { assertEnquiryFixtureUrl } = await import("../src/testing/targets");
    for (const suite of ["b08", "perf"] as const) {
      const database = suiteTargets(suite).enquiryDb;
      expect(database).toContain("enquiry");
      expect(database).toContain("test");
      expect(() => assertEnquiryFixtureUrl(adminUrl(database))).not.toThrow();
    }
  });

  it("refuses every shared database by name", () => {
    for (const database of [
      "clinic_genie",
      "clinic_genie_rehearsal",
      "clinic_genie_enquiry_test",
      "clinic_genie_enquiry_staging",
      "neondb",
      "postgres",
    ]) {
      expect(() => assertBatchDatabase(database), database).toThrow(/Refusing/);
      expect(() => adminUrl(database), database).toThrow(/Refusing/);
      expect(() => appUrl(database), database).toThrow(/Refusing/);
    }
  });

  it("refuses a database that merely looks like a suite database", () => {
    // A marker alone is not enough: the name has to be on the suite list.
    for (const database of ["clinic_genie_perf", "clinic_genie_b08_old", "clinic_genie_perf_baseline2", "my_b08_db"]) {
      expect(() => assertBatchDatabase(database), database).toThrow(/not an isolated suite database/);
    }
  });

  it("refuses a name that is not a plain identifier", () => {
    for (const database of ["clinic genie", "clinic;drop", 'clinic"genie', "clinic-genie-perf"]) {
      expect(() => assertBatchDatabase(database), database).toThrow(/Refusing database name/);
    }
  });

  it("accepts exactly the suite databases, on a local host, with the expected roles", () => {
    for (const database of suiteDatabases()) {
      expect(() => assertBatchDatabase(database)).not.toThrow();
      expect(adminUrl(database)).toBe(`postgresql://postgres:postgres@127.0.0.1:54339/${database}`);
      expect(appUrl(database)).toBe(`postgresql://cg_app:cg_app_dev@127.0.0.1:54339/${database}`);
    }
  });
});
