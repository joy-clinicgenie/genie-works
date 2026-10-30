"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createLaunchTaskAction } from "@/app/actions/tasks";
import { Button, buttonClass } from "@/components/ui/Button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/Field";

export function AddTaskForm({
  closeHref,
  returnView,
  selfId,
  clients,
  owners,
}: {
  closeHref: string;
  returnView: string;
  selfId: string;
  clients: Array<{ id: string; label: string }>;
  owners: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState(createLaunchTaskAction, null);
  const err = (field: string) => (state && !state.ok && state.field === field ? state.error : null);
  const shown = state && !state.ok && state.field ? null : state;

  return (
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="returnView" value={returnView} />
      <Field label="Task title" htmlFor="title" required error={err("title")}>
        <Input id="title" name="title" required maxLength={200} placeholder="Review appointment form" autoFocus />
      </Field>
      <Field label="Client" htmlFor="clientId" required error={err("clientId")}>
        <Select id="clientId" name="clientId" defaultValue="" required>
          <option value="" disabled>Select a client</option>
          <option value="internal">Internal</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{client.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Description" htmlFor="description">
        <Textarea id="description" name="description" maxLength={4000} placeholder="Explain what needs to be done" />
      </Field>
      <Field label="Assigned to" htmlFor="ownerUserId" required error={err("ownerUserId")}>
        <Select id="ownerUserId" name="ownerUserId" defaultValue={selfId} required>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>{owner.name}</option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Priority" htmlFor="priority" required error={err("priority")}>
          <Select id="priority" name="priority" defaultValue="medium" required>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </Field>
        <Field label="Due date" htmlFor="dueDate" error={err("dueDate")}>
          <Input id="dueDate" name="dueDate" type="date" />
        </Field>
      </div>
      <Field label="Status" htmlFor="status" required error={err("status")}>
        <Select id="status" name="status" defaultValue="open" required>
          <option value="open">To do</option>
          <option value="in_progress">In progress</option>
          <option value="waiting">Blocked</option>
          <option value="completed">Completed</option>
        </Select>
      </Field>
      <Field label="Reference link" htmlFor="referenceUrl" error={err("referenceUrl")}>
        <Input id="referenceUrl" name="referenceUrl" type="url" inputMode="url" maxLength={2000} placeholder="Link to a document or relevant page" />
      </Field>
      <FormError state={shown} />
      <div className="flex justify-end gap-2 pt-1">
        <Link href={closeHref} className={buttonClass("secondary")}>Cancel</Link>
        <Button type="submit" disabled={pending}>Create task</Button>
      </div>
    </form>
  );
}
