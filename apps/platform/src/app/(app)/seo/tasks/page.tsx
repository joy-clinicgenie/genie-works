import Link from "next/link";
import { formatDate, formatDateTime, todaySgt } from "@clinic-genie/db";
import { TASK_PRIORITIES, TASK_STATUSES } from "@clinic-genie/contracts";
import { requireAccess } from "@/lib/session";
import { Badge, label } from "@/components/ui/Badge";
import { FilterBar, FilterInput, FilterSelect } from "@/components/ui/Filters";
import { SplitLayout } from "@/components/ui/Drawer";
import { SeoFrame } from "@/components/modules/seo/SeoFrame";
import { DemoNote, FindingDetail } from "@/components/modules/seo/OverviewPanels";
import { completedSince, loadSeoContext, loadWebsiteSeo, queryText, selectedTab, seoHref, type SeoSearch, type WebsiteSeoBundle } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checklist and tasks" };

const TABS = [
  ["setup", "Setup"],
  ["issues", "Issues"],
  ["recommendations", "Recommendations"],
  ["completed", "Completed"],
] as const;

interface WorkItem {
  id: string;
  tab: "issues" | "recommendations" | "completed";
  name: string;
  page: string;
  priority: string;
  owner: string;
  due: string | null;
  status: string;
  checked: string;
  found: string;
  matters: string;
  fix: string;
  editorHref: string | null;
  evidence: string;
}

function itemsFor(bundle: WebsiteSeoBundle, ctxClient: string): WorkItem[] {
  const today = todaySgt();
  const since = completedSince(today);
  const pages = bundle.pages.map((page): WorkItem => {
    const issue = page.mapping_flag !== "none";
    const recommendation = !issue && (page.content_status === "needs_update" || (page.next_review_on !== null && page.next_review_on < today));
    return {
      id: `page:${page.id}`,
      tab: issue ? "issues" : recommendation ? "recommendations" : "completed",
      name: issue ? `${label(page.mapping_flag)} mapping` : page.content_status === "needs_update" ? "Content needs an update" : "Review date",
      page: page.page_path,
      priority: issue ? "High" : "Medium",
      owner: page.owner_name ?? "Unassigned",
      due: page.next_review_on,
      status: label(page.content_status),
      checked: "Not checked by a crawl",
      found: page.flag_note || page.notes || "Recorded by staff on the page mapping.",
      matters: "The mapping tells staff which search the page is meant to serve. It is not a live index result.",
      fix: "Edit the mapping, then record what changed. A crawl cannot recheck it yet.",
      editorHref: `/seo/pages/${page.id}?edit=1&client=${ctxClient}&website=${page.website_id ?? ""}`,
      evidence: page.last_reviewed_on ? `Last staff review ${formatDate(page.last_reviewed_on)}.` : "No staff review date is recorded.",
    };
  }).filter((item) => item.tab !== "completed" || false);
  const pageItems = pages.filter((item) => item.tab === "issues" || item.tab === "recommendations");
  const tasks = bundle.tasks.map((task): WorkItem => ({
    id: `task:${task.id}`,
    tab: task.status === "completed" ? "completed" : "issues",
    name: task.title,
    page: task.related_title ?? "No page linked",
    priority: label(task.priority),
    owner: task.owner_name,
    due: task.due_date,
    status: label(task.status),
    checked: formatDateTime(task.updated_at),
    found: task.description ?? "No description recorded.",
    matters: "This is a staff task linked to SEO. Completing it does not prove a technical check passed.",
    fix: "Open the task to assign it or record progress.",
    editorHref: `/tasks/${task.id}`,
    evidence: task.completed_at ? `Completed ${formatDateTime(task.completed_at)}.` : "No completion evidence is stored on the task.",
  }));
  const changes = bundle.changes.filter((change) => change.verification_on && change.verification_on >= since).map((change): WorkItem => ({
    id: `change:${change.id}`,
    tab: "completed",
    name: label(change.change_type),
    page: change.page_path,
    priority: "Recorded",
    owner: change.verified_by_name ?? change.changed_by_name,
    due: change.verification_on,
    status: "Verified",
    checked: change.verification_on ? formatDate(change.verification_on) : "Not verified",
    found: change.reason,
    matters: "Verification here is a staff observation, not a new crawl.",
    fix: "Open the page history if the observation needs to be reviewed again.",
    editorHref: `/seo/pages/${change.seo_page_id}`,
    evidence: change.outcome_note ?? "No outcome note recorded.",
  }));
  return [...pageItems, ...tasks.filter((task) => task.tab === "issues" || task.tab === "completed"), ...changes];
}

