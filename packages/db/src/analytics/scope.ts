import type { Queryable } from "../client";

/**
 * Website analytics covers the internal Clinic Genie client only (D61). Other clients keep
 * Search Console connections, because SEO index checks and SEO performance read them, but
 * GA4 and the analytics pages are limited to these clients.
 */
export const ANALYTICS_CLIENT_SLUGS: readonly string[] = ["clinic-genie"];

/** Providers every client may keep for SEO, whatever ANALYTICS_CLIENT_SLUGS says. */
export const SEO_SHARED_PROVIDERS: readonly string[] = ["gsc"];

export function isAnalyticsClient(client: { slug: string }): boolean {
  return ANALYTICS_CLIENT_SLUGS.includes(client.slug);
}

/** True when this client may hold a connection for this provider. */
export async function analyticsProviderAllowed(db: Queryable, clientId: string, provider: string): Promise<boolean> {
  if (SEO_SHARED_PROVIDERS.includes(provider)) return true;
  const { rows } = await db.query<{ slug: string }>("select slug from clients where id = $1", [clientId]);
  const row = rows[0];
  return row ? isAnalyticsClient(row) : false;
}
