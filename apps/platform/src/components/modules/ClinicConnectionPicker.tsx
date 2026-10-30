"use client";

import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/Button";
import { PillSelect } from "@/components/ui/PillSelect";

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
        <PillSelect name="client" defaultValue={selected} className="mt-1">
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </PillSelect>
      </label>
      <button className={buttonClass("secondary")} type="submit">Show</button>
    </form>
  );
}
