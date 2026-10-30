import { ACTIVE_TASK_STATUSES, type TaskPriority, type TaskStatus } from "@clinic-genie/contracts";
import type { Queryable } from "../client";
import { recordAudit } from "./audit";
import { isValidDate } from "./dates";
import { relatedPair, resolveRelated } from "./related";
import { recordTimeline } from "./timeline";

export interface TaskRow {
  id: string;
  client_id: string | null;
  reference_url: string | null;
  client_name: string;
  client_slug: string;
  title: string;
  description: string | null;
  owner_user_id: string;
  owner_name: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  waiting_on: string | null;
  follow_up_date: string | null;
  related_type: string | null;
  related_id: string | null;
  related_title: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  cancelled_at: Date | null;
}

export interface TaskInput {
  clientId: string | null;
  title: string;
  description: string | null;
  ownerUserId: string;
  priority: TaskPriority;
  dueDate: string | null;
  relatedType: string | null;
  relatedId: string | null;
  status?: TaskStatus;
  referenceUrl?: string | null;
}

export class TaskRuleError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "TaskRuleError";
  }
}

const TASK_SELECT = `
  select t.*, coalesce(c.name, '') as client_name, coalesce(c.slug, '') as client_slug, u.display_name as owner_name, creator.display_name as created_by_name,
         case t.related_type
           when 'issue' then (select title from issues i where i.id = t.related_id)
           when 'approval' then (select title from approvals a where a.id = t.related_id)
           when 'seo_page' then (select page_path from seo_pages p where p.id = t.related_id)
           when 'ads_audit' then (select title from ads_audits a where a.id = t.related_id)
           when 'medical_claim' then (select claim_summary from medical_claims m where m.id = t.related_id)
           when 'ads_change' then (select description from ads_changes a where a.id = t.related_id)
           else null end as related_title
  from tasks t left join clients c on c.id = t.client_id join staff_users u on u.id = t.owner_user_id left join staff_users creator on creator.id = t.created_by`;

export interface TaskFilters {
  clientId?: string;
  ownerUserId?: string;
  statuses?: TaskStatus[];
  priority?: TaskPriority;
  limit?: number;
}

export async function listTasks(db: Queryable, f: TaskFilters = {}): Promise<TaskRow[]> {
  const statuses = f.statuses ?? ACTIVE_TASK_STATUSES;
  const { rows } = await db.query<TaskRow>(
    `${TASK_SELECT}
     where ($1::uuid is null or t.client_id = $1) and ($2::uuid is null or t.owner_user_id = $2)
       and t.status = any($3::text[]) and ($4::text is null or t.priority = $4)
     order by t.due_date asc nulls last, t.created_at asc limit $5`,
    [f.clientId ?? null, f.ownerUserId ?? null, statuses, f.priority ?? null, f.limit ?? 500],
  );
  return rows;
}

export async function getTask(db: Queryable, id: string) {
  const { rows } = await db.query<TaskRow>(`${TASK_SELECT} where t.id = $1`, [id]);
  const task = rows[0];
  if (!task) return null;
  const history = await db.query(
    `select h.*, a.display_name as actor_name, fo.display_name as from_owner_name, tu.display_name as to_owner_name
     from task_history h join staff_users a on a.id = h.actor_user_id
     left join staff_users fo on fo.id = h.from_owner_user_id left join staff_users tu on tu.id = h.to_owner_user_id
     where h.task_id = $1 order by h.created_at`,
    [id],
  );
  const notes = await db.query("select n.*, u.display_name as author_name from task_notes n join staff_users u on u.id = n.author_user_id where n.task_id = $1 order by n.created_at", [id]);
  return { ...task, history: history.rows, notes: notes.rows };
}

function validateTaskRules(input: { priority: TaskPriority; dueDate: string | null; title: string }): void {
  if (!input.title.trim()) throw new TaskRuleError("Title is required.", "title");
  if (input.dueDate && !isValidDate(input.dueDate)) throw new TaskRuleError("Due date must be a valid date.", "dueDate");
}

function cleanReference(value: string | null | undefined): string | null {
  const url = value?.trim() ?? "";
  if (!url) return null;
  if (url.length > 2000 || !/^https?:\/\/\S+$/i.test(url)) {
    throw new TaskRuleError("Enter a link starting with http:// or https://.", "referenceUrl");
  }
  return url;
}

async function validateRelated(db: Queryable, clientId: string | null, type: string | null, id: string | null): Promise<{ type: string | null; id: string | null }> {
  const link = relatedPair(type, id);
  if (!link.type || !link.id || !clientId) return { type: null, id: null };
  const found = await resolveRelated(db, clientId, link.type, link.id);
  if (!found) throw new TaskRuleError("The related record does not belong to this client.", "relatedId");
  return link;
}

