"use client";

import { useRouter } from "next/navigation";
import { FilterSelect } from "@/components/ui/Filters";
import type { BlogWebsiteChoice } from "@/lib/blog-workspace";

export function BlogClientFields({
  clients,
  websites,
  clientId,
  websiteId,
  path = "/blog/posts",
  allWebsites = false,
}: {
  clients: Array<{ value: string; label: string }>;
  websites: BlogWebsiteChoice[];
  clientId?: string;
  websiteId?: string;
  /** D87: the Blog page this filter reloads. */
  path?: string;
  /** D87: the client has several websites, so it may be viewed across all of them. */
  allWebsites?: boolean;
}) {
  const router = useRouter();
  const sites = websites.filter((site) => !clientId || site.clientId === clientId);

  function openClient(nextClient: string, form: HTMLFormElement | null) {
    const params = new URLSearchParams();
    if (form) {
      for (const [key, value] of new FormData(form)) {
        if (typeof value === "string") params.append(key, value);
      }
    }
    if (nextClient) params.set("client", nextClient);
    else params.delete("client");
    // A new client starts at All websites (or its only website); its websites load with the page.
    params.delete("website");
    if (params.get("sort") !== "published") params.delete("sort");
    params.delete("page");
    for (const [key, value] of [...params.entries()]) if (!value) params.delete(key);
    const query = params.toString();
    router.push(query ? `${path}?${query}` : path);
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
        allLabel={allWebsites ? "All websites" : "Choose a website"}
        options={sites.map((site) => ({ value: site.id, label: site.name }))}
      />
    </>
  );
}
