/**
 * Starts the development database when it is not already listening, then the platform app.
 * Sign-in stores sessions in Postgres. `npm run dev` previously started only Next.js,
 * so a fresh terminal refused every login until `npm run db:start` was running too.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";

const root = process.cwd();

function loadEnv() {
  const file = join(root, ".env");
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function waitForPort(port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await portOpen(port)) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`PostgreSQL did not accept connections on 127.0.0.1:${port}`));
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

loadEnv();
const port = Number(process.env.EMBEDDED_PG_PORT || 54339);
const already = await portOpen(port);
/** @type {import("node:child_process").ChildProcess | undefined} */
let database;
if (!already) {
  database = spawn("npm", ["run", "db:start"], { cwd: root, stdio: "inherit" });
  database.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`Development database exited with code ${code}`);
      process.exit(code);
    }
  });
  await waitForPort(port, 30_000);
}

const app = spawn("npm", ["run", "dev", "-w", "@clinic-genie/platform"], { cwd: root, stdio: "inherit" });

function stop() {
  app.kill("SIGINT");
  database?.kill("SIGINT");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", (code) => {
  database?.kill("SIGINT");
  process.exit(code ?? 0);
});
