-- Additive analytics connections, jobs and report partitions.
-- Existing report_snapshots stay. Secrets are service-context only.
-- Counts use numeric so the application type parser returns numbers. Missing values stay null.

alter table websites add constraint websites_id_client_key unique (id, client_id);

create table analytics_connections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  provider text not null check (provider in ('ga4', 'wix', 'gsc')),
  external_property_id text not null check (length(external_property_id) between 1 and 300),
  stream_or_site_ref text check (stream_or_site_ref is null or length(stream_or_site_ref) between 1 and 300),
  secret_ref uuid,
  status text not null default 'pending' check (status in ('pending', 'connected', 'reconnect_required', 'disconnected')),
  provider_timezone text check (provider_timezone is null or length(provider_timezone) between 1 and 80),
  verified_at timestamptz,
  version integer not null default 1 check (version > 0),
  disconnected_at timestamptz,
  created_by uuid references staff_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id),
  unique (id, client_id, website_id)
);
create unique index analytics_connections_active_idx
  on analytics_connections (website_id, provider, external_property_id)
  where disconnected_at is null;
create index analytics_connections_client_idx on analytics_connections (client_id, website_id);

create table analytics_secrets (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid,
  client_id uuid not null,
  website_id uuid not null,
  ciphertext text not null check (length(ciphertext) between 1 and 8000),
  nonce text not null check (length(nonce) between 1 and 80),
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id)
);
alter table analytics_connections
  add constraint analytics_connections_secret_ref_fkey foreign key (secret_ref) references analytics_secrets (id);

create table analytics_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid not null references staff_users (id),
  client_id uuid not null,
  website_id uuid not null,
  provider text not null check (provider in ('ga4', 'wix', 'gsc')),
  redirect_uri text not null check (length(redirect_uri) between 1 and 400),
  code_verifier_ciphertext text,
  code_verifier_nonce text,
  token_ciphertext text,
  token_nonce text,
  expires_at timestamptz not null,
  exchanged_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id)
);

create table analytics_capabilities (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  client_id uuid not null,
  website_id uuid not null,
  template_key text not null check (length(template_key) between 1 and 80),
  schema_hash text not null check (schema_hash ~ '^[0-9a-f]{64}$'),
  supported_metrics jsonb not null default '[]',
  supported_dimensions jsonb not null default '[]',
  dependencies jsonb not null default '[]',
  oldest_available_date date,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('supported', 'partial', 'unsupported', 'not_connected')),
  foreign key (connection_id, client_id, website_id) references analytics_connections (id, client_id, website_id),
  unique (connection_id, template_key, schema_hash),
  check (octet_length(supported_metrics::text) < 20000),
  check (octet_length(supported_dimensions::text) < 20000)
);

create table analytics_source_policies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  report_family text not null check (length(report_family) between 1 and 80),
  connection_id uuid not null,
  effective_from date not null,
  effective_to date,
  metric_definition_version integer not null default 1,
  changed_by uuid references staff_users (id),
  created_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id),
  foreign key (connection_id, client_id, website_id) references analytics_connections (id, client_id, website_id),
  check (effective_to is null or effective_from <= effective_to)
);

create or replace function analytics_policy_no_overlap() returns trigger
language plpgsql as $$
begin
  if exists (
    select 1 from analytics_source_policies p
    where p.website_id = new.website_id
      and p.report_family = new.report_family
      and p.id is distinct from new.id
      and p.effective_from <= coalesce(new.effective_to, date '9999-12-31')
      and new.effective_from <= coalesce(p.effective_to, date '9999-12-31')
  ) then
    raise exception 'overlapping analytics source policy' using errcode = 'exclusion_violation';
  end if;
  return new;
end $$;

create trigger analytics_source_policies_overlap_trg
  before insert or update on analytics_source_policies
  for each row execute function analytics_policy_no_overlap();

create table analytics_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  connection_id uuid not null,
  template_key text not null,
  query_hash text not null check (query_hash ~ '^[0-9a-f]{64}$'),
  start_date date not null,
  end_date date not null,
  state text not null default 'queued' check (state in ('queued', 'leased', 'succeeded', 'failed', 'reconnect_required', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  cursor jsonb not null default '{}',
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_id, client_id, website_id) references analytics_connections (id, client_id, website_id),
  check (start_date <= end_date),
  check (octet_length(cursor::text) < 8000)
);
create unique index analytics_jobs_active_idx
  on analytics_jobs (connection_id, template_key, query_hash, start_date, end_date)
  where state in ('queued', 'leased');
