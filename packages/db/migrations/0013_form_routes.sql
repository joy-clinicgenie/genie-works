-- Approved form recipient and confirmation wording, kept in this platform.
-- The clinic website still sends mail from its own configuration.

create table form_routes (
  client_id uuid primary key references clients (id),
  recipient_contact_id uuid references client_contacts (id),
  confirmation_message text,
  updated_by uuid references staff_users (id),
  updated_at timestamptz not null default now(),
  constraint form_routes_message_length check (confirmation_message is null or char_length(confirmation_message) <= 1000)
);

alter table form_routes enable row level security;
create policy form_routes_select on form_routes for select using (app_can_access_client(client_id));
create policy form_routes_write on form_routes for all using (app_is_global()) with check (app_is_global());

grant select, insert, update on form_routes to cg_app;
