export type BlogWebsiteChoice = { id: string; name: string; clientId: string };

/** The website that belongs to the chosen client. An owned selection is kept; otherwise the client's first website, by name. */
export function chooseClientWebsite(clientId: string, websites: readonly BlogWebsiteChoice[], currentWebsiteId?: string | null): string {
  const owned = websites.filter((site) => site.clientId === clientId).sort((a, b) => a.name.localeCompare(b.name, "en"));
  if (currentWebsiteId && owned.some((site) => site.id === currentWebsiteId)) return currentWebsiteId;
  return owned[0]?.id ?? "";
}
