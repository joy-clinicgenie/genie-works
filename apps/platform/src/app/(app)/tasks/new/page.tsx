import { redirect } from "next/navigation";
import { canEditClient, listActiveStaff, listClients } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { TaskForm } from "@/components/modules/TaskForm";
import { RelatedPicker } from "@/components/modules/RelatedPicker";
import { Field, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { clientLabel } from "@/lib/client-label";

export const dynamic = "force-dynamic";
export const metadata = { title: "New task" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ client?: string; relatedType?: string; relatedId?: string }> }) {
  const access = await requireAccess();
  if (access.user.platform_role === "read_only") redirect("/my-tasks");
  const { client, relatedType, relatedId } = await searchParams;
  const data = await staffTx(access, async (db) => {
    const clients = (await listClients(db)).filter((c) => canEditClient(access, c.id));
    const owners = await listActiveStaff(db);
    const picker = client ? await RelatedPicker({ db, clientId: client, relatedType: relatedType ?? null, relatedId: relatedId ?? null, refineHref: (t) => `/tasks/new?client=${client}&relatedType=${t}` }) : null;
    return { clients, owners, picker };
  });
  const chosen = data.clients.find((c) => c.id === client);
  return (
    <>
      <PageHeader title="New task" description="One accountable owner and a priority. A due date is optional." />
      <Card className="p-6 max-w-3xl">
        {!chosen ? (
          <form method="get" className="space-y-4">
            <Field label="Client" htmlFor="client" required hint="Tasks always belong to a client.">
              <Select id="client" name="client" defaultValue="" required>
                <option value="" disabled>Choose a client</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>{clientLabel(c)}</option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary">Continue</Button>
          </form>
        ) : (
          <>
            <p className="text-sm mb-4">Client: <strong>{clientLabel(chosen)}</strong> <a href="/tasks/new" className="text-action underline ml-2">change</a></p>
            <TaskForm mode="create" values={{ clientId: chosen.id, ownerUserId: access.user.id }} owners={data.owners.filter((o) => o.platform_role !== "read_only")} relatedPicker={data.picker} />
          </>
        )}
      </Card>
    </>
  );
}
