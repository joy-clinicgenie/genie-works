import Link from "next/link";
import { canManageRegistry, listActiveStaff, listClientSpecialties, listClients } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";
import { Notice } from "@/components/ui/Notice";
import { FilterBar, FilterInput, FilterSelect } from "@/components/ui/Filters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; specialty?: string; owner?: string; denied?: string; archived?: string }> }) {
  const access = await requireAccess();
  const params = await searchParams;
  const status = params.archived === "1" ? "archived" : params.status === "archived" || params.status === "all" ? params.status : undefined;
  const data = await staffTx(access, async (db) => ({
    clients: await listClients(db, { query: params.q, specialty: params.specialty, ownerUserId: params.owner, status: status === "all" ? "all" : status === "archived" ? "archived" : "active", includeArchived: status === "all" }),
    specialties: await listClientSpecialties(db, { status: status === "all" ? "all" : status === "archived" ? "archived" : "active" }),
    staff: await listActiveStaff(db),
  }));
  return (
    <>
      <PageHeader title="Clients" description="Clinic directory. Contract dates, service scope and renewal reminders are not part of this record yet." action={canManageRegistry(access) ? <LinkButton href="/clients/new">Add client</LinkButton> : undefined} />
      {params.denied && <div className="mb-4"><Notice tone="bad" title="Not available">You do not have access to that client.</Notice></div>}
      <FilterBar>
        <FilterInput name="q" label="Search" value={params.q} placeholder="Name, client ID or short code" />
        <FilterSelect name="status" label="Status" value={status === "all" || status === "archived" ? status : ""} allLabel="Active" options={[{ value: "all", label: "Active and inactive" }, { value: "archived", label: "Inactive" }]} />
        <FilterSelect name="specialty" label="Specialty" value={params.specialty} allLabel="All specialties" options={data.specialties.map((specialty) => ({ value: specialty, label: specialty }))} />
        <FilterSelect name="owner" label="Clinic Genie owner" value={params.owner} allLabel="All owners" options={data.staff.map((person) => ({ value: person.id, label: person.display_name }))} />
      </FilterBar>
      <Card>
        <Table caption="Clients">
          <thead>
            <tr>
              <Th>Client ID</Th>
              <Th>Short code</Th>
              <Th>Client name</Th>
              <Th>Specialty</Th>
              <Th>Clinic Genie owner</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.clients.map((c) => (
              <tr key={c.id} className="hover:bg-surface-muted/60">
                <Td>{c.reference_number ?? <span className="text-muted">Not set</span>}</Td>
                <Td>{c.short_code ?? <span className="text-muted">Not set</span>}</Td>
                <Td>
                  <Link href={`/clients/${c.id}`} className="font-medium text-action hover:underline">{c.name}</Link>
                  {c.is_synthetic && <div className="text-xs text-muted">Demonstration data</div>}
                </Td>
                <Td>{c.specialty ?? <span className="text-muted">Not set</span>}</Td>
                <Td>{c.owner_name ?? <span className="text-muted">Unassigned</span>}</Td>
                <Td><Badge tone={c.status === "active" ? "good" : "neutral"}>{c.status === "active" ? "Active" : "Inactive"}</Badge></Td>
              </tr>
            ))}
            {data.clients.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted">
                  {params.q || params.specialty || params.owner || status ? "No clients match this search." : canManageRegistry(access) ? "No clients yet. Add one and mark it as demonstration data." : "No clients are visible to you. Ask an administrator for access."}
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
