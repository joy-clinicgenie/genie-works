import { closePools, getAdminPool } from "../src/client";
import { loadRootEnv, requireEnv } from "../src/env";
import { assertSafeTarget, describeDatabaseTarget } from "../src/migrate";
import { seedDemo } from "../src/seed";

loadRootEnv();
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
assertSafeTarget(adminUrl);
console.log(describeDatabaseTarget(adminUrl));
try {
  await seedDemo(getAdminPool(), (l) => console.log(l));
} finally {
  await closePools();
}
