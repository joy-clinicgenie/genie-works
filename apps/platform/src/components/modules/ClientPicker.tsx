"use client";

import { ChevronDown } from "lucide-react";
import { clientLabel } from "@/lib/client-label";

export function ClientPicker({ clients, value, label = "Your key stats for", range, from, to }: { clients: Array<{ id: string; name: string; referenceNumber?: string | null }>; value: string; label?: string; range?: string; from?: string; to?: string }) {
  return (
    <form>
      {range && <input type="hidden" name="range" value={range} />}
      {range === "custom" && from && <input type="hidden" name="from" value={from} />}
      {range === "custom" && to && <input type="hidden" name="to" value={to} />}
      <label htmlFor="analytics-client" className="inline-flex items-center gap-2 text-sm text-ink-soft">
        <span>{label}</span>
        <span className="relative inline-flex">
          <select
            id="analytics-client"
            name="client"
            defaultValue={value}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className="min-h-10 appearance-none rounded-full border border-line bg-surface py-2 pl-4 pr-11 text-sm font-medium text-ink"
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{clientLabel(client)}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
        </span>
      </label>
    </form>
  );
}
