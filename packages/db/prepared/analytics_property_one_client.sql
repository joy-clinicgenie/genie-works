-- PREPARED, NOT APPLIED. This file is deliberately outside packages/db/migrations, so `npm run db:migrate` never runs it.
-- Promote it to the next numbered migration only after `npm run analytics:audit` has been run against production
-- (or a restore point of it) and every `property_bound_to_other_client` finding is resolved or acknowledged.
--
-- What it does: one provider property can be connected under one client only. A second client's bind is refused by the
-- database itself, whatever code makes it. The application already refuses it first (connections.ts) with a readable
-- message; this is the backstop that holds even for a script, a restore or a future code path.
--
-- It is additive. It changes no existing row. It adds one nullable column, one function and one trigger.
-- Rollback: prepared/analytics_property_one_client.down.sql.
-- Conflict handling: prepared/README.md.
begin;

-- 1. Pre-flight. If any property is already connected under more than one client, stop and apply nothing.
do $$
declare conflicts integer;
begin
  select count(*) into conflicts from (
    select provider, lower(rtrim(external_property_id, '/')) as property
    from analytics_connections
    where status <> 'disconnected' and disconnected_at is null
    group by 1, 2
    having count(distinct client_id) > 1
  ) c;
  if conflicts > 0 then
    raise exception 'analytics property guard not applied: % property/properties are connected under more than one client. Run npm run analytics:audit, resolve them, then retry.', conflicts;
  end if;
end $$;

-- 2. A deliberate exception. Set by an administrator, with a reason, when two clients really do share a property.
alter table analytics_connections
  add column cross_client_ack_reason text
  check (cross_client_ack_reason is null or length(cross_client_ack_reason) between 10 and 300);

-- 3. The guard. Security definer, so it sees every client's connections whoever is writing (row level security
--    would otherwise hide other clients' rows from a non-administrator). Serialised per property.
create function analytics_connections_one_client() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'disconnected' or new.disconnected_at is not null or new.cross_client_ack_reason is not null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('analytics_property:' || new.provider || ':' || lower(rtrim(new.external_property_id, '/'))));
  if exists (
    select 1 from analytics_connections o
    where o.provider = new.provider
      and lower(rtrim(o.external_property_id, '/')) = lower(rtrim(new.external_property_id, '/'))
      and o.client_id <> new.client_id
      and o.id <> new.id
      and o.status <> 'disconnected' and o.disconnected_at is null
  ) then
    raise exception 'analytics_property_other_client' using errcode = '23505', detail = 'This provider property is already connected under another client.';
  end if;
  return new;
end $$;

create trigger analytics_connections_one_client
  before insert or update of external_property_id, client_id, status, disconnected_at
  on analytics_connections
  for each row execute function analytics_connections_one_client();

commit;
