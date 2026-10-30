-- Soft-launch tasks: a task can be internal, carry a reference link, and be blocked without a follow-up.

alter table tasks add column reference_url text;
alter table tasks add constraint tasks_reference_url check (reference_url is null or reference_url ~ '^https?://\S+$');

alter table tasks drop constraint tasks_waiting_needs_details;
alter table tasks alter column client_id drop not null;
alter table task_history alter column client_id drop not null;
alter table task_notes alter column client_id drop not null;

-- Internal tasks have no client. Signed-in staff can read them. Read-only staff cannot change them.
drop policy tasks_select on tasks;
drop policy tasks_edit on tasks;
create policy tasks_select on tasks for select using (
  (client_id is null and app_current_user_id() is not null) or app_can_access_client(client_id)
);
create policy tasks_edit on tasks for all using (
  (client_id is null and app_platform_role() in ('admin', 'manager', 'specialist', 'reviewer'))
  or app_can_edit_client(client_id)
) with check (
  (client_id is null and app_platform_role() in ('admin', 'manager', 'specialist', 'reviewer'))
  or app_can_edit_client(client_id)
);

drop policy task_history_select on task_history;
drop policy task_history_edit on task_history;
create policy task_history_select on task_history for select using (
  (client_id is null and app_current_user_id() is not null) or app_can_access_client(client_id)
);
create policy task_history_edit on task_history for all using (
  (client_id is null and app_platform_role() in ('admin', 'manager', 'specialist', 'reviewer'))
  or app_can_edit_client(client_id)
) with check (
  (client_id is null and app_platform_role() in ('admin', 'manager', 'specialist', 'reviewer'))
  or app_can_edit_client(client_id)
);

drop policy task_notes_select on task_notes;
drop policy task_notes_edit on task_notes;
create policy task_notes_select on task_notes for select using (
  (client_id is null and app_current_user_id() is not null) or app_can_access_client(client_id)
);
create policy task_notes_edit on task_notes for all using (
  (client_id is null and app_platform_role() in ('admin', 'manager', 'specialist', 'reviewer'))
  or app_can_edit_client(client_id)
) with check (
  (client_id is null and app_platform_role() in ('admin', 'manager', 'specialist', 'reviewer'))
  or app_can_edit_client(client_id)
);
