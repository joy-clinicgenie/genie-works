"use client";

import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/Button";

export function ClinicConnectionPicker({ clients, selected }: { clients: Array<{ id: string; name: string }>; selected: string }) {
  const router = useRouter();
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const clinic = new FormData(event.currentTarget).get("client");
        if (typeof clinic === "string" && clinic) router.push(`/settings?client=${clinic}`);
      }}
    >
      <label className="text-sm text-ink">
        Clinic
        <select name="client" defaultValue={selected} className="mt-1 block min-h-10 rounded-xl border border-line bg-white px-3 text-sm">
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
      </label>
      <button className={buttonClass("secondary")} type="submit">Show</button>
    </form>
  );
}
