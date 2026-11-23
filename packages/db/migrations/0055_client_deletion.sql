-- D84: deleting a client hides it for good. The client and every record tied to it leave every staff view, for every
-- role, admins included. Nothing is erased: audit events, approvals, timeline and report versions are append-only (D9),
-- so the rows stay for the audit trail and stay visible to service contexts (workers, backups).

alter table clients drop constraint clients_status_check;
alter table clients add constraint clients_status_check check (status in ('active', 'archived', 'deleted'));
alter table clients add column deleted_at timestamptz;
alter table clients add column deleted_by uuid references staff_users (id);
alter table clients add constraint clients_deleted_consistent check ((status = 'deleted') = (deleted_at is not null));

-- Security definer so the lookup ignores clients' own RLS (no policy recursion). A primary-key lookup per row.
create or replace function app_client_deleted(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clients where id = cid and status = 'deleted')
$$;

-- The three client checks every client-scoped policy uses. Service contexts keep full access.
create or replace function app_can_access_client(cid uuid) returns boolean
language sql stable as $$
  select app_is_service() or ((app_is_global() or app_has_membership(cid)) and not app_client_deleted(cid))
$$;

create or replace function app_can_edit_client(cid uuid) returns boolean
language sql stable as $$
  select app_is_service()
    or ((app_is_global() or (app_platform_role() = 'specialist' and app_has_membership(cid))) and not app_client_deleted(cid))
$$;

create or replace function app_can_review_client(cid uuid) returns boolean
language sql stable as $$
  select app_is_service()
    or ((app_is_global() or (app_platform_role() = 'reviewer' and app_has_membership(cid))) and not app_client_deleted(cid))
$$;

-- clients_global_write is FOR ALL, so it also grants SELECT to admins and managers: hide deleted rows from staff here.
create policy clients_hide_deleted on clients as restrictive for select using (app_is_service() or status <> 'deleted');

-- These tables also grant admins or managers a plain app_is_global()/app_is_admin() policy that skips the checks above,
-- so a restrictive policy hides (and blocks writes to) a deleted client's rows there too.
do $$
declare t text;
begin
  foreach t in array array['memberships', 'websites', 'account_references', 'client_contacts', 'form_routes', 'client_file_links',
    'website_forms', 'analytics_connections', 'analytics_source_policies', 'analytics_imports', 'analytics_annotations',
    'analytics_report_exports', 'blog_publications', 'wix_inbox_messages', 'wix_inbox_coverage'] loop
    execute format('create policy %I on %I as restrictive for all using (app_is_service() or not app_client_deleted(client_id)) with check (app_is_service() or not app_client_deleted(client_id))', t || '_hide_deleted_client', t);
  end loop;
end
$$;

-- The final step runs as owner: once the row says 'deleted' the policy above would reject the staff UPDATE's new row.
-- It checks for itself that the caller is an administrator acting as themselves.
create or replace function app_mark_client_deleted(cid uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  if app_platform_role() <> 'admin' or app_current_user_id() is null then
    raise exception 'Only an administrator can delete a client.' using errcode = 'insufficient_privilege';
  end if;
  update clients set status = 'deleted', deleted_at = now(), deleted_by = app_current_user_id(), updated_at = now(), updated_by = app_current_user_id()
   where id = cid and status <> 'deleted';
  return found;
end
$$;
revoke all on function app_mark_client_deleted(uuid) from public;
grant execute on function app_mark_client_deleted(uuid) to cg_app;
