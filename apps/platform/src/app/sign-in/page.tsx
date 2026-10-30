import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authProviders, signIn } from "@/lib/auth";
import { getAccess } from "@/lib/session";
import { SignInErrorProbe } from "@/components/modules/SignInErrorProbe";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

function dbHostKind(): "missing" | "local" | "remote" {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "missing";
  try {
    const host = new URL(raw.replace(/^postgresql:/, "http:")).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "local";
    return "remote";
  } catch {
    return "missing";
  }
}

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const access = await getAccess();
  if (access) redirect("/");
  const { error, sent } = await searchParams;
  const cause = (await cookies()).get("gw_dbg")?.value;
  let authUrlHost = "";
  try {
    authUrlHost = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).host : "";
  } catch {
    authUrlHost = "invalid";
  }

  async function sendLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    await signIn("dev-link", { email, redirect: false, redirectTo: "/" });
    redirect("/dev/magic-links");
  }
  async function google() {
    "use server";
    await signIn("google", { redirectTo: "/" });
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-12">
      <div className="card w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <img src="/brandmark.svg" alt="" width={36} height={36} />
          <div className="leading-tight">
            <h1 className="text-xl font-semibold tracking-tight">Genie Works</h1>
            <p className="text-[11px] italic text-muted">Internal Platform for Genies</p>
          </div>
        </div>
        {error && <Notice tone="bad" title="Sign in was not completed">{error === "AccessDenied" ? "This email is not an active staff account." : "Please try again or contact an administrator."}</Notice>}
        <SignInErrorProbe error={error} cause={cause} dbHostKind={dbHostKind()} authUrlHost={authUrlHost} />
        {sent && <Notice tone="good" title="Sign-in link recorded">In development the link is not emailed. Open <Link href="/dev/magic-links" className="underline">the development links page</Link> to use it.</Notice>}
        {authProviders.devLinks && (
          <form action={sendLink} className="space-y-4 mt-4">
            <Field label="Work email" hint="Development: use one of the seeded addresses, for example admin@example.invalid." htmlFor="email">
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </Field>
            <Button type="submit" className="w-full">Send sign-in link</Button>
          </form>
        )}
        {authProviders.google && (
          <form action={google} className="mt-4">
            <Button type="submit" variant="secondary" className="w-full">Continue with Google Workspace</Button>
          </form>
        )}
        {!authProviders.devLinks && !authProviders.google && <Notice tone="warn" title="No sign-in method configured">Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET, or enable AUTH_DEV_MAGIC_LINKS in development.</Notice>}
        <p className="text-xs text-muted mt-6">Access is granted by an administrator. Signing in with an unknown email is refused and recorded.</p>
      </div>
    </main>
  );
}
