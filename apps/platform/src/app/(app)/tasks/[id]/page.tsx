import Link from "next/link";
import { notFound } from "next/navigation";
import { canEditClient, formatDate, formatDateTime, getTask, listActiveStaff, relatedHref, todaySgt } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card, CardHeader, KeyValue } from "@/components/ui/Card";
import { Badge, PRIORITY_TONE, TASK_STATUS_TONE, label } from "@/components/ui/Badge";
import { TaskForm } from "@/components/modules/TaskForm";
import { RelatedPicker } from "@/components/modules/RelatedPicker";
import { TaskTransitionForm, TaskNoteForm } from "@/components/modules/TaskDetailForms";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ relatedType?: string; edit?: string }> }) {
  const access = await requireAccess();
  const { id } = await params;
  const { relatedType, edit } = await searchParams;
  const data = await staffTx(access, async (db) => {
    const task = await getTask(db, id);
    if (!task) return null;
    const owners = await listActiveStaff(db);
    const picker = task.client_id ? await RelatedPicker({ db, clientId: task.client_id, relatedType: relatedType ?? task.related_type, relatedId: task.related_id, refineHref: (t) => `/tasks/${id}?edit=1&relatedType=${t}` }) : null;
    return { task, owners, picker };
  });
  if (!data) notFound();
  const { task, owners, picker } = data;
  const today = todaySgt();
  const canEdit = task.client_id ? canEditClient(access, task.client_id) : access.user.platform_role !== "read_only";
  const canAct = (canEdit || task.owner_user_id === access.user.id) && access.user.platform_role !== "read_only";
  const closed = task.status === "completed" || task.status === "cancelled";
  const related = relatedHref(task.related_type, task.related_id);

  return (
    <>
      <PageHeader
        eyebrow={task.client_id ? <Link href={`/clients/${task.client_id}`} className="hover:underline">{task.client_name}</Link> : "Internal"}
        title={task.title}
        description={
          <span className="flex flex-wrap gap-2 items-center">
            <Badge tone={TASK_STATUS_TONE[task.status]}>{label(task.status)}</Badge>
            <Badge tone={PRIORITY_TONE[task.priority]}>{label(task.priority)}</Badge>
            {task.due_date && task.due_date < today && !closed && <Badge tone="bad">Overdue</Badge>}
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="p-5">
            <KeyValue
              items={[
                { label: "Accountable owner", value: task.owner_name },
                { label: "Due date", value: task.due_date ? formatDate(task.due_date) : null },
                { label: "Waiting on", value: task.status === "waiting" ? task.waiting_on : null },
                { label: "Follow-up date", value: task.status === "waiting" ? formatDate(task.follow_up_date) : null },
                { label: "Reference link", value: task.reference_url ? <a href={task.reference_url} className="text-action hover:underline break-all" target="_blank" rel="noreferrer">{task.reference_url}</a> : null },
                { label: "Related record", value: task.related_type ? (related ? <Link href={related} className="text-action hover:underline">{label(task.related_type)}: {task.related_title ?? task.related_id}</Link> : `${label(task.related_type)}: ${task.related_title}`) : null },
                { label: "Created", value: formatDateTime(task.created_at) },
                { label: "Completed", value: task.completed_at ? formatDateTime(task.completed_at) : null },
                { label: "Cancelled", value: task.cancelled_at ? formatDateTime(task.cancelled_at) : null },
              ]}
            />
            {task.description && <p className="text-sm mt-4 whitespace-pre-wrap">{task.description}</p>}
          </Card>
          {canEdit && !closed && (
            <Card>
              <CardHeader title={edit ? "Edit task" : "Edit task"} action={!edit ? <Link href={`/tasks/${id}?edit=1`} className="text-sm text-action hover:underline">Open editor</Link> : <Link href={`/tasks/${id}`} className="text-sm text-action hover:underline">Close editor</Link>} />
              {edit && (
                <div className="px-5 pb-5">
                  <TaskForm mode="edit" values={{ taskId: task.id, clientId: task.client_id ?? "", title: task.title, description: task.description, ownerUserId: task.owner_user_id, priority: task.priority, dueDate: task.due_date }} owners={owners.filter((o) => o.platform_role !== "read_only")} relatedPicker={picker} />
                </div>
              )}
            </Card>
          )}
          <Card>
            <CardHeader title="Notes" />
            <ul className="divide-y divide-line">
              {task.notes.length === 0 && <li className="px-5 py-3 text-sm text-muted">No notes yet.</li>}
              {task.notes.map((n: { id: string; body: string; author_name: string; created_at: Date }) => (
                <li key={n.id} className="px-5 py-3 text-sm">
                  <div className="whitespace-pre-wrap">{n.body}</div>
                  <div className="text-xs text-muted mt-1">{n.author_name}, {formatDateTime(n.created_at)}</div>
                </li>
              ))}
            </ul>
            {canAct && <div className="px-5 pb-5"><TaskNoteForm taskId={task.id} /></div>}
          </Card>
        </div>
        <div className="space-y-6">
          {canAct && (
            <Card>
              <CardHeader title="Change status" description="Every change is kept in the history below." />
              <div className="px-5 pb-5"><TaskTransitionForm taskId={task.id} status={task.status} waitingOn={task.waiting_on} followUpDate={task.follow_up_date} /></div>
            </Card>
          )}
          <Card>
            <CardHeader title="History" />
            <ol className="divide-y divide-line">
              {task.history.map((h: { id: string; from_status: string | null; to_status: string; actor_name: string; note: string | null; created_at: Date; from_owner_name: string | null; to_owner_name: string | null }) => (
                <li key={h.id} className="px-5 py-3 text-sm">
                  <div>
                    {h.from_status && h.from_status !== h.to_status ? `${label(h.from_status)} to ${label(h.to_status)}` : h.from_owner_name && h.to_owner_name ? `Owner ${h.from_owner_name} to ${h.to_owner_name}` : label(h.to_status)}
                  </div>
                  {h.note && <div className="text-muted">{h.note}</div>}
                  <div className="text-xs text-muted mt-0.5">{h.actor_name}, {formatDateTime(h.created_at)}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
