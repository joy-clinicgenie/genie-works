import { rmSync } from "node:fs";
import pg from "pg";
import { DATABASE, UPLOADS, adminUrl } from "./target.mts";

export default async function globalTeardown(): Promise<void> {
  const maintenance = new pg.Client({ connectionString: adminUrl("postgres") });
  await maintenance.connect();
  await maintenance.query(`drop database if exists ${DATABASE} with (force)`);
  await maintenance.end();
  rmSync(UPLOADS, { recursive: true, force: true });
}
