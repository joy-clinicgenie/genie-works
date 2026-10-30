"use client";

import { clientLabel } from "@/lib/client-label";
import { DASHBOARD_RANGES } from "@/lib/agency-overview";
import { PillSelect } from "@/components/ui/PillSelect";

export function DashboardFilters({
  clients,
  clientId,
  rangeId,
}: {
  clients: Array<{ id: string; name: string; referenceNumber: string | null }>;
  clientId: string;
  rangeId: string;
}) {
  return (
    <form action="/" method="get" className="flex flex-wrap gap-2">
      <label className="inline-flex">
        <span className="sr-only">Client</span>
        <PillSelect name="client" defaultValue={clientId} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="max-w-64">
          <option value="">All clients</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{clientLabel(client)}</option>
          ))}
        </PillSelect>
      </label>
      <label className="inline-flex">
        <span className="sr-only">Reporting period</span>
        <PillSelect name="range" defaultValue={rangeId} onChange={(event) => event.currentTarget.form?.requestSubmit()}>
          {DASHBOARD_RANGES.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </PillSelect>
      </label>
    </form>
  );
}
