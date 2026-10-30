import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads the repository root `.env` into process.env without overriding values already set.
 * No secrets are printed. Managed hosting (Vercel) injects variables directly, so this is a no-op there.
 */
export function loadRootEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "..", "..", ".env"), join(process.cwd(), ".env")];
  for (const file of candidates) {
    if (!existsSync(/*turbopackIgnore: true*/ file)) continue;
    const text = readFileSync(/*turbopackIgnore: true*/ file, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
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
    return;
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export function envFlag(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}
