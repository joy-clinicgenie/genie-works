"use client";

import { useRouter } from "next/navigation";
import { FilterSelect } from "@/components/ui/Filters";
import { chooseClientWebsite, type BlogWebsiteChoice } from "@/lib/blog-workspace";

export function BlogClientFields({
  clients,
  websites,
  clientId,
  websiteId,
}: {
  clients: Array<{ value: string; label: string }>;
  websites: BlogWebsiteChoice[];
  clientId?: string;
  websiteId?: string;
}) {
  const router = useRouter();
  const sites = websites.filter((site) => !clientId || site.clientId === clientId);

  function openClient(nextClient: string, form: HTMLFormElement | null) {
    const nextWebsite = nextClient ? chooseClientWebsite(nextClient, websites) : "";
    const params = new URLSearchParams();
    if (form) {
      for (const [key, value] of new FormData(form)) {
        if (typeof value === "string") params.append(key, value);
      }
    }
    if (nextClient) params.set("client", nextClient);
    else params.delete("client");
    if (nextWebsite) params.set("website", nextWebsite);
    else params.delete("website");
    if (params.get("sort") !== "published") params.delete("sort");
    params.delete("page");
    for (const [key, value] of [...params.entries()]) if (!value) params.delete(key);
    const query = params.toString();
    router.push(query ? `/blog?${query}` : "/blog");
  }

  return (
    <>
      <FilterSelect
        name="client"
        label="Client"
        value={clientId}
        allLabel="Choose a client"
        options={clients}
        onChange={(event) => openClient(event.target.value, event.currentTarget.form)}
      />
      <FilterSelect
        name="website"
        label="Website"
        value={websiteId}
        allLabel="Choose a website"
        options={sites.map((site) => ({ value: site.id, label: site.name }))}
      />
    </>
  );
}
