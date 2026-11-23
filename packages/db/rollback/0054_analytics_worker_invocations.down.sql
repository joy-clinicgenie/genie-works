-- Rollback for 0054_analytics_worker_invocations.sql. Not run by db:migrate.
-- Deploy code that no longer writes invocation rows first (or set ANALYTICS_RECORD_INVOCATIONS=off),
-- then run this in one transaction as the owner role. It drops one table that holds only
-- worker run statistics. No job, report, connection or secret row is touched.
begin;
drop table if exists analytics_worker_invocations;
delete from schema_migrations where name = '0054_analytics_worker_invocations.sql';
commit;
