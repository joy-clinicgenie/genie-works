import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Drawer } from "@/components/ui/Drawer";
import { Button, LinkButton, buttonClass } from "@/components/ui/Button";
import { todaySgt } from "@clinic-genie/db";
import { completedSince, googleQuery, seoHref, type GoogleControls, type SearchConsoleConnection, type SeoContext, type WebsiteSeoBundle } from "@/lib/seo-workspace";
import { HiddenSeoContext, Unavailable } from "@/components/modules/seo/SeoFrame";

const RANGES = [
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["custom", "Custom"],
] as const;

const METRICS = [
  ["clicks", "Clicks"],
  ["impressions", "Impressions"],
  ["ctr", "CTR"],
  ["position", "Average position"],
] as const;

function controlHref(ctx: SeoContext, controls: GoogleControls, patch: Partial<GoogleControls>) {
  return seoHref("/seo", ctx, googleQuery({ ...controls, ...patch }));
}

export function AssistantPanel({ ctx, bundle, demo = false }: { ctx: SeoContext; bundle: WebsiteSeoBundle | null; demo?: boolean }) {
  const checks = bundle?.checks ?? [];
  const attention = checks.filter((check) => check.status === "attention").length;
  const issues = bundle?.pages.filter((page) => page.mapping_flag !== "none").length ?? 0;
  const today = todaySgt();
  const recommendations = bundle?.pages.filter((page) => page.mapping_flag === "none" && (page.content_status === "needs_update" || (page.next_review_on !== null && page.next_review_on < today))).length ?? 0;
  const banner = demo
    ? "Demo data. Complete 4 setup checks before launch. These are not clinic records."
    : !bundle
    ? "Website checks have not been run yet."
    : attention > 0
      ? `Complete ${attention} setup records before launch. Website checks have not been run yet.`
      : issues > 0
        ? `${issues} staff-recorded mapping issues need attention. Website checks have not been run yet.`
        : recommendations > 0
          ? `Saved setup records are present. ${recommendations} recommendations remain. Website checks have not been run yet.`
          : "Website checks have not been run yet.";
  const cells = demo
    ? [
        ["Setup checklist", "4 of 6", "Demo data. Not a saved clinic checklist.", "setup"],
        ["Issues", "3", "Demo data. Not unresolved clinic findings.", "issues"],
        ["Recommendations", "2", "Demo data. Not open clinic suggestions.", "recommendations"],
        ["Completed tasks", "5", "Demo data. A fictional count for the last 30 days.", "completed"],
      ] as const
    : [
        ["Setup checklist", bundle ? `${checks.length - attention} of ${checks.length}` : "Not selected", "Saved records, not a scan", "setup"],
        ["Issues", bundle ? String(issues) : "Unavailable", "Unresolved mapping findings", "issues"],
        ["Recommendations", bundle ? String(recommendations) : "Unavailable", "Review and update reminders", "recommendations"],
        ["Completed tasks", bundle ? String(bundle.changes.filter((change) => change.verification_on && change.verification_on >= completedSince(today)).length) : "Unavailable", "Verified change records in the last 30 days", "completed"],
      ] as const;
  return (
    <Card>
      <CardHeader title="SEO Assistant" description="Complete setup, fix issues and follow recommendations for this website." action={<Link href={seoHref("/seo/tasks", ctx, { tab: "setup" })} className="text-sm font-medium text-action hover:underline">View all tasks</Link>} />
      <div className="space-y-4 px-5 pb-5">
        <div className="rounded-2xl bg-brand-pale px-4 py-3 text-sm text-ink">{banner}</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cells.map(([title, value, detail, tab]) => (
            <Link key={tab} href={seoHref("/seo/tasks", ctx, { tab })} className="rounded-2xl border border-line p-4 hover:bg-brand-pale/40">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{title}</div>
              <div className="mt-2 text-2xl font-semibold">{value}</div>
              <p className="mt-1 text-xs text-muted">{detail}</p>
            </Link>
          ))}
        </div>
        <p className="text-xs text-muted">Last website check: not run. These counts use saved records only.</p>
      </div>
    </Card>
  );
}

