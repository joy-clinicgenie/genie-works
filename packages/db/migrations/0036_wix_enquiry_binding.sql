-- One website reads one enquiry source. A Wix binding stores the instance and form
-- ids only. Submission answers stay at Wix. Follow-up status is stored here.

alter table websites
  add column enquiry_source text not null default 'database',
  add column wix_instance_id text,
  add column wix_form_id text,
  add column wix_form_namespace text,
  add column wix_form_key text,
  add column wix_counts_in_totals boolean not null default false;

alter table websites
  add constraint websites_enquiry_source_check check (enquiry_source in ('database', 'wix')),
  add constraint websites_wix_form_key_format check (wix_form_key is null or wix_form_key ~ '^[a-z0-9-]{1,64}$'),
  add constraint websites_wix_binding_shape check (
    (
      enquiry_source = 'database'
      and wix_instance_id is null
      and wix_form_id is null
      and wix_form_namespace is null
      and wix_form_key is null
      and wix_counts_in_totals = false
    )
    or (
      enquiry_source = 'wix'
      and wix_instance_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and wix_form_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and wix_form_namespace = 'wix.form_app.form'
      and wix_form_key is not null
      and enquiry_key is not null
    )
  );

create unique index websites_wix_form_idx on websites (wix_instance_id, wix_form_id) where wix_form_id is not null;

create table enquiry_follow_ups (
  website_id uuid not null references websites (id),
  client_id uuid not null references clients (id),
  external_id uuid not null,
  status text not null default 'new' check (status in ('new', 'acknowledged', 'closed')),
  updated_at timestamptz not null default now(),
  primary key (website_id, external_id)
);
create index enquiry_follow_ups_external_idx on enquiry_follow_ups (external_id);
create index enquiry_follow_ups_client_idx on enquiry_follow_ups (client_id, updated_at desc);

create or replace function enquiry_follow_ups_owner_check() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from websites w
    where w.id = new.website_id and w.client_id = new.client_id and w.enquiry_source = 'wix'
  ) then
    raise exception 'Follow-up is only stored for a Wix enquiry website' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger enquiry_follow_ups_owner_trg before insert or update on enquiry_follow_ups
  for each row execute function enquiry_follow_ups_owner_check();

create or replace function enquiry_follow_ups_status_only() returns trigger
language plpgsql as $$
begin
  if new.website_id is distinct from old.website_id
     or new.client_id is distinct from old.client_id
     or new.external_id is distinct from old.external_id then
    raise exception 'Follow-up identity cannot change' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger enquiry_follow_ups_status_trg before update on enquiry_follow_ups
  for each row execute function enquiry_follow_ups_status_only();

alter table enquiry_follow_ups enable row level security;
create policy enquiry_follow_ups_select on enquiry_follow_ups for select using (app_can_access_client(client_id));
create policy enquiry_follow_ups_insert on enquiry_follow_ups for insert with check (app_can_edit_client(client_id));
create policy enquiry_follow_ups_update on enquiry_follow_ups for update using (app_can_edit_client(client_id)) with check (app_can_edit_client(client_id));
grant select, insert, update on enquiry_follow_ups to cg_app;
revoke delete on enquiry_follow_ups from cg_app;
