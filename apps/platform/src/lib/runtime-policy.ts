import { isSharedDatabaseUrl } from "@clinic-genie/db";

const PLACEHOLDER_AUTH_SECRETS = new Set(["preview-build-only", "replace-with-a-long-random-string"]);

type RuntimeEnv = Record<string, string | undefined>;

function flag(env: RuntimeEnv, name: string): boolean {
  const value = env[name];
  if (value === undefined || value === "") return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function hostedEnvironment(env: RuntimeEnv): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
}

/** Local development only. A remote or shared database never qualifies, even when NODE_ENV is development. */
export function localRehearsalDatabase(env: RuntimeEnv): boolean {
  return !hostedEnvironment(env) && !isSharedDatabaseUrl(env.DATABASE_URL ?? "");
}

export function magicLinksEnabled(env: RuntimeEnv = process.env): boolean {
  return flag(env, "AUTH_DEV_MAGIC_LINKS") && localRehearsalDatabase(env);
}

export function googleAutoAdminEnabled(env: RuntimeEnv = process.env): boolean {
  return localRehearsalDatabase(env);
}

export function decideSignIn(input: {
  email?: string | null;
  hasStaff: boolean;
  provider?: string | null;
  hostedDomain?: string | null;
  env?: RuntimeEnv;
}): "allow" | "create-admin" | "deny" {
  const env = input.env ?? process.env;
  const email = input.email?.toLowerCase();
  if (!email) return "deny";
  if (input.hasStaff) return "allow";
  const allowed = env.AUTH_GOOGLE_HD?.trim().toLowerCase();
  const domain = email.split("@")[1];
  const hosted = input.hostedDomain?.toLowerCase();
  if (
    input.provider === "google" &&
    googleAutoAdminEnabled(env) &&
    allowed &&
    domain === allowed &&
    (!hosted || hosted === allowed)
  ) {
    return "create-admin";
  }
  return "deny";
}

/** Rejects a missing secret and the build-only placeholders. Skipped while Next is building. */
export function assertRuntimeAuthSecret(env: RuntimeEnv = process.env): void {
  if (env.NEXT_PHASE === "phase-production-build") return;
  const secret = env.AUTH_SECRET ?? "";
  if (!secret || PLACEHOLDER_AUTH_SECRETS.has(secret)) {
    throw new Error("AUTH_SECRET is missing or is a build placeholder and cannot be used at runtime.");
  }
}
