import { requireAccess } from "@/lib/session";
import { SeoFrame } from "@/components/modules/seo/SeoFrame";
import { TOOL_GROUPS, ToolGroupContent, type ToolGroup } from "@/components/modules/seo/SeoAssistant";
import { loadSeoContext, type SeoSearch } from "@/lib/seo-workspace";

/** The page a sidebar group opens (D79): its tools and its other pages, for the selected website. */
export async function SeoGroupPage({ group: key, searchParams }: { group: ToolGroup["key"]; searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const ctx = await loadSeoContext(access, await searchParams);
  const group = TOOL_GROUPS.find((item) => item.key === key)!;
  return (
    <SeoFrame ctx={ctx} pathname={`/seo/${key}`} title={group.title} description={group.description}>
      <ToolGroupContent ctx={ctx} group={group} />
    </SeoFrame>
  );
}
