import { SeoGroupPage } from "@/components/modules/seo/SeoGroupPage";
import type { SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI visibility" };

export default function SeoAiGroupPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  return <SeoGroupPage group="ai" searchParams={searchParams} />;
}
