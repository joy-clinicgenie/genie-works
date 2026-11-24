import pg from "pg";
import { DATABASE, adminUrl } from "./target.mts";

export default async function globalTeardown(): Promise<void> {
  const maintenance = new pg.Client({ connectionString: adminUrl("postgres") });
  await maintenance.connect();
  await maintenance.query(`drop database if exists ${DATABASE} with (force)`);
  await maintenance.end();
}
