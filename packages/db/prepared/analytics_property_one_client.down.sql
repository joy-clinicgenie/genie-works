-- Rollback for prepared/analytics_property_one_client.sql. Not run by db:migrate.
-- Removes only what the guard added. No connection row, job, report or secret is changed or deleted.
-- Deploy first if the application is to stop expecting the guard: nothing in the application requires it.
begin;
drop trigger if exists analytics_connections_one_client on analytics_connections;
drop function if exists analytics_connections_one_client();
alter table analytics_connections drop column if exists cross_client_ack_reason;
-- If the guard was promoted to a numbered migration, also: delete from schema_migrations where name = '<that file name>';
commit;
