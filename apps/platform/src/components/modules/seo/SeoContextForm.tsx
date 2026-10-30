"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";

type ChoiceSite = {
  id: string;
  clientId: string;
  name: string;
  environment: "production" | "staging" | "development";
};

function environmentName(environment: ChoiceSite["environment"]): string {
  if (environment === "production") return "Production";
  if (environment === "staging") return "Preview";
  return "Development";
}

function websitesFor(sites: ChoiceSite[], clientId: string): ChoiceSite[] {
  if (!clientId) return [];
  return sites.filter((site) => site.clientId === clientId);
}

function chosenWebsite(sites: ChoiceSite[], clientId: string, websiteId: string): string {
  const matches = websitesFor(sites, clientId);
  if (matches.length === 1) return matches[0]!.id;
  return matches.some((site) => site.id === websiteId) ? websiteId : "";
}

export function SeoContextForm({
  pathname,
  tab,
  clients,
  sites,
  client,
  website,
}: {
  pathname: string;
  tab?: string;
  clients: Array<{ id: string; name: string }>;
  sites: ChoiceSite[];
  client?: string;
  website?: string;
}) {
  const [clientId, setClientId] = useState(client ?? "");
  const [websiteId, setWebsiteId] = useState(() => chosenWebsite(sites, client ?? "", website ?? ""));
  const matches = websitesFor(sites, clientId);
  return (
    <form method="get" action={pathname} className="mt-3 flex flex-wrap items-end gap-3">
      {tab && <input type="hidden" name="tab" value={tab} />}
      <Field label="Clinic" htmlFor={`${pathname}-client`}>
        <Select
          id={`${pathname}-client`}
          name="client"
          value={clientId}
          onChange={(event) => {
            const next = event.target.value;
            setClientId(next);
            setWebsiteId(chosenWebsite(sites, next, ""));
          }}
        >
          <option value="">Choose clinic</option>
          {clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </Field>
      <Field label="Website" htmlFor={`${pathname}-website`}>
        <Select id={`${pathname}-website`} name="website" value={websiteId} onChange={(event) => setWebsiteId(event.target.value)}>
          <option value="">Choose website</option>
          {matches.map((site) => (
            <option key={site.id} value={site.id}>{site.name} · {environmentName(site.environment)}</option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="secondary" size="sm">Open website</Button>
    </form>
  );
}
