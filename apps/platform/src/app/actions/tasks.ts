"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addTaskNote, canEditClient, createTask, getTask, saveLaunchTask, transitionTask, updateTaskDetails, type TaskPriority, type TaskStatus } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { optional, str, toActionError, type ActionState } from "@/lib/actions";

function revalidateTask(id?: string) {
  revalidatePath("/");
  revalidatePath("/my-tasks");
  revalidatePath("/clients", "layout");
  if (id) revalidatePath(`/tasks/${id}`);
}

function mayEditClient(access: Awaited<ReturnType<typeof requireAccess>>, clientId: string | null): boolean {
  if (access.user.platform_role === "read_only") return false;
  if (!clientId) return true;
  return canEditClient(access, clientId);
}

const LAUNCH_STATUSES = ["open", "in_progress", "waiting", "completed"] as const;
const SAVE_FAILED = "Changes could not be saved. Please try again.";

function launchError(err: unknown): ActionState {
  const state = toActionError(err);
  if (state && !state.ok && state.error === "Something went wrong. Nothing was saved.") return { ok: false, error: SAVE_FAILED };
  return state;
}

/** Keeps the task list address and adds a confirmation the page can show. */
function taskNoticeHref(returnTo: string, notice: "created" | "updated" | "completed", taskId?: string): string {
  const params = new URLSearchParams();
  if (returnTo === "/my-tasks" || returnTo.startsWith("/my-tasks?")) {
    const incoming = new URLSearchParams(returnTo.slice("/my-tasks".length).replace(/^\?/, ""));
    incoming.forEach((value, key) => {
      if (key !== "notice" && key !== "compose") params.append(key, value);
    });
  }
  if (taskId) params.set("task", taskId);
  params.set("notice", notice);
  const query = params.toString();
  return query ? `/my-tasks?${query}` : "/my-tasks";
}

export async function createLaunchTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  if (access.user.platform_role === "read_only") return { ok: false, error: "You cannot create tasks." };
  const clientValue = str(form, "clientId");
  if (!clientValue) return { ok: false, error: "Choose a client.", field: "clientId" };
  const clientId = clientValue === "internal" ? null : clientValue;
  if (!mayEditClient(access, clientId)) return { ok: false, error: "You cannot create tasks for this client.", field: "clientId" };
  const priority = str(form, "priority");
  if (priority !== "low" && priority !== "medium" && priority !== "high") return { ok: false, error: "Choose a priority.", field: "priority" };
  const status = str(form, "status");
  if (!LAUNCH_STATUSES.includes(status as (typeof LAUNCH_STATUSES)[number])) return { ok: false, error: "Choose a status.", field: "status" };
  const ownerUserId = str(form, "ownerUserId");
  if (!ownerUserId) return { ok: false, error: "Choose who the task is assigned to.", field: "ownerUserId" };
  try {
    await staffTx(access, (db) =>
      createTask(db, {
        clientId,
        title: str(form, "title"),
        description: optional(form, "description"),
        ownerUserId,
        priority,
        dueDate: optional(form, "dueDate"),
        relatedType: null,
        relatedId: null,
        status: status as TaskStatus,
        referenceUrl: optional(form, "referenceUrl"),
      }, access.user.id),
    );
  } catch (err) {
    return launchError(err);
  }
  revalidateTask();
  const returnView = str(form, "returnView");
  const view = status === "completed" ? "completed" : ownerUserId !== access.user.id ? "all" : returnView === "all" ? "all" : "mine";
  redirect(taskNoticeHref(view === "mine" ? "/my-tasks" : `/my-tasks?view=${view}`, "created"));
}

export async function createTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const clientId = str(form, "clientId");
  if (!canEditClient(access, clientId)) return { ok: false, error: "You cannot create tasks for this client." };
  let id: string;
  try {
    id = await staffTx(access, (db) =>
      createTask(db, {
        clientId,
        title: str(form, "title"),
        description: optional(form, "description"),
        ownerUserId: str(form, "ownerUserId"),
        priority: str(form, "priority") as TaskPriority,
        dueDate: optional(form, "dueDate"),
        relatedType: optional(form, "relatedType"),
        relatedId: optional(form, "relatedId"),
      }, access.user.id),
    );
  } catch (err) {
    return toActionError(err);
  }
  revalidateTask(id);
  redirect(`/tasks/${id}`);
}

