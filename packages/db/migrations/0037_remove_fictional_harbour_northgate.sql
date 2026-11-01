-- Removes the fictional Harbourview Dental and Northgate Physio clients and the
-- rows that belong to them. Append-only triggers are disabled only for this
-- purge. Deferred foreign keys are checked before the triggers are enabled
-- again. Other clients stay.

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
  rec record;
begin
  select coalesce(array_agg(id), '{}') into ids
  from clients
  where slug in ('harbourview-dental', 'northgate-physio');
  if cardinality(ids) = 0 then
    return;
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
    execute format('alter table %I disable trigger user', rec.table_name);
  end loop;

  update analytics_connections
  set secret_ref = null
  where client_id = any(ids)
     or website_id in (select id from websites where client_id = any(ids));

  perform purge_matching('clients', 'id = any($1)', ids, array[]::text[]);
  set constraints all immediate;

  if exists (select 1 from clients where id = any(ids)) then
    raise exception 'Harbourview Dental and Northgate Physio were not removed';
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
