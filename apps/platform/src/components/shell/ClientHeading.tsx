"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/Badge";

export function ClientHeading({ client }: { client: { id: string; name: string; status: "active" | "archived"; is_synthetic: boolean; reference_number: string | null; short_code: string | null; specialty: string | null; owner_name: string | null } }) {
  const pathname = usePathname();
  if (pathname === `/clients/${client.id}`) return null;
  return (
    <div className="mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted"><Link href="/clients" className="hover:text-action">Clients</Link></div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight">{client.name}</h1>
        <Badge tone={client.status === "active" ? "good" : "neutral"}>{client.status === "active" ? "Active" : "Inactive"}</Badge>
        {client.is_synthetic && <Badge tone="warn">Demonstration data</Badge>}
      </div>
      <div className="text-sm text-muted mt-1">
        {client.reference_number ? `${client.reference_number} · ` : ""}
        {client.short_code ? `${client.short_code} · ` : ""}
        {client.specialty ? `${client.specialty} · ` : ""}
        Clinic Genie owner: {client.owner_name ?? "Unassigned"}
      </div>
    </div>
  );
}
