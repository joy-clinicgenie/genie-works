import { redirect } from "next/navigation";
import { canEditClient, listActiveStaff, listClients, listWebsites } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { SeoSectionLinks } from "@/components/modules/SeoSubnav";
import { InnerNavFrame } from "@/components/shell/InnerNav";
import { loadSeoContext } from "@/lib/seo-workspace";
import { SeoPageForm } from "@/components/modules/SeoForms";
import { Field, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";
export const metadata = { title: "Map a page" };

export default async function NewSeoPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const access = await requireAccess();
  const { client } = await searchParams;
  const data = await staffTx(access, async (db) => {
    const clients = (await listClients(db)).filter((c) => canEditClient(access, c.id));
    const websites = client ? await listWebsites(db, client) : [];
    const owners = await listActiveStaff(db);
    return { clients, websites, owners };
  });
  if (data.clients.length === 0) redirect("/seo");
  const chosen = data.clients.find((c) => c.id === client);
  const ctx = await loadSeoContext(access, { client });
  return (
    <InnerNavFrame label="SEO" nav={<SeoSectionLinks pathname="/seo/pages" ctx={ctx} />}>
      <PageHeader title="Map a page" description="Record the page, its target search and content status." />
      <Card className="p-6 max-w-3xl">
        {!chosen ? (
          <form method="get" className="space-y-4">
            <Field label="Client" htmlFor="client" required>
              <Select id="client" name="client" defaultValue="" required>
                <option value="" disabled>Choose a client</option>
                {data.clients.map((c) => <option key={c.id} value={c.id}>{clientLabel(c)}</option>)}
              </Select>
            </Field>
            <Button type="submit" variant="secondary">Continue</Button>
          </form>
        ) : (
          <>
            <p className="text-sm mb-4">Client: <strong>{clientLabel(chosen)}</strong> <a href="/seo/new" className="text-action underline ml-2">change</a></p>
            <SeoPageForm clientId={chosen.id} websites={data.websites.filter((w) => w.status === "active")} owners={data.owners.filter((o) => o.platform_role !== "read_only")} />
          </>
        )}
      </Card>
    </InnerNavFrame>
  );
}
