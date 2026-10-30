import { closePools, getAdminPool } from "../src/client";
import { loadRootEnv, requireEnv } from "../src/env";
import { assertSafeTarget, databaseNameFromUrl, describeDatabaseTarget } from "../src/migrate";
import { seedLoad } from "../src/seed-load";

loadRootEnv();
const url = requireEnv("DATABASE_ADMIN_URL");
assertSafeTarget(url);
console.log(describeDatabaseTarget(url));
if (!databaseNameFromUrl(url).includes("perf")) {
  console.error("Refusing: the load seed only runs against a database whose name contains 'perf'.");
  process.exit(1);
}
try {
  await seedLoad(getAdminPool(), undefined, (l) => console.log(l));
} finally {
  await closePools();
}
