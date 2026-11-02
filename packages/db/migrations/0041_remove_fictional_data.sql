-- Removes demonstration clients, placeholder websites, synthetic preview
-- figures, and demonstration staff accounts. Clinic directory rows stay.
-- Append-only triggers are disabled only for this purge.

create function purge_matching(target_table text, where_sql text, params uuid[], stack text[])
returns void
language plpgsql
as $fn$
declare
  ref record;
  child_where text;
begin
  if target_table = any(stack) or cardinality(stack) > 32 then
    return;
  end if;
  for ref in
    select src.relname as child,
           att.attname as child_column,
           patt.attname as parent_column
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_class dst on dst.oid = con.confrelid
    join pg_namespace ns on ns.oid = src.relnamespace
    join pg_attribute att on att.attrelid = src.oid and att.attnum = con.conkey[1] and not att.attisdropped
    join pg_attribute patt on patt.attrelid = dst.oid and patt.attnum = con.confkey[1] and not patt.attisdropped
    where con.contype = 'f'
      and ns.nspname = 'public'
      and dst.relname = target_table
      and cardinality(con.conkey) = 1
  loop
    child_where := format('%I in (select %I from %I where %s)', ref.child_column, ref.parent_column, target_table, where_sql);
    perform purge_matching(ref.child, child_where, params, stack || target_table);
  end loop;
  execute format('delete from %I where %s', target_table, where_sql) using params;
end;
$fn$;

do $purge$
declare
  ids uuid[];
  site_ids uuid[];
  staff_ids uuid[];
  rec record;
  leftover boolean;
begin
  for rec in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and exists (
        select 1 from pg_trigger t
        where t.tgrelid = c.oid and not t.tgisinternal
      )
  loop
    execute format('alter table %I disable trigger user', rec.table_name);
  end loop;

  select coalesce(array_agg(id), '{}') into ids
  from clients
  where is_synthetic
     or slug in ('harbourview-dental', 'meridian-skin', 'northgate-physio', 'v1-v01-access-check');

  if cardinality(ids) > 0 then
    update analytics_connections
    set secret_ref = null
    where client_id = any(ids)
       or website_id in (select id from websites where client_id = any(ids));
    perform purge_matching('clients', 'id = any($1)', ids, array[]::text[]);
  end if;

  select coalesce(array_agg(id), '{}') into site_ids
  from websites
  where url ilike '%example.invalid%';
  if cardinality(site_ids) > 0 then
    update analytics_connections
    set secret_ref = null
    where website_id = any(site_ids);
    perform purge_matching('websites', 'id = any($1)', site_ids, array[]::text[]);
  end if;

  update report_snapshots
  set supersedes_id = null
  where supersedes_id in (
    select id from report_snapshots
    where note = 'Synthetic demonstration figures for local preview. Not a live export.'
  );
  delete from report_snapshots
  where note = 'Synthetic demonstration figures for local preview. Not a live export.';
  update report_snapshots as snapshot
  set superseded_by_id = null
  where snapshot.superseded_by_id is not null
    and not exists (
      select 1 from report_snapshots current_row
      where current_row.id = snapshot.superseded_by_id
    );

  select coalesce(array_agg(id), '{}') into staff_ids
  from staff_users
  where email like '%@example.invalid';

  if cardinality(staff_ids) > 0 then
    delete from verification_token where lower(identifier) like '%@example.invalid';
    delete from users where lower(email) like '%@example.invalid';

    for rec in
      select src.relname as child,
             att.attname as child_column,
             att.attnotnull as required
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class dst on dst.oid = con.confrelid
      join pg_namespace ns on ns.oid = src.relnamespace
      join pg_attribute att on att.attrelid = src.oid and att.attnum = con.conkey[1] and not att.attisdropped
      where con.contype = 'f'
        and ns.nspname = 'public'
        and dst.relname = 'staff_users'
        and cardinality(con.conkey) = 1
        and not att.attnotnull
    loop
      execute format('update %I set %I = null where %I = any($1)', rec.child, rec.child_column, rec.child_column)
      using staff_ids;
    end loop;

    for rec in
      select src.relname as child,
             att.attname as child_column
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class dst on dst.oid = con.confrelid
      join pg_namespace ns on ns.oid = src.relnamespace
      join pg_attribute att on att.attrelid = src.oid and att.attnum = con.conkey[1] and not att.attisdropped
      where con.contype = 'f'
        and ns.nspname = 'public'
        and dst.relname = 'staff_users'
        and cardinality(con.conkey) = 1
        and att.attnotnull
        and src.relname not in ('memberships', 'analytics_oauth_states')
    loop
      execute format('select exists (select 1 from %I where %I = any($1))', rec.child, rec.child_column)
      into leftover
      using staff_ids;
      if leftover then
        raise exception 'A clinic record still names a demonstration account (%)', rec.child;
      end if;
    end loop;

    perform purge_matching('staff_users', 'id = any($1)', staff_ids, array[]::text[]);
  end if;

  set constraints all immediate;

  if exists (
    select 1 from clients
    where is_synthetic
       or slug in ('harbourview-dental', 'meridian-skin', 'northgate-physio', 'v1-v01-access-check')
  ) then
    raise exception 'A demonstration client was not removed';
  end if;
  if exists (
    select 1 from websites where url ilike '%example.invalid%'
  ) then
    raise exception 'A placeholder website was not removed';
  end if;
  if exists (
    select 1 from report_snapshots
    where note = 'Synthetic demonstration figures for local preview. Not a live export.'
  ) then
    raise exception 'Synthetic preview figures were not removed';
  end if;
  if exists (
    select 1 from staff_users where email like '%@example.invalid'
  ) then
    raise exception 'A demonstration account was not removed';
  end if;

  for rec in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and exists (
        select 1 from pg_trigger t
        where t.tgrelid = c.oid and not t.tgisinternal
      )
  loop
    execute format('alter table %I enable trigger user', rec.table_name);
  end loop;
end
$purge$;

drop function purge_matching(text, text, uuid[], text[]);
