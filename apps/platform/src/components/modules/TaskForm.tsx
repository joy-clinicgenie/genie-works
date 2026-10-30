"use client";

import { useActionState } from "react";
import { TASK_PRIORITIES } from "@clinic-genie/contracts";
import { createTaskAction, updateTaskAction } from "@/app/actions/tasks";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/Field";
import { label } from "@/components/ui/Badge";
import type { ReactNode } from "react";

export interface TaskFormValues {
  taskId?: string;
  clientId: string;
  title?: string;
  description?: string | null;
  ownerUserId?: string;
  priority?: string;
  dueDate?: string | null;
}

export function TaskForm({ values, owners, relatedPicker, mode }: { values: TaskFormValues; owners: Array<{ id: string; display_name: string }>; relatedPicker: ReactNode; mode: "create" | "edit" }) {
  const [state, action, pending] = useActionState(mode === "create" ? createTaskAction : updateTaskAction, null);
  const err = (field: string) => (state && !state.ok && state.field === field ? state.error : null);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="clientId" value={values.clientId} />
      {values.taskId && <input type="hidden" name="taskId" value={values.taskId} />}
      <Field label="Title" htmlFor="title" required error={err("title")}>
        <Input id="title" name="title" defaultValue={values.title ?? ""} required maxLength={200} />
      </Field>
      <Field label="Description" htmlFor="description">
        <Textarea id="description" name="description" defaultValue={values.description ?? ""} maxLength={4000} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Accountable owner" htmlFor="ownerUserId" required hint="Exactly one person is accountable.">
          <Select id="ownerUserId" name="ownerUserId" defaultValue={values.ownerUserId ?? ""} required>
            <option value="" disabled>Choose</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.display_name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="priority" required>
          <Select id="priority" name="priority" defaultValue={values.priority ?? "medium"}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{label(p)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Due date" htmlFor="dueDate" hint="The deadline. Follow-up dates are set when a task waits." error={err("dueDate")}>
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values.dueDate ?? ""} />
        </Field>
      </div>
      {relatedPicker}
      <FormError state={state} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving" : mode === "create" ? "Create task" : "Save changes"}</Button>
      </div>
    </form>
  );
}
