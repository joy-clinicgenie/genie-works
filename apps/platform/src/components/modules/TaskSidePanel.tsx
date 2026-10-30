"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { saveLaunchTaskAction } from "@/app/actions/tasks";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/Field";

const STATUS_LABELS: Record<string, string> = {
  open: "To do",
  in_progress: "In progress",
  waiting: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export interface TaskPanelTask {
  id: string;
  title: string;
  description: string | null;
  clientLabel: string;
  ownerName: string;
  ownerUserId: string;
  priority: string;
  dueDate: string | null;
  status: string;
  referenceUrl: string | null;
  createdBy: string;
  createdOn: string;
  updatedOn: string;
}

export function TaskSidePanel({
  closeHref,
  returnTo,
  notice,
  canEdit,
  task,
  owners,
}: {
  closeHref: string;
  returnTo: string;
  notice?: string;
  canEdit: boolean;
  task: TaskPanelTask;
  owners: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveLaunchTaskAction, null);
  const err = (field: string) => (state && !state.ok && state.field === field ? state.error : null);
  const banner = state && !state.ok && state.field ? null : state;
  const failed = state && !state.ok;
  const closed = task.status === "completed" || task.status === "cancelled";
  const ownerOptions = owners.some((owner) => owner.id === task.ownerUserId) ? owners : [{ id: task.ownerUserId, name: task.ownerName }, ...owners];
  const priorities = task.priority === "critical" ? ["low", "medium", "high", "critical"] : ["low", "medium", "high"];
  const statuses = task.status === "cancelled" ? ["cancelled", "open", "in_progress", "waiting", "completed"] : ["open", "in_progress", "waiting", "completed"];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") router.push(closeHref);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeHref, router]);

  return (
    <div className="fixed inset-0 z-40">
      <Link href={closeHref} scroll={false} className="absolute inset-0 bg-ink/40" aria-label="Close task" />
      <aside role="dialog" aria-modal="true" aria-labelledby="task-panel-title" className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-surface shadow-pop">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{task.clientLabel}</p>
            <h2 id="task-panel-title" className="text-lg font-semibold leading-tight text-ink">{task.title}</h2>
          </div>
          <Link href={closeHref} scroll={false} className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-brand-pale" aria-label="Close task">
            <X className="size-5" aria-hidden="true" />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {notice && !failed && <p role="status" className="mb-4 rounded-xl bg-good-bg px-3 py-2 text-sm text-good">{notice}</p>}
          {canEdit ? (
            <form action={action} className="space-y-4">
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Field label="Task title" htmlFor="panel-title" required error={err("title")}>
                <Input id="panel-title" name="title" required maxLength={200} defaultValue={task.title} />
              </Field>
              <Field label="Description" htmlFor="panel-description">
                <Textarea id="panel-description" name="description" maxLength={4000} defaultValue={task.description ?? ""} placeholder="Explain what needs to be done" />
              </Field>
              <Field label="Assigned to" htmlFor="panel-owner" required error={err("ownerUserId")}>
                <Select id="panel-owner" name="ownerUserId" defaultValue={task.ownerUserId} required>
                  {ownerOptions.map((owner) => (
                    <option key={owner.id} value={owner.id}>{owner.name}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Priority" htmlFor="panel-priority" required error={err("priority")}>
                  <Select id="panel-priority" name="priority" defaultValue={task.priority} required>
                    {priorities.map((priority) => (
                      <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due date" htmlFor="panel-due" error={err("dueDate")}>
                  <Input id="panel-due" name="dueDate" type="date" defaultValue={task.dueDate ?? ""} />
                </Field>
              </div>
              <Field label="Status" htmlFor="panel-status" required error={err("status")}>
                <Select id="panel-status" name="status" defaultValue={task.status} required>
                  {statuses.map((status) => (
                    <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference link" htmlFor="panel-reference" error={err("referenceUrl")}>
                <Input id="panel-reference" name="referenceUrl" type="url" inputMode="url" maxLength={2000} defaultValue={task.referenceUrl ?? ""} placeholder="Link to a document or relevant page" />
              </Field>
              <FormError state={banner} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="intent" value="save" disabled={pending}>Save</Button>
                {closed ? (
                  <Button type="submit" name="intent" value="reopen" variant="secondary" disabled={pending}>Reopen</Button>
                ) : (
                  <Button type="submit" name="intent" value="complete" variant="secondary" disabled={pending}>Mark completed</Button>
                )}
              </div>
            </form>
          ) : (
            <dl className="space-y-3 text-sm">
              <Detail label="Description" value={task.description || "No description"} />
              <Detail label="Assigned to" value={task.ownerName} />
              <Detail label="Priority" value={PRIORITY_LABELS[task.priority] ?? task.priority} />
              <Detail label="Due date" value={task.dueDate || "No due date"} />
              <Detail label="Status" value={STATUS_LABELS[task.status] ?? task.status} />
              {task.referenceUrl && (
                <div>
                  <dt className="text-xs font-medium text-muted">Reference link</dt>
                  <dd className="mt-0.5"><a href={task.referenceUrl} className="text-action hover:underline break-all" target="_blank" rel="noreferrer">{task.referenceUrl}</a></dd>
                </div>
              )}
            </dl>
          )}
          <dl className="mt-6 space-y-2 border-t border-line pt-4 text-sm">
            <Detail label="Created by" value={task.createdBy} />
            <Detail label="Created on" value={task.createdOn} />
            <Detail label="Last updated" value={task.updatedOn} />
          </dl>
        </div>
      </aside>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-ink">{value}</dd>
    </div>
  );
}