create index analytics_jobs_due_idx on analytics_jobs (state, next_attempt_at);
create index analytics_jobs_lease_idx on analytics_jobs (lease_until) where state = 'leased';

create table analytics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references analytics_jobs (id),
  client_id uuid not null,
  website_id uuid not null,
  connection_id uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result text not null check (result in ('running', 'succeeded', 'failed', 'reconnect_required')),
  pages_fetched integer not null default 0 check (pages_fetched >= 0),
  rows_fetched integer not null default 0 check (rows_fetched >= 0),
  quota_meta jsonb not null default '{}',
  safe_error_code text,
  check (octet_length(quota_meta::text) < 4000)
);

create table analytics_report_partitions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  connection_id uuid not null,
  template_key text not null,
  query_hash text not null check (query_hash ~ '^[0-9a-f]{64}$'),
  start_date date not null,
  end_date date not null,
  source_timezone text not null,
  dimensions jsonb not null default '[]',
  filters jsonb not null default '{}',
  metric_version integer not null default 1,
  provenance text not null check (provenance in ('api', 'imported', 'recorded', 'demo')),
  fetched_at timestamptz not null default now(),
  measured_through date,
  completeness text not null check (completeness in ('partial', 'complete', 'empty', 'failed')),
  quality jsonb not null default '{}',
  generation integer not null check (generation > 0),
  published boolean not null default false,
  foreign key (connection_id, client_id, website_id) references analytics_connections (id, client_id, website_id),
  unique (id, client_id, website_id),
  unique (connection_id, query_hash, generation),
  check (start_date <= end_date)
);
create unique index analytics_partitions_published_idx
  on analytics_report_partitions (connection_id, query_hash)
  where published and completeness in ('complete', 'empty');
create index analytics_partitions_lookup_idx
  on analytics_report_partitions (client_id, website_id, template_key, start_date, end_date);

create table analytics_report_rows (
  id uuid primary key default gen_random_uuid(),
  partition_id uuid not null,
  client_id uuid not null,
  website_id uuid not null,
  dimension_key text not null check (length(dimension_key) between 1 and 400),
  dimensions jsonb not null default '{}',
  foreign key (partition_id, client_id, website_id) references analytics_report_partitions (id, client_id, website_id),
  unique (id, client_id, website_id),
  unique (partition_id, dimension_key)
);
create index analytics_report_rows_partition_idx on analytics_report_rows (partition_id);

create table analytics_metric_values (
  report_row_id uuid not null,
  client_id uuid not null,
  website_id uuid not null,
  metric_key text not null check (length(metric_key) between 1 and 80),
  value_numeric numeric,
  value_state text not null check (value_state in ('available', 'unavailable', 'suppressed', 'unsupported')),
  numerator numeric,
  denominator numeric,
  primary key (report_row_id, metric_key),
  foreign key (report_row_id, client_id, website_id) references analytics_report_rows (id, client_id, website_id),
  check (
    (value_state = 'available' and value_numeric is not null)
    or (value_state in ('unavailable', 'suppressed', 'unsupported') and value_numeric is null)
  ),
  check (value_numeric is null or value_numeric >= 0),
  check (numerator is null or numerator >= 0),
  check (denominator is null or denominator > 0)
);

create table analytics_coverage (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  connection_id uuid not null,
  template_key text not null,
  source_date date not null,
  state text not null check (state in ('missing', 'partial', 'complete')),
  tracking_active boolean not null,
  fetched_at timestamptz not null default now(),
  measured_through date,
  safe_reason text,
  foreign key (connection_id, client_id, website_id) references analytics_connections (id, client_id, website_id),
  unique (connection_id, template_key, source_date)
);
create index analytics_coverage_lookup_idx on analytics_coverage (connection_id, template_key, source_date);

create table analytics_imports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  connection_id uuid,
  file_checksum text not null check (file_checksum ~ '^[0-9a-f]{64}$'),
  report_type text not null,
  source_timezone text not null,
  date_start date not null,
  date_end date not null,
  row_count integer not null check (row_count >= 0),
  state text not null check (state in ('preview', 'rejected', 'accepted')),
  created_by uuid references staff_users (id),
  provenance_ref text,
  created_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id),
  unique (website_id, report_type, file_checksum),
  check (date_start <= date_end)
);

