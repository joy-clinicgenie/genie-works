-- Analytics Phase 2.2: one row per worker invocation, so a scheduled run can be audited and
-- overlapping runs can be capped. Additive only: one new table, no change to any existing row,
-- column, index or policy. Recovery: packages/db/rollback/0054_analytics_worker_invocations.down.sql.

create table analytics_worker_invocations (
  id uuid primary key default gen_random_uuid(),
  owner text not null check (length(owner) between 1 and 80),
  trigger text not null default 'schedule' check (trigger in ('schedule', 'manual', 'cli', 'simulation')),
  state text not null default 'running' check (state in ('running', 'finished', 'abandoned')),
  started_at timestamptz not null,
  finished_at timestamptz,
  stop_reason text check (stop_reason in ('idle', 'empty', 'limit', 'deadline', 'overlap', 'error')),
  budget_ms integer check (budget_ms is null or budget_ms > 0),
  job_limit integer check (job_limit is null or job_limit > 0),
  planned integer not null default 0 check (planned >= 0),
  jobs integer not null default 0 check (jobs >= 0),
  succeeded integer not null default 0 check (succeeded >= 0),
  failed integer not null default 0 check (failed >= 0),
  retried integer not null default 0 check (retried >= 0),
  reconnect integer not null default 0 check (reconnect >= 0),
  not_configured integer not null default 0 check (not_configured >= 0),
  stale integer not null default 0 check (stale >= 0),
  maintenance_ran boolean not null default false,
  remaining_due integer check (remaining_due is null or remaining_due >= 0),
  remaining_waiting integer check (remaining_waiting is null or remaining_waiting >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  safe_error_code text check (safe_error_code is null or length(safe_error_code) <= 80)
);

create index analytics_worker_invocations_started_idx on analytics_worker_invocations (started_at desc);
create index analytics_worker_invocations_running_idx on analytics_worker_invocations (started_at) where state = 'running';

alter table analytics_worker_invocations enable row level security;

create policy analytics_worker_invocations_select on analytics_worker_invocations
  for select using (app_is_global() or app_is_service());
create policy analytics_worker_invocations_write on analytics_worker_invocations
  for all using (app_is_service()) with check (app_is_service());
