"use client";

import { clientLabel } from "@/lib/client-label";
import { PillSelect } from "@/components/ui/PillSelect";

export function ClientPicker({ clients, value, label = "Your key stats for", range, from, to }: { clients: Array<{ id: string; name: string; referenceNumber?: string | null }>; value: string; label?: string; range?: string; from?: string; to?: string }) {
  return (
    <form>
      {range && <input type="hidden" name="range" value={range} />}
      {range === "custom" && from && <input type="hidden" name="from" value={from} />}
      {range === "custom" && to && <input type="hidden" name="to" value={to} />}
      <label htmlFor="analytics-client" className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-sm text-ink-soft">
        <span className="shrink-0">{label}</span>
        <PillSelect
          id="analytics-client"
          name="client"
          defaultValue={value}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="w-48 max-w-full"
        >
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{clientLabel(client)}</option>
          ))}
        </PillSelect>
      </label>
    </form>
  );
}
