import { Plus } from "lucide-react";
import { canEditClient, formatDateTime, getTask, listActiveStaff, listClients, listTasks, todaySgt, type AccessProfile, type TaskPriority, type TaskStatus } from "@clinic-genie/db";
import { ACTIVE_TASK_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from "@clinic-genie/contracts";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { clientLabel } from "@/lib/client-label";
import { DUE_FILTERS, filterLaunchTasks, sortLaunchTasks, type DueFilter } from "@/lib/task-list";
import { PageHeader, Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { LinkButton } from "@/components/ui/Button";
import { FilterBar, FilterInput, FilterSelect } from "@/components/ui/Filters";
import { TaskTable } from "@/components/modules/TaskTable";
import { TaskTabs, taskListView, type TaskListView } from "@/components/modules/TaskTabs";
import { AddTaskDialog } from "@/components/modules/AddTaskDialog";
import { AddTaskForm } from "@/components/modules/AddTaskForm";
import { TaskSidePanel } from "@/components/modules/TaskSidePanel";

const STATUS_OPTIONS = [
  { value: "open", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting", label: "Blocked" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const DUE_OPTIONS = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "none", label: "No due date" },
];

const EMPTY: Record<TaskListView, string> = {
  mine: "You have no tasks yet.",
  all: "No tasks you can view.",
  completed: "No completed tasks.",
};

const NOTICES = {
  created: "Task created.",
  updated: "Task updated.",
  completed: "Task marked as completed.",
} as const;

interface TaskSearch {
  view?: string;
  compose?: string;
  task?: string;
  notice?: string;
  q?: string;
  client?: string;
  status?: string;
  priority?: string;
  due?: string;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function listHref(view: TaskListView, filters: URLSearchParams, extra?: { taskId?: string; compose?: boolean }) {
  const params = new URLSearchParams(filters);
  if (view !== "mine") params.set("view", view);
  if (extra?.taskId) params.set("task", extra.taskId);
  if (extra?.compose) params.set("compose", "1");
  const query = params.toString();
  return query ? `/my-tasks?${query}` : "/my-tasks";
}

function canChangeTask(access: AccessProfile, task: { client_id: string | null; owner_user_id: string }) {
  if (access.user.platform_role === "read_only") return false;
  if (!task.client_id) return true;
  return canEditClient(access, task.client_id) || task.owner_user_id === access.user.id;
}

export const dynamic = "force-dynamic";
export const metadata = { title: "My tasks" };

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<TaskSearch> }) {
  const access = await requireAccess();
  const requested = await searchParams;
  const view = taskListView(requested.view);
  const taskId = requested.task && /^[0-9a-f-]{36}$/i.test(requested.task) ? requested.task : undefined;
  const openForm = requested.compose === "1" && access.user.platform_role !== "read_only";
  const q = (requested.q ?? "").trim().slice(0, 200);
  const client = requested.client === "internal" || /^[0-9a-f-]{36}$/i.test(requested.client ?? "") ? requested.client : undefined;
  const status = oneOf<TaskStatus>(requested.status, TASK_STATUSES);
  const priority = oneOf<TaskPriority>(requested.priority, TASK_PRIORITIES);
  const due = oneOf<DueFilter>(requested.due, DUE_FILTERS);
  const notice = oneOf(requested.notice, ["created", "updated", "completed"] as const);
  const filters = new URLSearchParams();
  if (q) filters.set("q", q);
  if (client) filters.set("client", client);
  if (status) filters.set("status", status);
  if (priority) filters.set("priority", priority);
  if (due) filters.set("due", due);
  const filtering = filters.size > 0;
  const today = todaySgt();
  const statuses: TaskStatus[] = view === "completed" ? ["completed"] : view === "all" ? [...TASK_STATUSES] : ACTIVE_TASK_STATUSES;
  const data = await staffTx(access, async (db) => {
    const tasks = await listTasks(db, { ownerUserId: view === "mine" ? access.user.id : undefined, statuses });
    const selected = taskId ? await getTask(db, taskId) : null;
    const clients = await listClients(db);
    const editable = selected ? canChangeTask(access, selected) : false;
    if (!openForm && !editable) return { tasks, selected, editable, clients, owners: [] };
    const owners = (await listActiveStaff(db)).filter((owner) => owner.platform_role !== "read_only");
    return { tasks, selected, editable, clients, owners };
  });
  const shown = sortLaunchTasks(filterLaunchTasks(data.tasks, { q, clientId: client, status, priority, due }, today));
  const clientOptions = [{ value: "internal", label: "Internal" }, ...data.clients.map((item) => ({ value: item.id, label: item.name }))];
  for (const task of data.tasks) {
    if (task.client_id && !clientOptions.some((option) => option.value === task.client_id)) {
      clientOptions.push({ value: task.client_id, label: task.client_name.trim() || "Client" });
    }
  }
  const closeHref = listHref(view, filters);
  const clearHref = listHref(view, new URLSearchParams(), taskId ? { taskId } : undefined);
  const openHref = listHref(view, filters, { compose: true });
  const selected = data.selected;
  return (
    <TaskTabs view={view} search={filters.toString()}>
      <PageHeader title="My tasks" description="Track your tasks, priorities and deadlines." action={access.user.platform_role !== "read_only" ? <LinkButton href={openHref}><Plus className="size-4" aria-hidden="true" />Add task</LinkButton> : undefined} />
      <FilterBar action="/my-tasks" clearHref={clearHref} formKey={filters.toString()}>
        {view !== "mine" && <input type="hidden" name="view" value={view} />}
        {taskId && <input type="hidden" name="task" value={taskId} />}
        <FilterInput name="q" label="Search" value={q} placeholder="Search by task title" className="min-w-56" />
        <FilterSelect name="client" label="Client" value={client} allLabel="All clients" options={clientOptions} />
        <FilterSelect name="status" label="Status" value={status} allLabel="Any status" options={STATUS_OPTIONS} />
        <FilterSelect name="priority" label="Priority" value={priority} allLabel="Any priority" options={PRIORITY_OPTIONS} />
        <FilterSelect name="due" label="Due date" value={due} allLabel="Any due date" options={DUE_OPTIONS} />
      </FilterBar>
      {notice && !selected && <div className="mb-4"><Notice tone="good">{NOTICES[notice]}</Notice></div>}
      <Card>
        <TaskTable tasks={shown} today={today} caption="Tasks" canAct={access.user.platform_role !== "read_only"} emptyLabel={filtering ? "No tasks match your filters." : EMPTY[view]} variant="launch" selectedTaskId={selected?.id} taskHref={(id) => listHref(view, filters, { taskId: id })} />
      </Card>
      {openForm && (
        <AddTaskDialog closeHref={closeHref}>
          <AddTaskForm closeHref={closeHref} returnView={view} selfId={access.user.id} clients={data.clients.filter((item) => canEditClient(access, item.id)).map((item) => ({ id: item.id, label: clientLabel(item) }))} owners={data.owners.map((owner) => ({ id: owner.id, name: owner.display_name }))} />
        </AddTaskDialog>
      )}
      {selected && (
        <TaskSidePanel
          key={`${selected.id}-${new Date(selected.updated_at).toISOString()}`}
          closeHref={closeHref}
          returnTo={listHref(view, filters, { taskId: selected.id })}
          notice={notice ? NOTICES[notice] : undefined}
          canEdit={data.editable}
          owners={data.owners.map((owner) => ({ id: owner.id, name: owner.display_name }))}
          task={{
            id: selected.id,
            title: selected.title,
            description: selected.description,
            clientLabel: selected.client_name.trim() || "Internal",
            ownerName: selected.owner_name,
            ownerUserId: selected.owner_user_id,
            priority: selected.priority,
            dueDate: selected.due_date,
            status: selected.status,
            referenceUrl: selected.reference_url,
            createdBy: selected.created_by_name || "Unknown",
            createdOn: formatDateTime(selected.created_at),
            updatedOn: formatDateTime(selected.updated_at),
          }}
        />
      )}
    </TaskTabs>
  );
}
