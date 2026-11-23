-- Rollback for 0053_analytics_scheduling.sql. Not run by db:migrate.
-- Order of operations: first deploy code that no longer reads these columns (or set ANALYTICS_PLANNER=v1
-- and redeploy the previous release), then run this file in one transaction as the owner role.
-- It removes only the objects 0053 added. No job, connection, report or secret row is deleted.
begin;
drop index if exists analytics_jobs_one_lease_idx;
drop index if exists analytics_jobs_class_idx;
alter table analytics_connections
  drop column if exists last_served_at,
  drop column if exists cooldown_until,
  drop column if exists consecutive_failures;
alter table analytics_jobs
  drop column if exists window_class,
  drop column if exists priority;
delete from schema_migrations where name = '0053_analytics_scheduling.sql';
commit;
