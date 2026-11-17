-- D61: Wix is removed as an analytics source and as an enquiry source, and website
-- analytics is limited to the internal Clinic Genie client. Search Console connections
-- for every client stay, because SEO index checks and SEO performance read them.
--
-- websites.platform values such as 'Wix' stay: they record where a clinic site is
-- hosted, and the blog native-site guard depends on them. Historical audit_events rows
-- that mention Wix stay, because that table is append-only.

-- 1. Wix analytics connections and everything collected through them.
create temporary table wix_connections on commit drop as
  select id from analytics_connections where provider = 'wix';

delete from analytics_metric_values v
  using analytics_report_rows r, analytics_report_partitions p
  where v.report_row_id = r.id and r.partition_id = p.id
    and p.connection_id in (select id from wix_connections);
delete from analytics_report_rows r
  using analytics_report_partitions p
  where r.partition_id = p.id and p.connection_id in (select id from wix_connections);
delete from analytics_report_partitions where connection_id in (select id from wix_connections);
delete from analytics_sync_runs s
  using analytics_jobs j
  where s.job_id = j.id and j.connection_id in (select id from wix_connections);
delete from analytics_jobs where connection_id in (select id from wix_connections);
delete from analytics_coverage where connection_id in (select id from wix_connections);
delete from analytics_capabilities where connection_id in (select id from wix_connections);
delete from analytics_source_policies where connection_id in (select id from wix_connections);

create temporary table wix_secrets on commit drop as
  select secret_ref as id from analytics_connections
  where id in (select id from wix_connections) and secret_ref is not null;
delete from analytics_connections where id in (select id from wix_connections);
delete from analytics_secrets
  where id in (select id from wix_secrets)
    and not exists (select 1 from analytics_connections c where c.secret_ref = analytics_secrets.id);
delete from analytics_oauth_states where provider = 'wix';

alter table analytics_connections drop constraint analytics_connections_provider_check;
alter table analytics_connections add constraint analytics_connections_provider_check
  check (provider in ('ga4', 'gsc'));
alter table analytics_oauth_states drop constraint analytics_oauth_states_provider_check;
alter table analytics_oauth_states add constraint analytics_oauth_states_provider_check
  check (provider in ('ga4', 'gsc'));

-- 2. GA4 stops for every client except Clinic Genie. This mirrors disconnectConnection:
-- the connection is marked disconnected, its queued work is cancelled, and the change is
-- audited. Stored history is kept.
create temporary table ga4_disconnected on commit drop as
  select c.id, c.client_id from analytics_connections c
  join clients cl on cl.id = c.client_id
  where c.provider = 'ga4' and c.disconnected_at is null and cl.slug <> 'clinic-genie';

update analytics_connections
  set status = 'disconnected', disconnected_at = now(), updated_at = now()
  where id in (select id from ga4_disconnected);
update analytics_jobs
  set state = 'cancelled', updated_at = now()
  where connection_id in (select id from ga4_disconnected) and state in ('queued', 'leased');
insert into audit_events (actor_type, action, target_type, target_id, client_id, outcome, metadata)
  select 'system', 'analytics.connection.disconnect', 'analytics_connection', id::text, client_id, 'success',
         jsonb_build_object('reason', 'D61: website analytics is limited to Clinic Genie')
  from ga4_disconnected;

-- 3. Wix enquiry tables: Inbox records, form bindings and follow-up status.
drop table wix_inbox_messages;
drop table wix_inbox_coverage;
drop table website_enquiry_forms;
drop table enquiry_follow_ups;
drop function wix_inbox_owner_check();
drop function wix_inbox_messages_append_only();
drop function website_enquiry_forms_owner_check();
drop function website_enquiry_forms_admin_only();
drop function enquiry_follow_ups_owner_check();
drop function enquiry_follow_ups_status_only();

-- 4. The Wix binding columns on websites.
drop trigger websites_wix_binding_admin_trg on websites;
drop function websites_wix_binding_admin_only();
drop index websites_wix_form_idx;
alter table websites drop constraint websites_wix_binding_shape;
alter table websites drop constraint websites_wix_form_key_format;
alter table websites drop constraint websites_enquiry_source_check;
alter table websites
  drop column wix_instance_id,
  drop column wix_form_id,
  drop column wix_form_namespace,
  drop column wix_form_key,
  drop column wix_counts_in_totals,
  drop column enquiry_source;

-- 5. Read marks for Wix enquiries.
delete from enquiry_reads where source = 'wix';
alter table enquiry_reads drop constraint enquiry_reads_source_check;
alter table enquiry_reads add constraint enquiry_reads_source_check check (source in ('database'));

-- 6. Wix account references.
delete from account_references where kind = 'wix';
alter table account_references drop constraint account_references_kind_check;
alter table account_references add constraint account_references_kind_check
  check (kind in ('ga4', 'search_console', 'google_ads', 'tag_manager', 'google_business', 'hosting', 'domain', 'booking', 'other'));
