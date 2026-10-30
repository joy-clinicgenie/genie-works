/** Creates, checks or resets the isolated synthetic enquiry database. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv, requireEnv } from "../src/env";
import { checkEnquiryFixture, resetEnquiryFixture, resolveEnquiryFixtureUrl } from "../src/testing/enquiry-fixture";
import { assertEnquiryFixtureUrl, enquiryFixtureUrlFromAdmin } from "../src/testing/targets";

loadRootEnv();
const command = process.argv[2];

function report(summary: { database: string; host: string; port: string; enquiries: number; notifications: number; clinics: string[]; mailSink: string }): void {
  console.log(`Enquiry fixture database: ${summary.database}`);
  console.log(`Host: ${summary.host}${summary.port ? `:${summary.port}` : ""}`);
  console.log(`Clinics: ${summary.clinics.join(", ")}`);
  console.log(`Synthetic enquiries: ${summary.enquiries}`);
  console.log(`Notifications: ${summary.notifications}`);
  console.log(`Mail sink: ${summary.mailSink} (no message is sent)`);
  console.log("Label: synthetic test data. This is not proof of website intake or deduplication.");
}

function linkLocalFixture(): void {
  const url = enquiryFixtureUrlFromAdmin(requireEnv("DATABASE_ADMIN_URL"));
  assertEnquiryFixtureUrl(url);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const file = join(root, ".env");
  if (!existsSync(file)) throw new Error("No .env file exists. Copy .env.example to .env first.");
  const text = readFileSync(file, "utf8");
  const line = `ENQUIRY_DATABASE_URL=${url}`;
  const lines = text.split(/\n/);
  let found = false;
  const next = lines.map((entry) => {
    if (!entry.startsWith("ENQUIRY_DATABASE_URL=")) return entry;
    found = true;
    return line;
  });
  if (!found) next.push(line);
  writeFileSync(file, next.join("\n"));
  console.log("ENQUIRY_DATABASE_URL now selects clinic_genie_enquiry_test on the local platform database. Restart the app to read it. The value was not printed.");
}

try {
  if (command === "link") {
    linkLocalFixture();
  } else if (command === "check") {
    assertEnquiryFixtureUrl(resolveEnquiryFixtureUrl());
    report(await checkEnquiryFixture());
  } else if (command === "seed" || command === "reset") {
    report(await resetEnquiryFixture());
    console.log(command === "seed" ? "Enquiry fixture seeded." : "Enquiry fixture reset.");
  } else {
    console.error("Usage: enquiry-fixture.ts check|seed|reset|link");
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Enquiry fixture command failed.");
  process.exit(1);
}