export function GooglePanel({ ctx, controls, search = null, demo = false }: { ctx: SeoContext; controls: GoogleControls; search?: SearchConsoleConnection | null; demo?: boolean }) {
  const report = seoHref("/seo/reports", ctx, { tab: "google-search", ...googleQuery(controls) });
  const consoleHref = "https://search.google.com/search-console";
  const metricLabel = METRICS.find(([id]) => id === controls.metric)?.[1] ?? "Clicks";
  const chip = (active: boolean) => buttonClass(active ? "primary" : "secondary", "sm");
  const property = !demo && search?.status === "connected" ? search.propertyId : null;
  return (
    <Card>
      <CardHeader
        title="Site performance on Google"
        description={demo ? "Demonstration layout only. Search Console is not the source of these labels." : property ? `Connected to ${property}. Controls choose the report context. Stored search figures appear after a sync.` : "Search Console is not connected. Controls choose the report context and do not invent results."}
        action={demo ? <Badge tone="warn">Demo data</Badge> : <Badge tone={property ? "good" : "neutral"}>{property ? "Connected" : "Not connected"}</Badge>}
      />
      <div className="space-y-4 px-5 pb-5">
        <p className="text-xs text-muted">{property ? `Verified property: ${property}.` : "Verified property: not connected."} Latest Google reporting date: unavailable.</p>
        <div className="flex flex-wrap gap-2">
          {RANGES.map(([id, label]) => <Link key={id} href={controlHref(ctx, controls, { range: id })} aria-current={controls.range === id ? "true" : undefined} className={chip(controls.range === id)}>{label}</Link>)}
        </div>
        {controls.range === "custom" && (
          <form method="get" action="/seo" className="flex flex-wrap items-end gap-3">
            <HiddenSeoContext ctx={ctx} extra={{ range: "custom", metric: controls.metric, record: controls.record, direction: controls.direction, changeMetric: controls.changeMetric }} />
            <label className="text-xs text-muted">From <input name="from" type="date" defaultValue={controls.from} className="mt-1 block min-h-10 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink" /></label>
            <label className="text-xs text-muted">To <input name="to" type="date" defaultValue={controls.to} className="mt-1 block min-h-10 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink" /></label>
            <Button type="submit" variant="secondary" size="sm">Apply custom dates</Button>
          </form>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {METRICS.map(([id, label]) => (
            <Link key={id} href={controlHref(ctx, controls, { metric: id })} aria-current={controls.metric === id ? "true" : undefined} className={`rounded-2xl border p-3 ${controls.metric === id ? "border-action bg-brand-pale" : "border-line"}`}>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</div>
              <div className="mt-1 text-xl font-semibold">{demo ? (controls.metric === id ? "120" : "—") : "Unavailable"} {demo && <Badge tone="warn">Demo data</Badge>}</div>
              <p className="mt-1 text-xs text-muted">{id === "position" ? "A lower average position usually means a better ranking. It does not use the same rise-and-fall rule as clicks." : "No comparison with the previous equivalent period is available."}</p>
            </Link>
          ))}
        </div>
        <div className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
          {demo ? <span><Badge tone="warn">Demo data</Badge> Fictional {metricLabel.toLowerCase()} for the selected control: 120, compared with 98 in the previous period. This is not a Search Console result. A lower average position would not use the same direction as clicks.</span> : `No ${metricLabel.toLowerCase()} trend is available. Google has not provided a reporting date.`}
        </div>
        <div className="flex flex-wrap gap-2">
          {(["pages", "queries"] as const).map((record) => <Link key={record} href={controlHref(ctx, controls, { record })} aria-current={controls.record === record ? "true" : undefined} className={chip(controls.record === record)}>{record === "pages" ? "Pages" : "Queries"}</Link>)}
          {(["increased", "decreased"] as const).map((direction) => <Link key={direction} href={controlHref(ctx, controls, { direction })} aria-current={controls.direction === direction ? "true" : undefined} className={chip(controls.direction === direction)}>{direction === "increased" ? "Increased" : "Decreased"}</Link>)}
          {(["clicks", "impressions"] as const).map((changeMetric) => <Link key={changeMetric} href={controlHref(ctx, controls, { changeMetric })} aria-current={controls.changeMetric === changeMetric ? "true" : undefined} className={chip(controls.changeMetric === changeMetric)}>{changeMetric === "clicks" ? "Clicks" : "Impressions"}</Link>)}
        </div>
        {demo ? (
          <ul className="space-y-2 text-sm">
            {["Demo page /demo-page", "Demo query: example treatment", "Demo page /demo-contact", "Demo query: example clinic", "Demo page /demo-team"].map((row) => (
              <li key={row}><Badge tone="warn">Demo data</Badge> {row}. Absolute change and period total are fictional.</li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No significant page or query changes are available.</p>}
        <div className="flex flex-wrap gap-4">
          <Link href={report} className="text-sm font-medium text-action hover:underline">View full report</Link>
          <a href={consoleHref} target="_blank" rel="noreferrer" className="text-sm font-medium text-action hover:underline">Open Google Search Console</a>
        </div>
      </div>
    </Card>
  );
}

export function AiPanel({ ctx }: { ctx: SeoContext }) {
  const rows = [
    ["Last crawler activity", "A recognised crawler accessing a public URL. No crawler log is connected.", "/seo/reports", "crawler"],
    ["AI retrieval activity", "Requests classified as retrieval activity. This is not a count of user questions.", "/seo/reports", "ai-traffic"],
    ["AI referral sessions", "Visitor sessions referred by an AI service. Analytics is not supplying this source.", "/seo/reports", "ai-traffic"],
    ["Latest visibility test", "A saved sample of questions and answers. No test provider is connected.", "/seo/ai-visibility", "visibility"],
  ] as const;
  return (
    <Card>
      <CardHeader title="AI Visibility" description="Crawler visits, retrieval requests, referral sessions and answer tests stay separate." action={<Badge>Not connected</Badge>} />
      <ul className="space-y-3 px-5 pb-5">
        {rows.map(([title, detail, path, tab]) => (
          <li key={title} className="rounded-2xl border border-line p-3">
            <div className="text-sm font-semibold">{title}</div>
            <p className="mt-1 text-xs text-muted">{detail}</p>
            <Link href={seoHref(path, ctx, { tab })} className="mt-2 inline-block text-xs font-medium text-action hover:underline">View detail</Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function QuickActions({ ctx }: { ctx: SeoContext }) {
  const actions = [
    ["Edit page SEO", seoHref("/seo/pages", ctx, { tab: "pages" })],
    ["Review image descriptions", seoHref("/seo/pages", ctx, { tab: "images" })],
    ["Add a redirect", seoHref("/seo/redirects", ctx, { tab: "redirects", new: "1" })],
    ["Open Google Business Profile", seoHref("/seo/business-profile", ctx, { tab: "locations" })],
  ] as const;
  return (
    <Card>
      <CardHeader title="Quick actions" description="Each action opens the existing destination." />
      <div className="grid gap-2 px-5 pb-5 sm:grid-cols-2">
        {actions.map(([label, href]) => <LinkButton key={label} href={href} variant="secondary">{label}</LinkButton>)}
      </div>
    </Card>
  );
}

export function RecentChanges({ ctx, bundle }: { ctx: SeoContext; bundle: WebsiteSeoBundle }) {
  return (
    <Card>
      <CardHeader title="Recent changes" description="Saved SEO change records. They are not a live publication log." action={<Link href={seoHref("/seo/settings", ctx, { tab: "publishing" })} className="text-sm text-action hover:underline">Publishing and history</Link>} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Recent SEO changes</caption>
          <thead><tr className="border-b border-line text-left text-xs uppercase tracking-[0.12em] text-muted"><th className="px-5 py-3">Date</th><th className="px-5 py-3">Page or setting</th><th className="px-5 py-3">Change</th><th className="px-5 py-3">Staff member</th><th className="px-5 py-3">Status</th></tr></thead>
          <tbody>
            {bundle.changes.length === 0 && <tr><td colSpan={5} className="px-5 py-4 text-muted">No change records for this website.</td></tr>}
            {bundle.changes.slice(0, 8).map((change) => (
              <tr key={change.id} className="border-b border-line/70">
                <td className="px-5 py-3 whitespace-nowrap">{change.changed_on}</td>
                <td className="px-5 py-3"><Link href={seoHref(`/seo/pages/${change.seo_page_id}`, ctx)} className="text-action hover:underline">{change.page_path}</Link></td>
                <td className="px-5 py-3">{change.change_type.replaceAll("_", " ")}</td>
                <td className="px-5 py-3">{change.changed_by_name}</td>
                <td className="px-5 py-3">{change.verification_on ? "Verified" : change.approval_id ? "Approved" : "Draft"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function FindingDetail({ title, found, matters, fix, editor, evidence, closeHref }: { title: string; found: string; matters: string; fix: string; editor?: ReactNode; evidence: string; closeHref: string }) {
  return (
    <Drawer title={title} closeHref={closeHref} eyebrow="Finding">
      <dl className="space-y-4 text-sm">
        <div><dt className="font-semibold">What was found</dt><dd className="mt-1 text-muted">{found}</dd></div>
        <div><dt className="font-semibold">Why it matters</dt><dd className="mt-1 text-muted">{matters}</dd></div>
        <div><dt className="font-semibold">How to fix it</dt><dd className="mt-1 text-muted">{fix}</dd></div>
        <div><dt className="font-semibold">Relevant editor</dt><dd className="mt-1">{editor ?? "No editor is available for this record."}</dd></div>
        <div><dt className="font-semibold">Evidence and history</dt><dd className="mt-1 text-muted">{evidence}</dd></div>
      </dl>
    </Drawer>
  );
}

export function DemoNote({ children }: { children: ReactNode }) {
  return <Unavailable title="Demo data">{children} Nothing on this screen is saved, crawled or sent to Google.</Unavailable>;
}
