import { redirect } from "next/navigation";
import { seoHref, type SeoSearch } from "@/lib/seo-workspace";

export default async function BusinessProfilesRedirect({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const query = await searchParams;
  const client = Array.isArray(query.client) ? query.client[0] : query.client;
  const website = Array.isArray(query.website) ? query.website[0] : query.website;
  redirect(seoHref("/seo/business-profile", { client, website, demo: false }, { tab: "locations" }));
}