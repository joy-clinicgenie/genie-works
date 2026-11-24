import { listBlogWebsites, listClientsForRequest, scopeWorkspace, type ClientRow, type PoolClient } from "@clinic-genie/db";
import { clientLabel } from "@/lib/client-label";

/**
 * D87. The client and website scope shared by the five Blog pages. The client is carried in
 * `?client=`; `?website=` narrows to one of that client's websites. A client with one website is
 * always scoped to it; a client with several may be viewed across All websites (no `website`).
 */

export type BlogWebsite = { id: string; name: string; platform: string; url: string | null; client_id: string; client_name: string };

export interface BlogScope {
  clients: Array<{ id: string; label: string }>;
  clientId: string | null;
  client: ClientRow | null;
  /** The selected client's active websites, by name. */
  websites: BlogWebsite[];
  /** Null means All websites (only possible with more than one). */
  websiteId: string | null;
  website: BlogWebsite | null;
  denied: boolean;
  /** A website in the address did not belong to the client; the scope fell back to All websites or the only one. */
  websiteReplaced: boolean;
  multiple: boolean;
}

export const BLOG_PAGES = [
  { key: "overview", href: "/blog", label: "Overview" },
  { key: "posts", href: "/blog/posts", label: "Posts" },
  { key: "categories", href: "/blog/categories", label: "Categories" },
  { key: "tags", href: "/blog/tags", label: "Tags" },
  { key: "analytics", href: "/blog/analytics", label: "Analytics" },
] as const;
export type BlogPageKey = (typeof BLOG_PAGES)[number]["key"];

export async function resolveBlogScope(db: PoolClient, params: { client?: string; website?: string }): Promise<BlogScope> {
  const allWebsites = (await listBlogWebsites(db)) as BlogWebsite[];
  const clients = await listClientsForRequest(db, params.client);
  const selection = scopeWorkspace({
    requestedClientId: params.client,
    requestedWebsiteId: params.website,
    clients,
    websites: allWebsites.map((site) => ({ id: site.id, clientId: site.client_id })),
  });
  const clientId = selection.denied ? null : selection.clientId;
  const websites = clientId ? allWebsites.filter((site) => site.client_id === clientId).sort((a, b) => a.name.localeCompare(b.name, "en")) : [];
  const websiteId = selection.websiteId && websites.some((site) => site.id === selection.websiteId)
    ? selection.websiteId
    : websites.length === 1 ? websites[0]!.id : null;
  return {
    clients: clients.map((client) => ({ id: client.id, label: clientLabel(client) })).sort((a, b) => a.label.localeCompare(b.label, "en")),
    clientId,
    client: clients.find((client) => client.id === clientId) ?? null,
    websites,
    websiteId,
    website: websites.find((site) => site.id === websiteId) ?? null,
    denied: selection.denied,
    websiteReplaced: selection.websiteReplaced,
    multiple: websites.length > 1,
  };
}

/** A Blog URL carrying the scope. A website is only carried when it is a deliberate narrowing. */
export function blogHref(path: string, scope: { clientId: string | null; websiteId: string | null; multiple?: boolean }, extra: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams();
  if (scope.clientId) search.set("client", scope.clientId);
  if (scope.clientId && scope.websiteId) search.set("website", scope.websiteId);
  for (const [key, value] of Object.entries(extra)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/** Query keys that only mean something on the Posts register. A bookmark of /blog with any of them opens Posts. */
export const POSTS_ONLY_PARAMS = ["status", "author", "q", "sort", "page", "queue"] as const;

/** The list address to return to from an article: only a Blog Posts or Overview URL is accepted. */
export function safeBlogReturn(value: string | undefined | null): string | null {
  if (!value) return null;
  if (!/^\/blog(\/posts)?(\?[^#\s]*)?$/.test(value)) return null;
  return value;
}
