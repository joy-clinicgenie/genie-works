import { parseGa4AccountSummaries, parseGscSites } from "@clinic-genie/db";

export async function listGoogleProperties(accessToken: string, provider: "ga4" | "gsc"): Promise<{ properties: Array<{ id: string; label: string }>; error?: string }> {
  const url = provider === "ga4"
    ? "https://analyticsadmin.googleapis.com/v1beta/accountSummaries"
    : "https://www.googleapis.com/webmasters/v3/sites";
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!response.ok) return { properties: [], error: "The property list could not be loaded." };
  const properties = provider === "ga4" ? parseGa4AccountSummaries(await response.json()) : parseGscSites(await response.json());
  if (properties.length === 0) return { properties, error: "No property was returned for this account." };
  return { properties };
}
