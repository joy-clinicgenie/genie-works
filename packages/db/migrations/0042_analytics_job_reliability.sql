-- Durable analytics-worker recovery metadata and claim indexes.
-- Existing queue states and RLS policies remain unchanged.

alter table analytics_jobs
  add column manual_retry_count integer not null default 0 check (manual_retry_count >= 0),
  add column last_error_at timestamptz,
  add column failed_at timestamptz;

create index analytics_jobs_claim_idx
  on analytics_jobs (next_attempt_at, created_at, id)
  where state = 'queued';

create index analytics_jobs_connection_lease_idx
  on analytics_jobs (connection_id, lease_until)
  where state = 'leased';