export async function saveLaunchTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "taskId");
  const intent = str(form, "intent");
  const priority = str(form, "priority");
  if (!["low", "medium", "high", "critical"].includes(priority)) return { ok: false, error: "Choose a priority.", field: "priority" };
  let status = str(form, "status");
  if (intent === "complete") status = "completed";
  if (intent === "reopen") status = "open";
  if (!LAUNCH_STATUSES.includes(status as (typeof LAUNCH_STATUSES)[number]) && status !== "cancelled") return { ok: false, error: "Choose a status.", field: "status" };
  const ownerUserId = str(form, "ownerUserId");
  if (!ownerUserId) return { ok: false, error: "Choose who the task is assigned to.", field: "ownerUserId" };
  let notice: "updated" | "completed" = "updated";
  try {
    await staffTx(access, async (db) => {
      const task = await getTask(db, id);
      if (!task) throw Object.assign(new Error("Task not found."), { name: "TaskRuleError" });
      const mayAct = mayEditClient(access, task.client_id) || task.owner_user_id === access.user.id;
      if (!mayAct || access.user.platform_role === "read_only") throw Object.assign(new Error("You cannot edit this task."), { name: "TaskRuleError" });
      if (task.status !== "completed" && status === "completed") notice = "completed";
      await saveLaunchTask(db, id, {
        title: str(form, "title"),
        description: optional(form, "description"),
        ownerUserId,
        priority: priority as TaskPriority,
        dueDate: optional(form, "dueDate"),
        status: status as TaskStatus,
        referenceUrl: optional(form, "referenceUrl"),
      }, access.user.id);
    });
  } catch (err) {
    return launchError(err);
  }
  revalidateTask(id);
  redirect(taskNoticeHref(str(form, "returnTo"), notice, id));
}

export async function updateTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "taskId");
  try {
    await staffTx(access, async (db) => {
      const task = await getTask(db, id);
      if (!task || !mayEditClient(access, task.client_id)) throw Object.assign(new Error("You cannot edit this task."), { name: "TaskRuleError" });
      await updateTaskDetails(db, id, {
        title: str(form, "title"),
        description: optional(form, "description"),
        ownerUserId: str(form, "ownerUserId"),
        priority: str(form, "priority") as TaskPriority,
        dueDate: optional(form, "dueDate"),
        relatedType: optional(form, "relatedType"),
        relatedId: optional(form, "relatedId"),
      }, access.user.id);
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidateTask(id);
  return { ok: true, message: "Task saved." };
}

export async function transitionTaskAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "taskId");
  const status = str(form, "status") as TaskStatus;
  try {
    await staffTx(access, async (db) => {
      const task = await getTask(db, id);
      if (!task) throw Object.assign(new Error("Task not found."), { name: "TaskRuleError" });
      const mayAct = mayEditClient(access, task.client_id) || task.owner_user_id === access.user.id;
      if (!mayAct || access.user.platform_role === "read_only") throw Object.assign(new Error("You cannot change this task."), { name: "TaskRuleError" });
      await transitionTask(db, id, { status, note: optional(form, "note"), waitingOn: optional(form, "waitingOn"), followUpDate: optional(form, "followUpDate") }, access.user.id);
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidateTask(id);
  return { ok: true, message: `Task marked ${status.replace("_", " ")}.` };
}

export async function addTaskNoteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const id = str(form, "taskId");
  try {
    await staffTx(access, async (db) => {
      const task = await getTask(db, id);
      if (!task || access.user.platform_role === "read_only") throw Object.assign(new Error("You cannot add notes to this task."), { name: "TaskRuleError" });
      await addTaskNote(db, id, str(form, "body"), access.user.id);
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidateTask(id);
  return { ok: true, message: "Note added." };
}
