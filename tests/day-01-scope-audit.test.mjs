import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { extractRecord as extractCg01, validateRecord as validateCg01 } from "../decisions/cg-01-checks.mjs";
import { extractRecord, validateRecord } from "../decisions/day-01-checks.mjs";

const markdown = readFileSync(new URL("../decisions/DAY-01-scope-audit.md", import.meta.url), "utf8");
const cg01Markdown = readFileSync(new URL("../decisions/CG-01-pilot-scope.md", import.meta.url), "utf8");

function committedRecord() {
  return extractRecord(markdown);
}

test("normal: frozen scope matches the CG-01 record and the files on disk", () => {
  const record = committedRecord();
  const cg01 = extractCg01(cg01Markdown);
  assert.deepEqual(validateRecord(record, markdown), []);
  assert.deepEqual(validateCg01(cg01, cg01Markdown), []);
  assert.equal(record.scopeSheet.productName, "Genie Works");
  assert.equal(record.scopeSheet.pilotWebsiteId, cg01.pilot.websiteId);
  assert.equal(record.scopeSheet.buildPath, cg01.buildPath);
  assert.equal(record.scopeSheet.bookingMode, cg01.booking.mode);
  assert.equal(record.scopeSheet.pageCount, cg01.pages.length);
  assert.equal(record.securityReviewer.status, "not-booked");
  assert.equal(record.access.vercel, "not-confirmed");

  const docs = new URL("../docs/", import.meta.url);
  for (let number = 0; number <= 20; number += 1) {
    const prefix = String(number).padStart(2, "0") + "_";
    assert.ok(readdirSync(docs).some((name) => name.startsWith(prefix)), `missing specification ${prefix}`);
  }
  assert.equal(existsSync(new URL("../package.json", import.meta.url)), true);
  assert.equal(existsSync(new URL("../apps", import.meta.url)), true);
});

test("failure: migration, invented URL, confirmed access, or fake booking is rejected", () => {
  const renamed = committedRecord();
  renamed.scopeSheet.productName = "Clinic Genie";
  assert.ok(validateRecord(renamed).some((error) => error.includes("product name")));

  const migrated = committedRecord();
  migrated.scopeSheet.buildPath = "wix-migration";
  migrated.scopeSheet.liveWixChangePermitted = true;
  assert.ok(validateRecord(migrated).some((error) => error.includes("scope sheet")));

  const staging = committedRecord();
  staging.scopeSheet.stagingUrl = "https://staging.example.invalid";
  staging.deployApproach.hostConnected = true;
  staging.deployApproach.host = "vercel";
  staging.deployApproach.stagingUrl = staging.scopeSheet.stagingUrl;
  assert.ok(validateRecord(staging).length > 0);

  const confirmed = committedRecord();
  confirmed.access.vercel = "confirmed";
  confirmed.providerConnection = true;
  confirmed.paidServiceIntroduced = true;
  const confirmedErrors = validateRecord(confirmed);
  assert.ok(confirmedErrors.some((error) => error.includes("vercel")));
  assert.ok(confirmedErrors.some((error) => error.includes("provider")));
  assert.ok(confirmedErrors.some((error) => error.includes("paid")));

  const nameless = committedRecord();
  nameless.securityReviewer = {
    status: "booked",
    name: null,
    independent: true,
    bookedFor: "2026-10-19",
    evidence: "assumed",
  };
  assert.ok(validateRecord(nameless).some((error) => error.includes("real name")));

  const placeholder = committedRecord();
  placeholder.securityReviewer = {
    status: "booked",
    name: "Independent Reviewer",
    independent: true,
    bookedFor: "2026-10-19",
    evidence: "placeholder",
  };
  assert.ok(validateRecord(placeholder).some((error) => error.includes("real name")));
});

test("unauthorised: unsigned reader, public visitor, and unassigned operator stay denied", () => {
  const record = committedRecord();
  assert.equal(record.unauthorised.unsignedReaderMayBookReviewer, false);
  assert.equal(record.unauthorised.unsignedReaderMayConnectProvider, false);
  assert.equal(record.unauthorised.publicVisitorMayEditLiveWix, false);
  assert.equal(record.unauthorised.unassignedOperatorMayMarkStagingLive, false);

  const book = committedRecord();
  book.unauthorised.unsignedReaderMayBookReviewer = true;
  assert.ok(validateRecord(book).some((error) => error.includes("unsigned reader") && error.includes("reviewer")));

  const connect = committedRecord();
  connect.unauthorised.unsignedReaderMayConnectProvider = true;
  assert.ok(validateRecord(connect).some((error) => error.includes("connect a provider")));

  const wix = committedRecord();
  wix.unauthorised.publicVisitorMayEditLiveWix = true;
  assert.ok(validateRecord(wix).some((error) => error.includes("public visitor")));

  const staging = committedRecord();
  staging.unauthorised.unassignedOperatorMayMarkStagingLive = true;
  assert.ok(validateRecord(staging).some((error) => error.includes("unassigned operator")));
});

test("failure: a missing decision block cannot confirm access", () => {
  assert.throws(() => extractRecord("# DAY-01\nNo record here.\n"), /DAY-01 record block is missing/);
});
