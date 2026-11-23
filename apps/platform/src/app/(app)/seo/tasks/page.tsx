import Link from "next/link";
import { addDays, canEditClient, formatDateTime, listCompletedTasks, listRecommendations, listSeoIssues, setupChecklist, todaySgt, UNRESOLVED_ISSUE_STATUSES } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Table, Td, Th } from "@/components/ui/Table";
import { SeoFrame } from "@/components/modules/seo/SeoFrame";
import { DemoNote } from "@/components/modules/seo/OverviewPanels";
import { acceptRecommendationAction, dismissRecommendationAction, moveSeoIssueAction, recordSetupReviewAction, refreshRecommendationsAction, verifySeoIssueAction } from "@/app/actions/seo-work";
import { findingLabel } from "@/lib/technical-seo-view";
import { loadSeoContext, queryText, selectedTab, seoHref, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checklist and tasks" };

const TABS = [
  ["setup", "Setup"],
  ["issues", "Issues"],
  ["recommendations", "Recommendations"],
  ["completed", "Completed"],
] as const;

const ISSUE_STATE: Record<string, [string, Tone]> = {
  open: ["Open", "bad"],
  investigating: ["In progress", "warn"],
  resolved_pending_verification: ["Ready to verify", "info"],
  verified_closed: ["Resolved", "good"],
  reopened: ["Reopened", "bad"],
};

const NOTICES: Record<string, string> = {
  denied: "That action needs edit access to this website.",
  invalid: "That change was not saved.",
  review_saved: "The review is recorded.",
  issue_started: "The issue is in progress.",
  issue_ready: "The issue is ready to verify. It still counts as unresolved until it is verified.",
  issue_verified: "The issue is verified and resolved.",
  suggestions_found: "Suggestions were refreshed from the current evidence.",
  task_created: "A task was created and linked.",
  task_exists: "This suggestion already has a linked task; no second task was created.",
  dismissed: "The suggestion is dismissed. The decision is kept.",
};

export default async function SeoTasksPage({ searchParams }: { searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const query = await searchParams;
  const ctx = await loadSeoContext(access, query);
  const tab = selectedTab(queryText(query, "tab"), TABS, "setup");
  const site = ctx.selected;
  const canEdit = Boolean(site && canEditClient(access, site.clientId));
  const days = [7, 30, 90].includes(Number(queryText(query, "days"))) ? Number(queryText(query, "days")) : 30;
  const end = todaySgt();
  const start = addDays(end, 1 - days);
  // SEO-02 (D65): every list is scoped to the selected website and environment.
  const data = site && !ctx.demo
    ? await staffTx(access, async (db) => ({
      checklist: tab === "setup" ? await setupChecklist(db, { id: site.id, clientId: site.clientId }) : null,
      issues: tab === "issues" ? await listSeoIssues(db, site.id) : [],
      recommendations: tab === "recommendations" ? await listRecommendations(db, site.id) : [],
      completed: tab === "completed" ? await listCompletedTasks(db, { websiteId: site.id, start, end }) : [],
    }))
    : null;
  const notice = queryText(query, "notice");
  const reason = queryText(query, "reason");
  const hidden = site ? <input type="hidden" name="websiteId" value={site.id} /> : null;
  const unresolved = data?.issues.filter((issue) => (UNRESOLVED_ISSUE_STATUSES as readonly string[]).includes(issue.status)).length ?? 0;
  const newCount = data?.recommendations.filter((rec) => rec.status === "new").length ?? 0;
  return (
    <SeoFrame ctx={ctx} pathname="/seo/tasks" title="Checklist & Tasks" description="Setup progress, problems found by website checks, suggestions from stored evidence, and finished work for this website." tabs={TABS} currentTab={tab}>
      {notice && NOTICES[notice] && <div className="mb-4"><Notice tone="neutral">{NOTICES[notice]}{reason ? ` ${reason}` : ""}</Notice></div>}
      {ctx.demo ? <DemoNote>Setup, issues, recommendations and completed rows are not loaded from a clinic.</DemoNote> : !site || !data ? null : tab === "setup" && data.checklist ? (
        <Card>
          <CardHeader
            title={`Setup progress: ${data.checklist.done}/${data.checklist.total}`}
            description="Each step needs its own evidence: a recorded staff review, or a successful connection or sitemap check."
            action={data.checklist.next ? <LinkButton href={data.checklist.next.href} size="sm">Continue setup</LinkButton> : <Badge tone="good">Setup complete</Badge>}
          />
          <ol className="divide-y divide-line">
            {data.checklist.steps.map((step, index) => (
              <li key={step.key} className="space-y-2 px-5 py-4 text-sm" data-step={step.key} data-complete={step.complete ? "yes" : "no"}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{index + 1}. {step.title}</span>
                  <Badge tone={step.complete ? "good" : "neutral"}>{step.complete ? "Complete" : "Not complete"}</Badge>
                  <Link href={step.href} className="text-action hover:underline">Open</Link>
                </div>
                <p className="text-muted">{step.rule}</p>
                {step.complete && step.evidenceAt && <p>Evidence: {step.evidence} · {formatDateTime(step.evidenceAt)}</p>}
                {step.review && canEdit && (
                  <form action={recordSetupReviewAction} className="flex flex-wrap items-end gap-2">
                    {hidden}
                    <input type="hidden" name="step" value={step.key} />
                    <Field label="Review note (optional)" htmlFor={`note-${step.key}`}>
                      <Input id={`note-${step.key}`} name="note" maxLength={500} />
                    </Field>
                    <Button type="submit" variant="secondary" size="sm">{step.complete ? "Record a new review" : "Record review"}</Button>
                  </form>
                )}
              </li>
            ))}
          </ol>
        </Card>
      ) : tab === "issues" ? (
        <Card>
          <CardHeader title={`Unresolved issues: ${unresolved}`} description="Problems found by website checks. An issue stays unresolved until a fix is verified by a later check or a recorded verification; a later check that finds the defect again reopens it." />
          {data.issues.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No website check has found an issue on this website.</p> : (
            <ul className="divide-y divide-line">
              {data.issues.map((issue) => {
                const [label, tone] = ISSUE_STATE[issue.status] ?? [issue.status, "neutral"];
                return (
                  <li key={issue.id} className="space-y-2 px-5 py-4 text-sm" data-issue={issue.id} data-status={issue.status}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone}>{label}</Badge>
                      <span className="font-medium">{findingLabel(issue.checkType)}</span>
                      <span className="break-all font-mono">{issue.pagePath}</span>
                      {issue.reopenCount > 0 && <span className="text-muted">Reopened {issue.reopenCount} time(s)</span>}
                    </div>
                    <p className="text-muted">Source: {issue.source} · first found {formatDateTime(issue.firstSeenAt)} · last found {formatDateTime(issue.lastSeenAt)} · owner {issue.ownerName ?? "unassigned"}</p>
                    {canEdit && (issue.status === "open" || issue.status === "reopened") && (
                      <form action={moveSeoIssueAction}>{hidden}<input type="hidden" name="issueId" value={issue.id} /><input type="hidden" name="to" value="investigating" /><Button type="submit" variant="secondary" size="sm">Start work</Button></form>
                    )}
                    {canEdit && (issue.status === "open" || issue.status === "investigating" || issue.status === "reopened") && (
                      <form action={moveSeoIssueAction} className="flex flex-wrap items-end gap-2">
                        {hidden}<input type="hidden" name="issueId" value={issue.id} /><input type="hidden" name="to" value="resolved_pending_verification" />
                        <Field label="What was changed" htmlFor={`fix-${issue.id}`}><Input id={`fix-${issue.id}`} name="note" required maxLength={500} /></Field>
                        <Button type="submit" variant="secondary" size="sm">Ready to verify</Button>
                      </form>
                    )}
                    {canEdit && issue.status === "resolved_pending_verification" && (
                      <div className="space-y-2">
                        {issue.recheckEvidence ? (
                          <form action={verifySeoIssueAction}>
                            {hidden}<input type="hidden" name="issueId" value={issue.id} /><input type="hidden" name="evidence" value="recheck" />
                            <Button type="submit" size="sm">Verify with recheck from {formatDateTime(issue.recheckEvidence.at)}</Button>
                          </form>
                        ) : <p className="text-muted">No website check has completed this page without the finding yet. Run a website check, or record a verification.</p>}
                        <form action={verifySeoIssueAction} className="flex flex-wrap items-end gap-2">
                          {hidden}<input type="hidden" name="issueId" value={issue.id} /><input type="hidden" name="evidence" value="recorded" />
                          <Field label="Recorded verification" htmlFor={`verify-${issue.id}`}><Input id={`verify-${issue.id}`} name="note" required maxLength={500} placeholder="What you checked and what you saw" /></Field>
                          <Button type="submit" variant="secondary" size="sm">Verify fix</Button>
                        </form>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : tab === "recommendations" ? (
        <Card>
          <CardHeader
            title={`New suggestions: ${newCount}`}
            description="Suggestions come from stored evidence: live page checks, Google inspections, sitemap checks, the AI access check and branch mappings. Accepting creates one linked task; a decision is kept."
            action={canEdit ? <form action={refreshRecommendationsAction}>{hidden}<Button type="submit" variant="secondary" size="sm">Find suggestions</Button></form> : undefined}
          />
          {data.recommendations.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No suggestion is stored for this website.</p> : (
            <ul className="divide-y divide-line">
              {data.recommendations.map((rec) => (
                <li key={rec.id} className="space-y-1 px-5 py-4 text-sm" data-recommendation={rec.kind} data-status={rec.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={rec.status === "new" ? "info" : rec.status === "task_created" ? "good" : "neutral"}>{rec.status === "new" ? "New" : rec.status === "task_created" ? "Task created" : "Dismissed"}</Badge>
                    <span className="font-medium">{rec.title}</span>
                  </div>
                  <p>Affected: {rec.affectedHref ? <Link href={rec.affectedHref} className="text-action hover:underline">{rec.affected}</Link> : rec.affected}</p>
                  <p className="text-muted">Evidence: {rec.evidence}</p>
                  <p className="text-muted">Proposed action: {rec.proposedAction}</p>
                  {rec.status === "task_created" && rec.taskId && <p>Decision: task created by {rec.decidedByName ?? "a staff member"} {rec.decidedAt ? formatDateTime(rec.decidedAt) : ""} · <Link href={`/tasks/${rec.taskId}`} className="text-action hover:underline">Open task</Link> ({rec.taskStatus})</p>}
                  {rec.status === "dismissed" && <p>Decision: dismissed by {rec.decidedByName ?? "a staff member"} {rec.decidedAt ? formatDateTime(rec.decidedAt) : ""}{rec.dismissReason ? ` · ${rec.dismissReason}` : ""}</p>}
                  {canEdit && rec.status !== "dismissed" && (
                    <div className="flex flex-wrap items-end gap-2 pt-1">
                      <form action={acceptRecommendationAction}>{hidden}<input type="hidden" name="recommendationId" value={rec.id} /><Button type="submit" size="sm">{rec.status === "task_created" ? "Accept (task exists)" : "Accept and create task"}</Button></form>
                      {rec.status === "new" && (
                        <form action={dismissRecommendationAction} className="flex flex-wrap items-end gap-2">
                          {hidden}<input type="hidden" name="recommendationId" value={rec.id} />
                          <Field label="Reason (optional)" htmlFor={`reason-${rec.id}`}><Input id={`reason-${rec.id}`} name="reason" maxLength={300} /></Field>
                          <Button type="submit" variant="ghost" size="sm">Dismiss</Button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`Completed tasks: ${data.completed.length}`}
            description={`Tasks finished from ${start} to ${end} (Asia/Singapore) that are linked to this website. A reopened task is not counted.`}
            // D79: the SEO Work report (formerly under Reports) belongs with Checklist & Tasks.
            action={<LinkButton href={seoHref("/seo/reports", ctx, { tab: "work" })} variant="secondary" size="sm">SEO Work report</LinkButton>}
          />
          <form method="get" className="flex flex-wrap items-end gap-2 px-5 pb-4">
            <input type="hidden" name="website" value={site.id} />
            <input type="hidden" name="tab" value="completed" />
            <Field label="Period" htmlFor="completed-days">
              <Select id="completed-days" name="days" defaultValue={String(days)}>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </Select>
            </Field>
            <Button type="submit" variant="secondary" size="sm">Apply</Button>
          </form>
          {data.completed.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">No linked task was completed in this period.</p> : (
            <Table caption="Completed tasks">
              <thead><tr><Th>Completed</Th><Th>Task</Th><Th>State</Th><Th>Responsible</Th><Th>Linked to</Th></tr></thead>
              <tbody>
                {data.completed.map((task) => (
                  <tr key={task.id} data-task={task.id}>
                    <Td>{formatDateTime(task.completedAt)}</Td>
                    <Td><Link href={`/tasks/${task.id}`} className="text-action hover:underline">{task.title}</Link></Td>
                    <Td>Completed</Td>
                    <Td>{task.ownerName ?? "Unassigned"}</Td>
                    <Td className="break-all">{task.linkedLabel}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </SeoFrame>
  );
}
