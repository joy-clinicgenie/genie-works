import { addDays, type TaskPriority, type TaskRow, type TaskStatus } from "@clinic-genie/db";

export const DUE_FILTERS = ["overdue", "today", "week", "none"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

export interface LaunchTaskFilters {
  q?: string;
  clientId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due?: DueFilter;
}

/** Monday–Sunday week containing `today`. Dates are YYYY-MM-DD. */
export function weekBounds(today: string): { start: string; end: string } {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  const start = addDays(today, -back);
  return { start, end: addDays(start, 6) };
}

function stillOpen(task: TaskRow): boolean {
  return task.status !== "completed" && task.status !== "cancelled";
}

export function filterLaunchTasks(tasks: TaskRow[], filters: LaunchTaskFilters, today: string): TaskRow[] {
  const q = filters.q?.trim().toLowerCase() ?? "";
  const week = weekBounds(today);
  return tasks.filter((task) => {
    if (q && !task.title.toLowerCase().includes(q)) return false;
    if (filters.clientId === "internal" && task.client_id) return false;
    if (filters.clientId && filters.clientId !== "internal" && task.client_id !== filters.clientId) return false;
    if (filters.status && task.status !== filters.status) return false;
    if (filters.priority && task.priority !== filters.priority) return false;
    if (filters.due === "none" && task.due_date) return false;
    if (filters.due === "today" && task.due_date !== today) return false;
    if (filters.due === "overdue" && !(stillOpen(task) && task.due_date && task.due_date < today)) return false;
    if (filters.due === "week" && !(task.due_date && task.due_date >= week.start && task.due_date <= week.end)) return false;
    return true;
  });
}

/** Dated open tasks by nearest deadline, overdue first. Tasks without a deadline follow. Finished tasks follow those. */
export function sortLaunchTasks(tasks: TaskRow[]): TaskRow[] {
  return [...tasks].sort((a, b) => {
    const openRank = Number(stillOpen(b)) - Number(stillOpen(a));
    if (openRank !== 0) return openRank;
    if (Boolean(a.due_date) !== Boolean(b.due_date)) return a.due_date ? -1 : 1;
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    const created = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (created !== 0) return created;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
