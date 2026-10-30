import { notFound } from "next/navigation";
import { getClient } from "@clinic-genie/db";
import { requireClientAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { ClientHeading } from "@/components/shell/ClientHeading";
import { ClientTabs } from "@/components/shell/ClientTabs";

export default async function ClientLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const access = await requireClientAccess(id);
  const client = await staffTx(access, (db) => getClient(db, id));
  if (!client) notFound();
  return (
    <ClientTabs clientId={id}>
      <ClientHeading client={client} />
      {children}
    </ClientTabs>
  );
}