export async function createTask(db: Queryable, input: TaskInput, actorUserId: string): Promise<string> {
  validateTaskRules(input);
  const status = input.status ?? "open";
  if (!["open", "in_progress", "waiting", "completed", "cancelled"].includes(status)) throw new TaskRuleError("Choose a status.", "status");
  const referenceUrl = cleanReference(input.referenceUrl);
  const related = await validateRelated(db, input.clientId, input.relatedType, input.relatedId);
  const { rows } = await db.query<{ id: string }>(
    `insert into tasks (client_id, title, description, owner_user_id, priority, status, due_date, related_type, related_id, reference_url, created_by, completed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, case when $6 = 'completed' then now() else null end) returning id`,
    [input.clientId, input.title.trim(), input.description, input.ownerUserId, input.priority, status, input.dueDate, related.type, related.id, referenceUrl, actorUserId],
  );
  const id = rows[0]!.id;
  await db.query("insert into task_history (task_id, client_id, from_status, to_status, to_owner_user_id, actor_user_id, note) values ($1, $2, null, $3, $4, $5, 'Task created')", [id, input.clientId, status, input.ownerUserId, actorUserId]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "task.create", targetType: "task", targetId: id, clientId: input.clientId, outcome: "success", metadata: { priority: input.priority, status } });
  if (input.clientId) {
    await recordTimeline(db, { clientId: input.clientId, eventType: "task_created", title: `Task created: ${input.title.trim()}`, relatedType: "task", relatedId: id, actorUserId, dedupeKey: `task_created:${id}` });
  }
  return id;
}

export async function updateTaskDetails(db: Queryable, id: string, input: Omit<TaskInput, "clientId">, actorUserId: string): Promise<void> {
  const current = await getTask(db, id);
  if (!current) throw new TaskRuleError("Task not found.");
  if (current.status === "completed" || current.status === "cancelled") throw new TaskRuleError("Completed and cancelled tasks cannot be edited. Reopen or create a new task.");
  validateTaskRules(input);
  const related = await validateRelated(db, current.client_id, input.relatedType, input.relatedId);
  await db.query(
    `update tasks set title = $2, description = $3, owner_user_id = $4, priority = $5, due_date = $6, related_type = $7, related_id = $8, updated_at = now() where id = $1`,
    [id, input.title.trim(), input.description, input.ownerUserId, input.priority, input.dueDate, related.type, related.id],
  );
  if (current.owner_user_id !== input.ownerUserId) {
    await db.query("insert into task_history (task_id, client_id, from_status, to_status, from_owner_user_id, to_owner_user_id, actor_user_id, note) values ($1, $2, $3, $3, $4, $5, $6, 'Owner changed')", [id, current.client_id, current.status, current.owner_user_id, input.ownerUserId, actorUserId]);
  }
  await recordAudit(db, { actorType: "staff", actorUserId, action: "task.update", targetType: "task", targetId: id, clientId: current.client_id, outcome: "success", metadata: { ownerChanged: current.owner_user_id !== input.ownerUserId } });
}

const LAUNCH_STATUSES: TaskStatus[] = ["open", "in_progress", "waiting", "completed", "cancelled"];

/** Saves the soft-launch task panel. Status can move to Blocked without a follow-up, and a completed task can be edited or reopened. */
export async function saveLaunchTask(db: Queryable, id: string, input: Omit<TaskInput, "clientId" | "relatedType" | "relatedId"> & { status: TaskStatus }, actorUserId: string): Promise<void> {
  const current = await getTask(db, id);
  if (!current) throw new TaskRuleError("Task not found.");
  if (!LAUNCH_STATUSES.includes(input.status)) throw new TaskRuleError("Choose a status.", "status");
  validateTaskRules(input);
  const referenceUrl = cleanReference(input.referenceUrl);
  await db.query(
    `update tasks set title = $2, description = $3, owner_user_id = $4, priority = $5, due_date = $6, status = $7, reference_url = $8,
       completed_at = case when $7 = 'completed' then coalesce(completed_at, now()) when $7 in ('open','in_progress','waiting') then null else completed_at end,
       cancelled_at = case when $7 = 'cancelled' then coalesce(cancelled_at, now()) when $7 in ('open','in_progress','waiting','completed') then null else cancelled_at end,
       waiting_on = case when $7 = 'waiting' then waiting_on else null end,
       follow_up_date = case when $7 = 'waiting' then follow_up_date else null end,
       updated_at = now()
     where id = $1`,
    [id, input.title.trim(), input.description, input.ownerUserId, input.priority, input.dueDate, input.status, referenceUrl],
  );
  if (current.status !== input.status) {
    const note = input.status === "completed" ? "Task completed" : input.status === "open" && (current.status === "completed" || current.status === "cancelled") ? "Task reopened" : null;
    await db.query("insert into task_history (task_id, client_id, from_status, to_status, actor_user_id, note) values ($1, $2, $3, $4, $5, $6)", [id, current.client_id, current.status, input.status, actorUserId, note]);
  }
  if (current.owner_user_id !== input.ownerUserId) {
    await db.query("insert into task_history (task_id, client_id, from_status, to_status, from_owner_user_id, to_owner_user_id, actor_user_id, note) values ($1, $2, $3, $3, $4, $5, $6, 'Owner changed')", [id, current.client_id, input.status, current.owner_user_id, input.ownerUserId, actorUserId]);
  }
  await recordAudit(db, { actorType: "staff", actorUserId, action: "task.update", targetType: "task", targetId: id, clientId: current.client_id, outcome: "success", metadata: { from: current.status, to: input.status, ownerChanged: current.owner_user_id !== input.ownerUserId } });
  if (current.client_id && current.status !== "completed" && input.status === "completed") {
    await recordTimeline(db, { clientId: current.client_id, eventType: "task_completed", title: `Task completed: ${input.title.trim()}`, relatedType: "task", relatedId: id, actorUserId, dedupeKey: `task_completed:${id}:${new Date().toISOString().slice(0, 16)}` });
  }
}

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ["in_progress", "waiting", "completed", "cancelled"],
  in_progress: ["open", "waiting", "completed", "cancelled"],
  waiting: ["open", "in_progress", "completed", "cancelled"],
  completed: ["open"],
  cancelled: ["open"],
};

