import { redirect } from "next/navigation";
import { canEditClient, listClients } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { ApprovalForm } from "@/components/modules/ApprovalForms";
import { RelatedPicker } from "@/components/modules/RelatedPicker";
import { Field, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";
export const metadata = { title: "New approval request" };

export default async function NewApprovalPage({ searchParams }: { searchParams: Promise<{ client?: string; relatedType?: string; relatedId?: string }> }) {
  const access = await requireAccess();
  const { client, relatedType, relatedId } = await searchParams;
  const data = await staffTx(access, async (db) => {
    const clients = (await listClients(db)).filter((c) => canEditClient(access, c.id));
    const picker = client ? await RelatedPicker({ db, clientId: client, relatedType: relatedType ?? null, relatedId: relatedId ?? null, refineHref: (t) => `/approvals/new?client=${client}&relatedType=${t}` }) : null;
    return { clients, picker };
  });
  if (data.clients.length === 0) redirect("/approvals");
  const chosen = data.clients.find((c) => c.id === client);
  return (
    <>
      <PageHeader title="New approval request" description="Save as a draft or submit it straight away. The requester cannot decide their own request." />
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
            <p className="text-sm mb-4">Client: <strong>{clientLabel(chosen)}</strong> <a href="/approvals/new" className="text-action underline ml-2">change</a></p>
            <ApprovalForm mode="create" values={{ clientId: chosen.id }} relatedPicker={data.picker} />
          </>
        )}
      </Card>
    </>
  );
}
