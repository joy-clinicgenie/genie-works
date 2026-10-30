import { redirect } from "next/navigation";
import { canEditClient, listAccountReferences, listClients } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { AuditForm } from "@/components/modules/AdsForms";
import { Field, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";
export const metadata = { title: "New Google Ads audit" };

export default async function NewAuditPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const access = await requireAccess();
  const { client } = await searchParams;
  const data = await staffTx(access, async (db) => ({
    clients: (await listClients(db)).filter((c) => canEditClient(access, c.id)),
    references: client ? (await listAccountReferences(db, client)).filter((r) => r.kind === "google_ads") : [],
  }));
  if (data.clients.length === 0) redirect("/google-ads");
  const chosen = data.clients.find((c) => c.id === client);
  return (
    <>
      <PageHeader title="New Google Ads audit" description="Define the review period and scope, then add findings." />
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
            <p className="text-sm mb-4">Client: <strong>{clientLabel(chosen)}</strong> <a href="/google-ads/audits/new" className="text-action underline ml-2">change</a></p>
            <AuditForm clientId={chosen.id} references={data.references} />
          </>
        )}
      </Card>
    </>
  );
}
