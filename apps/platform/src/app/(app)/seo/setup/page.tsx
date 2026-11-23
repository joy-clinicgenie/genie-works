import { SeoGroupPage } from "@/components/modules/seo/SeoGroupPage";
import type { SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO setup and local presence" };

export default function SeoSetupGroupPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  return <SeoGroupPage group="setup" searchParams={searchParams} />;
}
