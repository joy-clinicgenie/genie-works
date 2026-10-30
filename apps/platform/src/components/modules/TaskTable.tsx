import Link from "next/link";
import type { TaskRow } from "@clinic-genie/db";
import { formatDate } from "@clinic-genie/db";
import { Badge, PRIORITY_TONE, TASK_STATUS_TONE, label } from "@/components/ui/Badge";
import { Table, Td, Th } from "@/components/ui/Table";
import { QuickTaskActions } from "./QuickTaskActions";

const LAUNCH_STATUS: Record<string, string> = {
  open: "To do",
  in_progress: "In progress",
  waiting: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
};

const LAUNCH_PRIORITY: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export function TaskTable({ tasks, today, showClient = true, caption, canAct, emptyLabel = "No tasks match.", variant = "operations", taskHref, selectedTaskId }: { tasks: TaskRow[]; today: string; showClient?: boolean; caption: string; canAct: boolean; emptyLabel?: string; variant?: "operations" | "launch"; taskHref?: (id: string) => string; selectedTaskId?: string }) {
  if (variant === "launch") return <LaunchTaskTable tasks={tasks} today={today} caption={caption} emptyLabel={emptyLabel} taskHref={taskHref} selectedTaskId={selectedTaskId} />;
  const columns = 6 + (showClient ? 1 : 0) + (canAct ? 1 : 0);
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th>Task</Th>
          {showClient && <Th>Client</Th>}
          <Th>Owner</Th>
          <Th>Priority</Th>
          <Th>Status</Th>
          <Th>Due</Th>
          <Th>Follow-up</Th>
          {canAct && <Th>Actions</Th>}
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => {
          const overdue = t.due_date && t.due_date < today && (t.status === "open" || t.status === "in_progress");
          const dueToday = t.due_date === today && (t.status === "open" || t.status === "in_progress");
          const followUpDue = t.status === "waiting" && t.follow_up_date && t.follow_up_date <= today;
          return (
            <tr key={t.id} className="hover:bg-surface-muted/60">
              <Td>
                <Link href={`/tasks/${t.id}`} className="font-medium text-action hover:underline">{t.title}</Link>
                {t.related_title && <div className="text-xs text-muted">Linked to {label(t.related_type ?? "")}: {t.related_title}</div>}
              </Td>
              {showClient && <Td><Link href={`/clients/${t.client_id}`} className="hover:underline">{t.client_name}</Link></Td>}
              <Td>{t.owner_name}</Td>
              <Td><Badge tone={PRIORITY_TONE[t.priority]}>{label(t.priority)}</Badge></Td>
              <Td><Badge tone={TASK_STATUS_TONE[t.status]}>{label(t.status)}</Badge></Td>
              <Td className="whitespace-nowrap">
                {t.due_date ? formatDate(t.due_date) : <span className="text-muted">No due date</span>}
                {overdue && <Badge tone="bad" className="ml-1.5">Overdue</Badge>}
                {dueToday && <Badge tone="warn" className="ml-1.5">Today</Badge>}
              </Td>
              <Td className="whitespace-nowrap">
                {t.status === "waiting" ? (
                  <>
                    {formatDate(t.follow_up_date)} {followUpDue && <Badge tone="warn" className="ml-1.5">Follow-up due</Badge>}
                    <div className="text-xs text-muted">Waiting on {t.waiting_on}</div>
                  </>
                ) : (
                  <span className="text-muted">None</span>
                )}
              </Td>
              {canAct && <Td><QuickTaskActions taskId={t.id} status={t.status} compact /></Td>}
            </tr>
          );
        })}
        {tasks.length === 0 && (
          <tr>
            <td colSpan={columns} className="px-3 py-6 text-center text-muted text-sm">{emptyLabel}</td>
          </tr>
        )}
      </tbody>
    </Table>
  );
}

function LaunchTaskTable({ tasks, today, caption, emptyLabel, taskHref, selectedTaskId }: { tasks: TaskRow[]; today: string; caption: string; emptyLabel: string; taskHref?: (id: string) => string; selectedTaskId?: string }) {
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th>Task</Th>
          <Th>Client</Th>
          <Th>Assigned to</Th>
          <Th>Priority</Th>
          <Th>Due date</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => {
          const stillOpen = task.status !== "completed" && task.status !== "cancelled";
          const overdue = Boolean(task.due_date && task.due_date < today && stillOpen);
          const clinic = task.client_name.trim();
          return (
            <tr key={task.id} className={task.id === selectedTaskId ? "bg-brand-pale/70" : "hover:bg-surface-muted/60"}>
              <Td>
                <Link href={taskHref ? taskHref(task.id) : `/tasks/${task.id}`} scroll={false} aria-current={task.id === selectedTaskId ? "true" : undefined} className="font-medium text-action hover:underline">{task.title}</Link>
              </Td>
              <Td>{clinic ? <Link href={`/clients/${task.client_id}`} className="hover:underline">{clinic}</Link> : "Internal"}</Td>
              <Td>{task.owner_name}</Td>
              <Td><Badge tone={PRIORITY_TONE[task.priority]}>{LAUNCH_PRIORITY[task.priority] ?? label(task.priority)}</Badge></Td>
              <Td className="whitespace-nowrap">
                {task.due_date ? (
                  <time dateTime={task.due_date} className={overdue ? "font-semibold text-bad" : undefined}>
                    {formatDate(task.due_date)}
                    {overdue && <span className="sr-only">, overdue</span>}
                  </time>
                ) : (
                  <span className="text-muted">No due date</span>
                )}
              </Td>
              <Td><Badge tone={TASK_STATUS_TONE[task.status]}>{LAUNCH_STATUS[task.status] ?? label(task.status)}</Badge></Td>
            </tr>
          );
        })}
        {tasks.length === 0 && (
          <tr>
            <td colSpan={6} className="px-3 py-6 text-center text-muted text-sm">{emptyLabel}</td>
          </tr>
        )}
      </tbody>
    </Table>
  );
}