create table analytics_page_registry (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  page_key text not null,
  canonical_path text not null check (canonical_path like '/%' and canonical_path not like '%?%' and length(canonical_path) <= 500),
  content_type text not null default 'page',
  content_id text,
  title text,
  valid_from date not null,
  valid_to date,
  foreign key (website_id, client_id) references websites (id, client_id),
  check (valid_to is null or valid_from <= valid_to)
);

create table analytics_annotations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  source_date date not null,
  kind text not null check (kind in ('tracking', 'deployment', 'source')),
  safe_text text not null check (length(safe_text) between 1 and 240),
  created_by uuid references staff_users (id),
  created_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id)
);

create table analytics_report_exports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  actor_id uuid not null references staff_users (id),
  query_hash text not null,
  snapshot_generation integer not null,
  state text not null check (state in ('ready', 'expired')),
  expires_at timestamptz not null,
  safe_file_ref text,
  created_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id)
);

alter table analytics_connections enable row level security;
alter table analytics_secrets enable row level security;
alter table analytics_oauth_states enable row level security;
alter table analytics_capabilities enable row level security;
alter table analytics_source_policies enable row level security;
alter table analytics_jobs enable row level security;
alter table analytics_sync_runs enable row level security;
alter table analytics_report_partitions enable row level security;
alter table analytics_report_rows enable row level security;
alter table analytics_metric_values enable row level security;
alter table analytics_coverage enable row level security;
alter table analytics_imports enable row level security;
alter table analytics_page_registry enable row level security;
alter table analytics_annotations enable row level security;
alter table analytics_report_exports enable row level security;

create policy analytics_connections_select on analytics_connections for select using (app_can_access_client(client_id));
create policy analytics_connections_write on analytics_connections for all using (app_is_global()) with check (app_is_global());

create policy analytics_secrets_service on analytics_secrets for all using (app_is_service()) with check (app_is_service());
create policy analytics_oauth_states_service on analytics_oauth_states for all using (app_is_service()) with check (app_is_service());

create policy analytics_capabilities_select on analytics_capabilities for select using (app_can_access_client(client_id));
create policy analytics_capabilities_write on analytics_capabilities for all using (app_is_service()) with check (app_is_service());

create policy analytics_source_policies_select on analytics_source_policies for select using (app_can_access_client(client_id));
create policy analytics_source_policies_write on analytics_source_policies for all using (app_is_global()) with check (app_is_global());

create policy analytics_jobs_select on analytics_jobs for select using (app_can_access_client(client_id));
create policy analytics_jobs_write on analytics_jobs for all using (app_is_service()) with check (app_is_service());

create policy analytics_sync_runs_select on analytics_sync_runs for select using (app_can_access_client(client_id));
create policy analytics_sync_runs_write on analytics_sync_runs for all using (app_is_service()) with check (app_is_service());

create policy analytics_report_partitions_select on analytics_report_partitions for select using (app_can_access_client(client_id));
create policy analytics_report_partitions_write on analytics_report_partitions for all using (app_is_service()) with check (app_is_service());
create policy analytics_report_rows_select on analytics_report_rows for select using (app_can_access_client(client_id));
create policy analytics_report_rows_write on analytics_report_rows for all using (app_is_service()) with check (app_is_service());
create policy analytics_metric_values_select on analytics_metric_values for select using (app_can_access_client(client_id));
create policy analytics_metric_values_write on analytics_metric_values for all using (app_is_service()) with check (app_is_service());
create policy analytics_coverage_select on analytics_coverage for select using (app_can_access_client(client_id));
create policy analytics_coverage_write on analytics_coverage for all using (app_is_service()) with check (app_is_service());

create policy analytics_imports_select on analytics_imports for select using (app_can_access_client(client_id));
create policy analytics_imports_write on analytics_imports for all using (app_is_global()) with check (app_is_global());
create policy analytics_page_registry_select on analytics_page_registry for select using (app_can_access_client(client_id));
create policy analytics_page_registry_write on analytics_page_registry for all using (app_is_service()) with check (app_is_service());
create policy analytics_annotations_select on analytics_annotations for select using (app_can_access_client(client_id));
create policy analytics_annotations_write on analytics_annotations for all using (app_is_global()) with check (app_is_global());
create policy analytics_report_exports_select on analytics_report_exports for select using (app_can_access_client(client_id));
create policy analytics_report_exports_write on analytics_report_exports for all using (app_is_global()) with check (app_is_global());
