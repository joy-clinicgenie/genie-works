import { redirect } from "next/navigation";
import { canEditClient, listClients } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { ClaimForm } from "@/components/modules/MedicalForms";
import { Field, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";
export const metadata = { title: "New HCSA claim" };

export default async function NewClaimPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const access = await requireAccess();
  const { client } = await searchParams;
  const clients = await staffTx(access, async (db) => (await listClients(db)).filter((c) => canEditClient(access, c.id)));
  if (clients.length === 0) redirect("/medical-review");
  const chosen = clients.find((c) => c.id === client);
  return (
    <>
      <PageHeader title="New HCSA claim" description="Record the claim and its first wording. Then add sources and assign a reviewer." />
      <Card className="p-6 max-w-3xl">
        {!chosen ? (
          <form method="get" className="space-y-4">
            <Field label="Client" htmlFor="client" required>
              <Select id="client" name="client" defaultValue="" required>
                <option value="" disabled>Choose a client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{clientLabel(c)}</option>)}
              </Select>
            </Field>
            <Button type="submit" variant="secondary">Continue</Button>
          </form>
        ) : (
          <>
            <p className="text-sm mb-4">Client: <strong>{clientLabel(chosen)}</strong> <a href="/medical-review/new" className="text-action underline ml-2">change</a></p>
            <ClaimForm clientId={chosen.id} />
          </>
        )}
      </Card>
    </>
  );
}