export default async function SeoTasksPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const bundle = ctx.selected ? await loadWebsiteSeo(access, ctx.selected) : null;
  const tab = selectedTab(queryText(query, "tab"), TABS, "setup");
  const owner = queryText(query, "owner");
  const priority = queryText(query, "priority");
  const status = queryText(query, "status");
  const q = queryText(query, "q")?.toLowerCase();
  const selectedId = queryText(query, "item");
  const tabRows = bundle && tab !== "setup" ? itemsFor(bundle, ctx.selected!.clientId).filter((item) => item.tab === tab) : [];
  const rows = tabRows.filter((item) => {
    if (owner && item.owner !== owner) return false;
    if (priority && item.priority.toLowerCase() !== priority) return false;
    if (status && item.status.toLowerCase() !== status.replaceAll("_", " ")) return false;
    if (q && !`${item.name} ${item.page}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const open = rows.find((item) => item.id === selectedId);
  const closeHref = seoHref("/seo/tasks", ctx, { tab, owner, priority, status, q: queryText(query, "q") });
  const owners = [...new Set(tabRows.map((item) => item.owner))];
  return (
    <SeoFrame ctx={ctx} pathname="/seo/tasks" title="Checklist & Tasks" description="One queue for SEO setup and ongoing work. Automated checks have not been run." tabs={TABS} currentTab={tab}>
      {ctx.demo ? <DemoNote>Setup, issues, recommendations and completed rows are not loaded from a clinic.</DemoNote> : bundle && tab === "setup" ? (
        <section className="card p-5">
          <h2 className="font-semibold">Setup</h2>
          <p className="mt-1 text-sm text-muted">Ready means a saved record exists. Unverified means the platform has not checked Google, the live site or a crawler.</p>
          <ul className="mt-3 divide-y divide-line">
            {bundle.checks.map((check) => (
              <li key={check.title} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div><div className="text-sm font-medium">{check.title}</div><p className="text-sm text-muted">{check.detail}</p></div>
                <Badge tone={check.status === "attention" ? "warn" : check.status === "ready" ? "good" : "neutral"}>{check.status === "attention" ? "Setup needed" : check.status === "ready" ? "Ready" : "Not verified here"}</Badge>
              </li>
            ))}
          </ul>
          <Link href={seoHref("/seo/settings", ctx, { tab: "connections" })} className="mt-3 inline-block text-sm text-action hover:underline">Start setup in Connections</Link>
        </section>
      ) : bundle ? (
        <SplitLayout
          list={
            <>
              <FilterBar action="/seo/tasks" clearHref={seoHref("/seo/tasks", ctx, { tab })} formKey={`${tab}-${owner}-${priority}-${status}-${q}`}>
                <input type="hidden" name="client" value={ctx.client} />
                <input type="hidden" name="website" value={ctx.website} />
                <input type="hidden" name="tab" value={tab} />
                <FilterSelect name="owner" label="Owner" value={owner} options={owners.map((name) => ({ value: name, label: name }))} />
                <FilterSelect name="priority" label="Priority" value={priority} options={TASK_PRIORITIES.map((item) => ({ value: item, label: label(item) }))} />
                <FilterSelect name="status" label="Status" value={status} options={TASK_STATUSES.map((item) => ({ value: item, label: label(item) }))} />
                <FilterInput name="q" label="Search task or page" value={queryText(query, "q")} />
              </FilterBar>
              <p className="mb-3 text-xs text-muted">{tab === "completed" ? `Verified change records since ${completedSince()}, plus completed SEO tasks.` : "Last checked stays blank where no crawl has run. Repeated checks cannot create duplicates because no scanner is connected."}</p>
              <div className="overflow-x-auto card">
                <table className="w-full text-sm">
                  <caption className="sr-only">{tab} tasks</caption>
                  <thead><tr className="border-b border-line text-left text-xs uppercase tracking-[0.12em] text-muted"><th className="px-4 py-3">Task</th><th className="px-4 py-3">Affected page</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Last checked</th></tr></thead>
                  <tbody>
                    {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-4 text-muted">No records in this tab.</td></tr>}
                    {rows.map((item) => (
                      <tr key={item.id} className="border-b border-line/70">
                        <td className="px-4 py-3"><Link href={seoHref("/seo/tasks", ctx, { tab, item: item.id, owner, priority, status, q: queryText(query, "q") })} className="font-medium text-action hover:underline">{item.name}</Link></td>
                        <td className="px-4 py-3">{item.page}</td>
                        <td className="px-4 py-3">{item.priority}</td>
                        <td className="px-4 py-3">{item.owner}</td>
                        <td className="px-4 py-3">{item.due ? formatDate(item.due) : "Not set"}</td>
                        <td className="px-4 py-3">{item.status}</td>
                        <td className="px-4 py-3">{item.checked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          }
          detail={open ? (
            <FindingDetail
              title={open.name}
              found={open.found}
              matters={open.matters}
              fix={`${open.fix} Recheck is unavailable until a crawler exists. Not applicable decisions are not stored yet.`}
              editor={open.editorHref ? <Link href={open.editorHref} className="text-action hover:underline">{open.id.startsWith("task:") ? "Open task" : "Fix in the page editor"}</Link> : undefined}
              evidence={open.evidence}
              closeHref={closeHref}
            />
          ) : undefined}
        />
      ) : null}
    </SeoFrame>
  );
}