export interface TransitionInput {
  status: TaskStatus;
  note: string | null;
  waitingOn?: string | null;
  followUpDate?: string | null;
}

/** Changes status with history preserved. Waiting needs a waiting-on value and a follow-up date. */
export async function transitionTask(db: Queryable, id: string, input: TransitionInput, actorUserId: string): Promise<void> {
  const { rows } = await db.query<{ status: TaskStatus; client_id: string; title: string }>("select status, client_id, title from tasks where id = $1 for update", [id]);
  const current = rows[0];
  if (!current) throw new TaskRuleError("Task not found.");
  if (!TRANSITIONS[current.status].includes(input.status)) throw new TaskRuleError(`Cannot move a ${current.status.replace("_", " ")} task to ${input.status.replace("_", " ")}.`);
  if (input.status === "waiting") {
    if (!input.waitingOn?.trim()) throw new TaskRuleError("Say who or what the task is waiting on.", "waitingOn");
    if (!input.followUpDate || !isValidDate(input.followUpDate)) throw new TaskRuleError("Waiting tasks need a follow-up date.", "followUpDate");
  }
  await db.query(
    `update tasks set status = $2,
       waiting_on = case when $2 = 'waiting' then $3 else null end,
       follow_up_date = case when $2 = 'waiting' then $4::date else null end,
       completed_at = case when $2 = 'completed' then now() when $2 in ('open','in_progress','waiting') then null else completed_at end,
       cancelled_at = case when $2 = 'cancelled' then now() when $2 in ('open','in_progress','waiting') then null else cancelled_at end,
       updated_at = now()
     where id = $1`,
    [id, input.status, input.waitingOn?.trim() ?? null, input.followUpDate ?? null],
  );
  await db.query("insert into task_history (task_id, client_id, from_status, to_status, actor_user_id, note) values ($1, $2, $3, $4, $5, $6)", [id, current.client_id, current.status, input.status, actorUserId, input.note]);
  await recordAudit(db, { actorType: "staff", actorUserId, action: "task.transition", targetType: "task", targetId: id, clientId: current.client_id, outcome: "success", metadata: { from: current.status, to: input.status } });
  if (input.status === "completed" || input.status === "cancelled") {
    await recordTimeline(db, {
      clientId: current.client_id,
      eventType: input.status === "completed" ? "task_completed" : "task_cancelled",
      title: `Task ${input.status}: ${current.title}`,
      summary: input.note,
      relatedType: "task",
      relatedId: id,
      actorUserId,
      dedupeKey: `task_${input.status}:${id}:${new Date().toISOString().slice(0, 13)}`,
    });
  }
}

export async function addTaskNote(db: Queryable, taskId: string, body: string, actorUserId: string): Promise<void> {
  const { rows } = await db.query<{ client_id: string }>("select client_id from tasks where id = $1", [taskId]);
  if (!rows[0]) throw new TaskRuleError("Task not found.");
  if (!body.trim()) throw new TaskRuleError("Note cannot be empty.", "body");
  await db.query("insert into task_notes (task_id, client_id, author_user_id, body) values ($1, $2, $3, $4)", [taskId, rows[0].client_id, actorUserId, body.trim()]);
}

export interface TaskCounts {
  open: number;
  overdue: number;
  waiting: number;
  due_today: number;
}

export async function taskCounts(db: Queryable, opts: { clientId?: string; ownerUserId?: string; today: string }): Promise<TaskCounts> {
  const { rows } = await db.query<TaskCounts>(
    `select count(*) filter (where status in ('open','in_progress','waiting'))::int as open,
            count(*) filter (where status in ('open','in_progress') and due_date < $3::date)::int as overdue,
            count(*) filter (where status = 'waiting')::int as waiting,
            count(*) filter (where status in ('open','in_progress') and due_date = $3::date)::int as due_today
     from tasks where ($1::uuid is null or client_id = $1) and ($2::uuid is null or owner_user_id = $2)`,
    [opts.clientId ?? null, opts.ownerUserId ?? null, opts.today],
  );
  return rows[0]!;
}
