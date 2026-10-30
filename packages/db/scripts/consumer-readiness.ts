/**
 * Prints the website capability matrix and, when the local platform is up,
 * checks that the public read APIs reject a missing token. That probe is not
 * a publication test.
 */
import { capabilityCountsAsPassed, NATIVE_CONSUMER_PAGES, WEBSITE_CAPABILITIES } from "../src/testing/consumers";

const base = process.env.GENIE_WORKS_BASE_URL?.trim() || "http://127.0.0.1:3400";

function printMatrix(): void {
  console.log("Website capability matrix");
  for (const item of WEBSITE_CAPABILITIES) {
    const passed = capabilityCountsAsPassed(item.state, false);
    console.log(`- ${item.id} [${item.platform}] ${item.state}; counts as passed: ${passed}`);
    console.log(`  ${item.summary}`);
  }
  console.log("Representative native pages (staging indexable false):");
  for (const page of NATIVE_CONSUMER_PAGES) {
    console.log(`- ${page.path}: ${page.purpose}`);
  }
}

async function probe(): Promise<void> {
  const paths = [
    "/api/public/seo/00000000-0000-4000-8000-000000000000",
    "/api/public/blog/00000000-0000-4000-8000-000000000000",
  ];
  for (const path of paths) {
    try {
      const response = await fetch(`${base}${path}`, { headers: { accept: "application/json" } });
      console.log(`Unauthenticated ${path}: HTTP ${response.status}`);
      if (response.status !== 404) {
        throw new Error(`Expected the public read API to hide missing credentials with 404, received ${response.status}.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Expected")) throw error;
      console.log(`Platform probe skipped for ${path}: the local server is not reachable.`);
    }
  }
}

printMatrix();
await probe();
console.log("Blocked, pending and excluded capabilities were not counted as passed.");
