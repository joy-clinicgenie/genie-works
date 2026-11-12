-- Several forms on one website. A Wix website reads one app instance (0036, on
-- `websites`) and one row here per form it reads. Submission answers stay at Wix:
-- this table holds identifiers and the production-counting flag only.
--
-- `website_forms` (0034) is deliberately not reused. That table records the form
-- proposal applied to a vibe-coded website, including consent wording, screen
-- confirmation and the recipient contact, and it already holds rows whose
-- (website_id, form_key) would collide with a Wix binding of the same key.
-- Writing bindings there would overwrite consent wording and recipients.

create table website_enquiry_forms (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references websites (id),
  client_id uuid not null references clients (id),
  source text not null default 'wix' check (source in ('wix')),
  form_key text not null check (form_key ~ '^[a-z0-9-]{1,64}$'),
  provider_form_id text not null,
  provider_namespace text not null,
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  counts_in_totals boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references staff_users (id),
  constraint website_enquiry_forms_provider_shape check (
    source = 'wix'
    and provider_form_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and provider_namespace = 'wix.form_app.form'
  ),
  unique (website_id, form_key)
);

-- One provider form is read by one website, so the same submissions are never
-- counted twice under two clinics. This mirrors websites_wix_form_idx from 0036.
create unique index website_enquiry_forms_provider_idx on website_enquiry_forms (provider_form_id);
create index website_enquiry_forms_client_idx on website_enquiry_forms (client_id);
create index website_enquiry_forms_website_idx on website_enquiry_forms (website_id);

create or replace function website_enquiry_forms_owner_check() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from websites w
    where w.id = new.website_id and w.client_id = new.client_id and w.enquiry_source = 'wix'
  ) then
    raise exception 'A form is only stored for a Wix enquiry website of this client' using errcode = '23514';
  end if;
  if not exists (select 1 from websites w where w.id = new.website_id and w.wix_instance_id is not null) then
    raise exception 'Set the website Wix site id before adding a form' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger website_enquiry_forms_owner_trg before insert or update on website_enquiry_forms
  for each row execute function website_enquiry_forms_owner_check();

-- Changing which Wix form a website reads stays with an administrator, as in 0038.
create or replace function website_enquiry_forms_admin_only() returns trigger
language plpgsql as $$
begin
  if current_user <> 'cg_app' then
    return coalesce(new, old);
  end if;
  if app_is_admin() then
    return coalesce(new, old);
  end if;
  raise exception 'Only an administrator can change the forms a website reads' using errcode = '42501';
end $$;

create trigger website_enquiry_forms_admin_trg before insert or update or delete on website_enquiry_forms
  for each row execute function website_enquiry_forms_admin_only();

alter table website_enquiry_forms enable row level security;
create policy website_enquiry_forms_select on website_enquiry_forms for select using (app_can_access_client(client_id));
create policy website_enquiry_forms_insert on website_enquiry_forms for insert with check (app_can_edit_client(client_id));
create policy website_enquiry_forms_update on website_enquiry_forms for update using (app_can_edit_client(client_id)) with check (app_can_edit_client(client_id));
create policy website_enquiry_forms_delete on website_enquiry_forms for delete using (app_can_edit_client(client_id));
grant select, insert, update, delete on website_enquiry_forms to cg_app;

-- Backfill: every binding that 0036 stored on `websites` becomes a row here,
-- keeping its form key and its production-counting setting exactly.
insert into website_enquiry_forms (website_id, client_id, source, form_key, provider_form_id, provider_namespace, counts_in_totals)
select w.id, w.client_id, 'wix', w.wix_form_key, lower(w.wix_form_id), w.wix_form_namespace, w.wix_counts_in_totals
from websites w
where w.enquiry_source = 'wix'
  and w.wix_form_id is not null
  and w.wix_form_key is not null
  and w.wix_instance_id is not null
-- Defensive: a row may already exist if the binding service has run against this
-- database. Skipping it keeps the backfill safe to re-run and never duplicates a form.
on conflict do nothing;
