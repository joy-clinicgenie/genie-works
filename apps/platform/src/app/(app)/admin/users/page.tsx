import { listMembershipsForUser, listStaff } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, label } from "@/components/ui/Badge";
import { EditStaffForm, NewStaffForm } from "@/components/modules/AdminForms";
import { Notice } from "@/components/ui/Notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users and roles" };

export default async function AdminUsersPage() {
  const access = await requireAccess();
  const data = await staffTx(access, async (db) => {
    const staff = await listStaff(db);
    const memberships: Record<string, Awaited<ReturnType<typeof listMembershipsForUser>>> = {};
    for (const person of staff) memberships[person.id] = await listMembershipsForUser(db, person.id);
    return { staff, memberships };
  });
  return (
    <>
      <Notice tone="neutral" title="Role matrix (proposed, DECISIONS.md D6)">Admin and manager see every client. Specialist edits records for clients they are members of. Reviewer decides approvals and HCSA reviews for their clients. Read-only can only view. Client access is granted on each client&apos;s Profile tab.</Notice>
      <Card className="mt-4">
        <CardHeader title="Staff" />
        <ul className="divide-y divide-line">
          {data.staff.map((u) => (
            <li key={u.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2 text-sm mb-2">
                <span className="font-medium">{u.display_name}</span>
                <span className="text-muted">{u.email}</span>
                <Badge tone={u.active ? "good" : "neutral"}>{u.active ? "Active" : "Deactivated"}</Badge>
                <Badge>{label(u.platform_role)}</Badge>
                <span className="text-xs text-muted">{["admin", "manager"].includes(u.platform_role) ? "All clients" : data.memberships[u.id]?.length ? `Clients: ${data.memberships[u.id]!.map((m) => m.client_name).join(", ")}` : "No client access"}</span>
              </div>
              <EditStaffForm user={u} />
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-6"><CardHeader title="Add a staff member" description="Creates the authorisation record. Sign-in identity comes from the configured provider." /><div className="px-5 pb-5"><NewStaffForm /></div></Card>
    </>
  );
}
