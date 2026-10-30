import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageUsers } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { PageHeader } from "@/components/ui/Card";
import { AdminTabs } from "@/components/shell/AdminTabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  if (!canManageUsers(access)) redirect("/");
  return (
    <AdminTabs>
      <PageHeader title="Admin" description={<>Users, roles, client access, security audit history and recovery records. See <Link href="/clients" className="underline">Clients</Link> to grant client access.</>} />
      {children}
    </AdminTabs>
  );
}
