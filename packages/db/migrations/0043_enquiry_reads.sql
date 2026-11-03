-- One row when a staff member opens an enquiry. Follow-up status is unchanged.
-- The row stores the client, the connector and the submission id. It does not
-- store the name, telephone, email or message.

create table enquiry_reads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id),
  external_id uuid not null,
  source text not null check (source in ('database', 'wix')),
  read_at timestamptz not null default now(),
  read_by uuid references staff_users (id)
);

create unique index enquiry_reads_identity_idx on enquiry_reads (source, external_id);
create index enquiry_reads_client_idx on enquiry_reads (client_id, read_at desc);

alter table enquiry_reads enable row level security;
create policy enquiry_reads_select on enquiry_reads for select using (app_can_access_client(client_id));
create policy enquiry_reads_insert on enquiry_reads for insert with check (app_can_access_client(client_id));

grant select, insert on enquiry_reads to cg_app;
revoke update, delete on enquiry_reads from cg_app;
