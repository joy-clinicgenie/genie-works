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

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(authAdapterClient()),
  session: { strategy: "database", maxAge: 12 * 60 * 60, updateAge: 60 * 60 },
  providers,
  pages: { signIn: "/sign-in", error: "/sign-in", verifyRequest: "/dev/magic-links" },
  trustHost: true,
  callbacks: {
    /** Identity alone is not access. Only active staff records may sign in. */
    async signIn({ user, account, profile }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
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
