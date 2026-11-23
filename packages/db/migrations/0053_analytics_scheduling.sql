-- Analytics Phase 2.1: scheduling metadata for fair, bounded synchronisation.
-- Additive only. Existing rows, queue states, indexes and RLS policies are unchanged.
-- Recovery: docs/audits/ANALYTICS_PHASE_2_1_IMPLEMENTATION.md, "Rollback", and the
-- rollback statements are exercised by packages/db/test/analytics-scheduling.test.ts.

-- A job's reporting-window class (for example "p30", "prev30", "daily180") lets the planner
-- retire an older queued window of the same class when a newer one is queued.
alter table analytics_jobs
  add column window_class text check (window_class is null or window_class ~ '^[a-z0-9_]{1,24}$'),
  add column priority smallint not null default 50 check (priority between 0 and 100);

-- Fair scheduling and failure isolation per connection.
alter table analytics_connections
  add column last_served_at timestamptz,
  add column cooldown_until timestamptz,
  add column consecutive_failures integer not null default 0 check (consecutive_failures >= 0);

-- Planner lookup: queued, not yet leased jobs of one class on one connection.
create index analytics_jobs_class_idx
  on analytics_jobs (connection_id, template_key, window_class, end_date)
  where state = 'queued' and window_class is not null;

-- One leased job per connection, enforced by the database. leaseNext already avoids a second
-- lease, but two workers claiming different jobs of the same connection at the same moment
-- could both pass that check. Before applying to a database that has run workers, confirm
-- that `select connection_id from analytics_jobs where state = 'leased' group by 1 having count(*) > 1`
-- returns no row; otherwise reap those leases first.
create unique index analytics_jobs_one_lease_idx
  on analytics_jobs (connection_id)
  where state = 'leased';
