import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import PostgresAdapter from "@auth/pg-adapter";
import { SERVICE, authAdapterClient, createStaff, getActiveStaffByEmail, recordAudit, recordMagicLink, withContext } from "@clinic-genie/db";
import { assertRuntimeAuthSecret, decideSignIn, magicLinksEnabled } from "./runtime-policy";

const devLinks = magicLinksEnabled();

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
      if (!magicLinksEnabled()) return;
      // No mail is sent. The link is recorded in the database and shown on /dev/magic-links.
      await withContext(SERVICE, (db) => recordMagicLink(db, identifier, url, expires));
    },
  } as unknown as Provider);
}
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  // Google has already verified the address. Link it when an email sign-in created the same user first.
  providers.push(Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET, allowDangerousEmailAccountLinking: true }));
}

export const authProviders = { devLinks, google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) };

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(authAdapterClient()),
  session: { strategy: "database", maxAge: 12 * 60 * 60, updateAge: 60 * 60 },
  providers,
  pages: { signIn: "/sign-in", error: "/sign-in", verifyRequest: "/dev/magic-links" },
  trustHost: true,
  callbacks: {
    /** Identity alone is not access. Only active staff records may sign in. */
    async signIn({ user, account, profile }) {
      assertRuntimeAuthSecret();
      const email = user.email?.toLowerCase();
      if (!email) return false;
      let staff = await withContext(SERVICE, (db) => getActiveStaffByEmail(db, email));
      const hosted = profile && typeof profile === "object" && "hd" in profile && typeof profile.hd === "string" ? profile.hd.toLowerCase() : undefined;
      if (decideSignIn({ email, hasStaff: Boolean(staff), provider: account?.provider, hostedDomain: hosted }) === "create-admin") {
        await withContext(SERVICE, (db) => createStaff(db, { email, displayName: user.name?.trim() || email, role: "admin" }, null));
        staff = await withContext(SERVICE, (db) => getActiveStaffByEmail(db, email));
      }
      if (!staff) {
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
