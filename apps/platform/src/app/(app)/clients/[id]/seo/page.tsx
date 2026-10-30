import { canEditClient, listSeoPages, todaySgt } from "@clinic-genie/db";
import { requireClientAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { SeoPageTable } from "@/components/modules/SeoList";

export const dynamic = "force-dynamic";

export default async function ClientSeoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireClientAccess(id);
  const pages = await staffTx(access, (db) => listSeoPages(db, { clientId: id }));
  return (
    <>
      <div className="mb-4 flex justify-end gap-2">{canEditClient(access, id) && <LinkButton href={`/seo/new?client=${id}`}>Map a page</LinkButton>}<LinkButton href={`/seo/pages?tab=pages&client=${id}`} variant="secondary">Open SEO pages</LinkButton></div>
      <Card><SeoPageTable pages={pages} today={todaySgt()} showClient={false} /></Card>
    </>
  );
}
