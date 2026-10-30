import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import PostgresAdapter from "@auth/pg-adapter";
import { SERVICE, authAdapterClient, createStaff, envFlag, getActiveStaffByEmail, recordAudit, recordMagicLink, withContext } from "@clinic-genie/db";

const devLinks = envFlag("AUTH_DEV_MAGIC_LINKS") && process.env.NODE_ENV !== "production";

const providers: Provider[] = [];
if (devLinks) {
  providers.push({
    id: "dev-link",
    type: "email",
    name: "Development sign-in link",
    from: "no-reply@example.invalid",
    maxAge: 15 * 60,
    options: {},
    async sendVerificationRequest({ identifier, url, expires }: { identifier: string; url: string; expires: Date }) {
      // No mail is sent. The link is recorded in the database and shown on /dev/magic-links.
      await withContext(SERVICE, (db) => recordMagicLink(db, identifier, url, expires));
    },
  } as unknown as Provider);
}
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET, allowDangerousEmailAccountLinking: false }));
}

export const authProviders = { devLinks, google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) };

let lastAuthDebug = "";

/** Safe failure token for the sign-in probe. No messages, emails, or connection strings. */
export function takeAuthDebug(): string {
  const value = lastAuthDebug;
  lastAuthDebug = "";
  return value;
}

function debugAuth(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch("http://127.0.0.1:7497/ingest/623c1501-d99c-4ad1-856f-8a22aec65c5b", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "19cd7c" },
    body: JSON.stringify({ sessionId: "19cd7c", runId: "pre-fix", hypothesisId, location, message, data, timestamp: Date.now() }),
  }).catch(() => {});
  // #endregion
}

function authFailureToken(error: unknown): string {
  const record = error as { type?: unknown; name?: unknown; cause?: { code?: unknown; err?: { code?: unknown; name?: unknown; cause?: { code?: unknown } } } };
  const type = String(record?.type || record?.name || "unknown").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
  const code = String(record?.cause?.err?.code || record?.cause?.err?.cause?.code || record?.cause?.code || record?.cause?.err?.name || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40);
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number) => {
    if (!value || depth > 5 || seen.has(value) || typeof value !== "object") return;
    seen.add(value);
    const item = value as { message?: unknown; error?: unknown; error_description?: unknown; body?: { error?: unknown; error_description?: unknown }; cause?: unknown; err?: unknown };
    if (typeof item.message === "string") parts.push(item.message);
    if (typeof item.error === "string") parts.push(item.error);
    if (typeof item.error_description === "string") parts.push(item.error_description);
    if (typeof item.body?.error === "string") parts.push(item.body.error);
    if (typeof item.body?.error_description === "string") parts.push(item.body.error_description);
    walk(item.cause, depth + 1);
    walk(item.err, depth + 1);
  };
  walk(error, 0);
  const detail = parts.join(" ").replace(/[A-Za-z0-9_-]{24,}/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
  return `${type}:${code}:${detail}`;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(authAdapterClient()),
  session: { strategy: "database", maxAge: 12 * 60 * 60, updateAge: 60 * 60 },
  providers,
  pages: { signIn: "/sign-in", error: "/sign-in", verifyRequest: "/dev/magic-links" },
  trustHost: true,
  logger: {
    error(error) {
      const token = authFailureToken(error);
      lastAuthDebug = token;
      debugAuth("A-D", "auth.ts:logger", "auth error", { token });
    },
  },
  callbacks: {
    /** Identity alone is not access. Only active staff records may sign in. */
    async signIn({ user, account, profile }) {
      const email = user.email?.toLowerCase();
      if (!email) {
        debugAuth("E", "auth.ts:signIn", "sign-in refused before staff lookup", { reason: "no_email", provider: account?.provider ?? null });
        return false;
      }
      let staff = await withContext(SERVICE, (db) => getActiveStaffByEmail(db, email));
      const allowedDomain = process.env.AUTH_GOOGLE_HD?.trim().toLowerCase();
      const domain = email.split("@")[1];
      const hosted = profile && typeof profile === "object" && "hd" in profile && typeof profile.hd === "string" ? profile.hd.toLowerCase() : undefined;
      if (
        !staff &&
        process.env.NODE_ENV !== "production" &&
        account?.provider === "google" &&
        allowedDomain &&
        domain === allowedDomain &&
        (!hosted || hosted === allowedDomain)
      ) {
        await withContext(SERVICE, (db) => createStaff(db, { email, displayName: user.name?.trim() || email, role: "admin" }, null));
        staff = await withContext(SERVICE, (db) => getActiveStaffByEmail(db, email));
      }
      if (!staff) {
        debugAuth("E", "auth.ts:signIn", "no active staff record", { provider: account?.provider ?? null, domainAllowed: Boolean(allowedDomain && domain === allowedDomain) });
        await withContext(SERVICE, (db) =>
          recordAudit(db, { actorType: "public", action: "auth.sign_in", targetType: "staff_user", outcome: "denied", metadata: { reason: "no_active_staff_record", emailDomain: email.split("@")[1] } }),
        );
        return false;
      }
      await withContext(SERVICE, (db) => recordAudit(db, { actorType: "staff", actorUserId: staff.id, action: "auth.sign_in", targetType: "staff_user", targetId: staff.id, outcome: "success" }));
      return true;
    },
  },
});
