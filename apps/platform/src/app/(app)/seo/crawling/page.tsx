import { SeoGroupPage } from "@/components/modules/seo/SeoGroupPage";
import type { SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Crawling and indexing" };

export default function SeoCrawlingGroupPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  return <SeoGroupPage group="crawling" searchParams={searchParams} />;
}
