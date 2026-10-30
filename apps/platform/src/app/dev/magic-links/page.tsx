import { notFound } from "next/navigation";
import { SERVICE, listMagicLinks, withContext } from "@clinic-genie/db";
import { assertRuntimeAuthSecret, magicLinksEnabled } from "@/lib/runtime-policy";
import { Notice } from "@/components/ui/Notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Development sign-in links" };

export default async function MagicLinksPage() {
  assertRuntimeAuthSecret();
  if (!magicLinksEnabled()) notFound();
  const links = await withContext(SERVICE, (db) => listMagicLinks(db));
  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-xl font-semibold mb-2">Development sign-in links</h1>
      <Notice tone="warn" title="Development only">This page exists because AUTH_DEV_MAGIC_LINKS is enabled. It is never available in production. Links expire after 15 minutes.</Notice>
      <ul className="mt-6 space-y-3">
        {links.length === 0 && <li className="text-muted">No links yet. Request one on the sign-in page.</li>}
        {links.map((l) => (
          <li key={l.id} className="card p-4">
            <div className="text-sm text-muted">{l.email}</div>
            <a className="text-action underline break-all" href={l.url}>Sign in as {l.email}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
