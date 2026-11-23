import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatDateTime, type ChecklistHealth } from "@clinic-genie/db";
import { seoHref, type SeoContext } from "@/lib/seo-workspace";
import { SEO_SECTIONS, type SeoSectionKey } from "@/lib/seo-sections";

/* SEO Overview dashboard (D74): the SEO Assistant panel, then Tools and settings. Every figure is the selected
   website's own, from the loader Checklist & Tasks reads, and every link keeps the website and environment. */

/** Circular setup progress. The percentage is written in the centre, so the ring never carries meaning alone. */
export function ProgressRing({ percent, size = 112 }: { percent: number | null; size?: number }) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} data-setup-ring>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-white" />
        {filled > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(filled / 100) * circumference} ${circumference}`}
            className="stroke-action"
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-2xl font-semibold num text-ink" data-value>
        {percent === null ? "–" : `${percent}%`}
      </span>
    </div>
  );
}

function CountColumn({ value, label, href, id }: { value: number; label: string; href: string; id: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-24 min-w-0 flex-col items-center justify-center rounded-2xl bg-white/90 px-1 py-3 text-center sm:px-2 transition-colors hover:bg-white hover:shadow-[0_4px_12px_-4px_rgba(23,60,64,0.15)]"
      data-count={id}
    >
      <span className="text-3xl font-semibold num text-ink" data-value>{value}</span>
      <span className="mt-1 max-w-full text-xs font-medium leading-snug text-action hyphens-auto sm:text-sm">{label}</span>
    </Link>
  );
}

export function SeoAssistantPanel({ ctx, health }: { ctx: SeoContext; health: ChecklistHealth }) {
  const tasks = (tab: string, extra: Record<string, string> = {}) => seoHref("/seo/tasks", ctx, { tab, ...extra });
  const { counts } = health;
  const percent = counts.setupTotal > 0 ? health.setupPercent : null;
  const setupText = counts.setupTotal > 0
    ? `${counts.setupDone} of ${counts.setupTotal} setup steps complete`
    : "No setup step applies to this website.";
  return (
    <section className="card" aria-labelledby="seo-assistant-title" data-seo-assistant>
      <header className="flex items-center justify-between gap-4 px-5 pt-3 pb-1">
        <h2 id="seo-assistant-title" className="text-base font-semibold leading-tight tracking-tight">SEO Assistant</h2>
        <Link href={tasks("setup")} className="inline-flex min-h-11 items-center text-sm font-medium text-action hover:underline">View all tasks</Link>
      </header>
      <div className="grid gap-4 px-5 pb-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex items-center gap-5 rounded-[20px] bg-tint-aqua p-4" data-setup-checklist>
          <ProgressRing percent={percent} />
          <div className="min-w-0">
            <div className="text-base font-semibold">SEO Setup Checklist</div>
            <p className="mt-1 text-sm text-muted">{setupText}</p>
            <Link href={tasks("setup")} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-action hover:underline">
              Continue setup
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-[20px] bg-tint-mint p-2" data-task-counts>
          <CountColumn id="issues" value={counts.unresolvedIssues} label="Issues" href={tasks("issues")} />
          <CountColumn id="recommendations" value={counts.newRecommendations} label="Recommendations" href={tasks("recommendations")} />
          <CountColumn id="completed" value={counts.completedTasks} label="Completed tasks" href={tasks("completed", { days: String(health.completedWindow.days) })} />
        </div>
      </div>
      <p className="border-t border-line px-5 py-3 text-sm text-muted" data-last-updated>
        {health.lastUpdated ? <>Last updated {formatDateTime(health.lastUpdated)}</> : "Last updated: no activity recorded yet"}
      </p>
    </section>
  );
}

interface ToolLink {
  label: string;
  path: string;
  tab: string;
  anchor?: string;
}

export interface ToolGroup {
  key: Exclude<SeoSectionKey, "overview">;
  /** Matches the sidebar label exactly (D79). */
  title: string;
  description: string;
  tools: ReadonlyArray<ToolLink>;
  /** Other pages of the group, so every former sidebar destination stays reachable from its group page. */
  more: ReadonlyArray<ToolLink>;
}

/** Each row opens the tool's existing page and tab directly, so existing deep links keep working. */
export const TOOL_GROUPS: ReadonlyArray<ToolGroup> = [
  {
    key: "setup",
    title: "SEO setup & local presence",
    description: "Setup checklist and tasks, website-wide SEO settings and Google Business Profile branches.",
    tools: [
      { label: "SEO Setup Checklist", path: "/seo/tasks", tab: "setup" },
      { label: "SEO Settings", path: "/seo/settings", tab: "defaults" },
      { label: "Google Business Profile", path: "/seo/business-profile", tab: "locations" },
    ],
    more: [
      { label: "Issues", path: "/seo/tasks", tab: "issues" },
      { label: "Recommendations", path: "/seo/tasks", tab: "recommendations" },
      { label: "Completed tasks", path: "/seo/tasks", tab: "completed" },
      { label: "SEO Work report", path: "/seo/reports", tab: "work" },
      { label: "Publishing & History", path: "/seo/settings", tab: "publishing" },
      { label: "Access & Schedules", path: "/seo/settings", tab: "access" },
    ],
  },
  {
    key: "crawling",
    title: "Crawling & indexing",
    description: "What Google can find and index, how the site is verified, and whether old URLs redirect.",
    tools: [
      { label: "Site Inspection", path: "/seo/site-health", tab: "indexing" },
      { label: "Site Verification", path: "/seo/settings", tab: "connections", anchor: "connection-search" },
      { label: "Sitemaps", path: "/seo/site-health", tab: "crawl", anchor: "sitemaps" },
      { label: "Robots.txt", path: "/seo/site-health", tab: "crawl", anchor: "robots" },
      { label: "Redirect Checks", path: "/seo/redirects", tab: "redirects" },
    ],
    more: [
      { label: "Pages & Content", path: "/seo/pages", tab: "pages" },
      { label: "Website Checks", path: "/seo/site-health", tab: "checks" },
      { label: "Speed & Mobile", path: "/seo/site-health", tab: "speed" },
      { label: "Redirect Import & Export", path: "/seo/redirects", tab: "import" },
      { label: "Redirect Migration", path: "/seo/redirects", tab: "migration" },
      { label: "Website Connections", path: "/seo/settings", tab: "connections" },
    ],
  },
  {
    key: "ai",
    title: "AI visibility",
    description: "AI crawl activity for ChatGPT, Gemini and Claude, and the website's llms.txt and NLWeb endpoint.",
    tools: [
      { label: "AI crawl activity", path: "/seo/ai-visibility", tab: "visibility", anchor: "crawler-visits" },
      { label: "llms.txt", path: "/seo/ai-visibility", tab: "access", anchor: "llms" },
      { label: "NLWeb", path: "/seo/ai-visibility", tab: "access", anchor: "nlweb" },
    ],
    more: [
      { label: "Questions & Tests", path: "/seo/ai-visibility", tab: "questions" },
      { label: "Sources & Perception", path: "/seo/ai-visibility", tab: "sources" },
      { label: "AI Report", path: "/seo/reports", tab: "ai" },
    ],
  },
];

const GROUP_TINTS: Record<ToolGroup["key"], string> = { setup: "bg-tint-aqua", crawling: "bg-tint-mint", ai: "bg-tint-sky" };

function ToolRows({ ctx, tools }: { ctx: SeoContext; tools: ReadonlyArray<ToolLink> }) {
  return (
    <ul className="space-y-1.5">
      {tools.map((tool) => (
        <li key={tool.label}>
          <Link
            href={`${seoHref(tool.path, ctx, { tab: tool.tab })}${tool.anchor ? `#${tool.anchor}` : ""}`}
            className="flex min-h-12 items-center justify-between gap-3 rounded-2xl bg-white/95 px-4 py-2 text-sm font-medium text-ink shadow-[0_1px_2px_rgba(23,60,64,0.05)] transition-colors hover:bg-white hover:shadow-[0_4px_12px_-4px_rgba(23,60,64,0.15)]"
            data-tool={tool.label}
          >
            <span>{tool.label}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One tinted group column: a chip heading (the sidebar label, linking to the group page) over its tool rows. */
function GroupColumn({ ctx, group }: { ctx: SeoContext; group: ToolGroup }) {
  const page = SEO_SECTIONS.find((section) => section.key === group.key)!;
  return (
    // D75: each group is a pale tinted column with a chip header, holding white rows, after the board reference.
    <section className={`rounded-[22px] border border-white/80 p-2 ${GROUP_TINTS[group.key]}`} aria-labelledby={`tool-group-${group.key}`} data-tool-group={group.key}>
      <h3 id={`tool-group-${group.key}`} className="mb-2">
        <Link href={seoHref(page.path, ctx)} className="flex min-h-11 items-center justify-between gap-2 rounded-full bg-white/70 px-4 py-2 text-sm font-semibold hover:bg-white">
          <span className="flex items-center gap-2"><span aria-hidden="true" className="size-1.5 rounded-full bg-action" />{group.title}</span>
          <span className="grid min-w-6 place-items-center rounded-full bg-white px-2 text-xs font-semibold text-muted num">{group.tools.length}</span>
        </Link>
      </h3>
      <ToolRows ctx={ctx} tools={group.tools} />
    </section>
  );
}

/** SEO Overview's Tools and settings (D74, D79): the three groups, headed exactly as the sidebar. */
export function ToolsAndSettings({ ctx }: { ctx: SeoContext }) {
  return (
    <section aria-labelledby="seo-tools-title" data-seo-tools>
      <h2 id="seo-tools-title" className="mb-3 text-base font-semibold leading-tight tracking-tight">Tools and settings</h2>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {TOOL_GROUPS.map((group) => <GroupColumn key={group.key} ctx={ctx} group={group} />)}
      </div>
    </section>
  );
}

/** A group page (D79): the group's tools, then the group's other pages. Each row opens an existing page and tab. */
export function ToolGroupContent({ ctx, group }: { ctx: SeoContext; group: ToolGroup }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2" data-group-page={group.key}>
      <section className={`rounded-[22px] border border-white/80 p-3 ${GROUP_TINTS[group.key]}`} aria-labelledby="group-tools">
        <h2 id="group-tools" className="mb-2 px-2 text-sm font-semibold">Tools</h2>
        <ToolRows ctx={ctx} tools={group.tools} />
      </section>
      <section className="rounded-[22px] border border-white/80 bg-white/50 p-3" aria-labelledby="group-more">
        <h2 id="group-more" className="mb-2 px-2 text-sm font-semibold">Also in this group</h2>
        <ToolRows ctx={ctx} tools={group.more} />
      </section>
    </div>
  );
}
