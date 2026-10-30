-- Saved reports for preparation and client review.
-- A version is the copy retained at each save. It is not edited afterwards.

create table saved_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id),
  name text not null check (char_length(name) between 1 and 160),
  period_start date not null,
  period_end date not null,
  comparison_start date,
  comparison_end date,
  sections text[] not null,
  summary text,
  observations text,
  actions_taken text,
  next_steps text,
  data_sources_note text,
  missing_connections text,
  measurement_limitations text,
  created_by uuid not null references staff_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_reports_period check (period_end >= period_start),
  constraint saved_reports_comparison check (
    (comparison_start is null and comparison_end is null)
    or (comparison_start is not null and comparison_end is not null and comparison_end >= comparison_start)
  ),
  constraint saved_reports_sections check (
    cardinality(sections) >= 1
    and sections <@ array['traffic', 'engagement', 'enquiries', 'search', 'campaigns']::text[]
  ),
  constraint saved_reports_text_length check (
    char_length(coalesce(summary, '')) <= 4000
    and char_length(coalesce(observations, '')) <= 4000
    and char_length(coalesce(actions_taken, '')) <= 4000
    and char_length(coalesce(next_steps, '')) <= 4000
    and char_length(coalesce(data_sources_note, '')) <= 2000
    and char_length(coalesce(missing_connections, '')) <= 2000
    and char_length(coalesce(measurement_limitations, '')) <= 2000
  )
);

create table saved_report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references saved_reports (id),
  client_id uuid not null references clients (id),
  version_number integer not null check (version_number >= 1),
  name text not null,
  period_start date not null,
  period_end date not null,
  comparison_start date,
  comparison_end date,
  sections text[] not null,
  summary text,
  observations text,
  actions_taken text,
  next_steps text,
  data_sources_note text,
  missing_connections text,
  measurement_limitations text,
  figures jsonb not null,
  data_sources text,
  last_refresh timestamptz,
  missing_connection_keys text[] not null default '{}',
  limitation_note text,
  for_review boolean not null default true,
  created_by uuid not null references staff_users (id),
  created_at timestamptz not null default now(),
  unique (report_id, version_number)
);

create index saved_reports_client_idx on saved_reports (client_id, created_at desc);
create index saved_report_versions_report_idx on saved_report_versions (report_id, version_number desc);

alter table saved_reports enable row level security;
alter table saved_report_versions enable row level security;

create policy saved_reports_select on saved_reports for select using (app_can_access_client(client_id));
create policy saved_reports_write on saved_reports for all using (app_can_edit_client(client_id)) with check (app_can_edit_client(client_id));
create policy saved_report_versions_select on saved_report_versions for select using (app_can_access_client(client_id));
create policy saved_report_versions_insert on saved_report_versions for insert with check (app_can_edit_client(client_id));

create trigger saved_report_versions_no_update before update on saved_report_versions for each row execute function block_mutation();
create trigger saved_report_versions_no_delete before delete on saved_report_versions for each row execute function block_mutation();

grant select, insert, update on saved_reports to cg_app;
grant select, insert on saved_report_versions to cg_app;
