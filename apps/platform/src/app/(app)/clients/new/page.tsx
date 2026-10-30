import { redirect } from "next/navigation";
import { canManageRegistry, listActiveStaff } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { ClientForm } from "@/components/modules/ClientForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "New client" };

export default async function NewClientPage() {
  const access = await requireAccess();
  if (!canManageRegistry(access)) redirect("/clients");
  const staff = await staffTx(access, (db) => listActiveStaff(db));
  return (
    <>
      <PageHeader title="Add client" description="Creates the clinic record. Contacts, account references and assigned staff are added on the profile." />
      <Card className="p-6 max-w-3xl">
        <ClientForm mode="create" staff={staff} values={{}} />
      </Card>
    </>
  );
}
