/**
 * Starts a local PostgreSQL server for development using embedded binaries.
 * Data persists in EMBEDDED_PG_DIR (default .data/postgres at the repository root).
 * This is a development convenience, not a managed database.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadRootEnv } from "../src/env";

loadRootEnv();
const port = Number(process.env.EMBEDDED_PG_PORT || 54339);
const root = resolve(process.cwd().includes("packages/db") ? join(process.cwd(), "..", "..") : process.cwd());
const databaseDir = resolve(root, process.env.EMBEDDED_PG_DIR || ".data/postgres");
const dbName = "clinic_genie";

const important = /FATAL|ERROR|HINT|ready to accept|shutting down|could not/;
const server = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  onLog: (m: string) => {
    const t = String(m).trim();
    if (important.test(t)) console.log(t);
  },
  onError: (m: unknown) => console.error(String(m)),
});

try {
  if (!existsSync(join(databaseDir, "PG_VERSION"))) {
    console.log(`Initialising development database cluster in ${databaseDir}`);
    await server.initialise();
  }
  await server.start();
} catch (err) {
  console.error("PostgreSQL failed to start.", err instanceof Error ? err.message : "Check that the port is free and the data directory is intact.");
  process.exit(1);
}
try {
  await server.createDatabase(dbName);
  console.log(`Created database ${dbName}`);
} catch {
  /* already exists */
}
console.log(`PostgreSQL listening on 127.0.0.1:${port} (database ${dbName}). Press Ctrl+C to stop.`);

const stop = async () => {
  console.log("Stopping PostgreSQL");
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
