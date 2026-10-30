-- Follow-up history stays in Genie Works. The enquiry body stays in the clinic-website database.
-- Form routing is a proposal per website and form. Saving it does not change the website.

alter table websites add column enquiry_key text;
alter table websites add constraint websites_enquiry_key_format check (enquiry_key is null or enquiry_key ~ '^[a-z0-9-]{1,64}$');
create unique index websites_enquiry_key_idx on websites (enquiry_key) where enquiry_key is not null;

update websites set enquiry_key = 'harbourview-dental-wix'
where id = (
  select w.id from websites w
  join clients c on c.id = w.client_id
  where c.slug = 'harbourview-dental' and w.environment = 'production' and w.enquiry_key is null
  order by w.created_at
  limit 1
);

update websites set enquiry_key = 'meridian-skin-production'
where id = (
  select w.id from websites w
  join clients c on c.id = w.client_id
  where c.slug = 'meridian-skin' and w.environment = 'production' and w.enquiry_key is null
  order by w.created_at
  limit 1
);

update websites set enquiry_key = 'meridian-skin-staging'
where id = (
  select w.id from websites w
  join clients c on c.id = w.client_id
  where c.slug = 'meridian-skin' and w.environment = 'staging' and w.enquiry_key is null
  order by w.created_at
  limit 1
);

update websites set enquiry_key = 'northgate-physio-wix'
where id = (
  select w.id from websites w
  join clients c on c.id = w.client_id
  where c.slug = 'northgate-physio' and w.environment = 'production' and w.enquiry_key is null
  order by w.created_at
  limit 1
);

create table enquiry_status_events (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null,
  client_id uuid not null references clients (id),
  clinic_slug text not null check (clinic_slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  website_key text check (website_key is null or website_key ~ '^[a-z0-9-]{1,64}$'),
  from_status text not null check (from_status in ('new', 'acknowledged', 'closed')),
  to_status text not null check (to_status in ('new', 'acknowledged', 'closed')),
  note text check (note is null or char_length(note) <= 1000),
  actor_user_id uuid not null references staff_users (id),
  occurred_at timestamptz not null default now()
);
create index enquiry_status_events_enquiry_idx on enquiry_status_events (enquiry_id, occurred_at desc);
create index enquiry_status_events_client_idx on enquiry_status_events (client_id, occurred_at desc);

create trigger enquiry_status_events_no_update before update on enquiry_status_events for each row execute function block_mutation();
create trigger enquiry_status_events_no_delete before delete on enquiry_status_events for each row execute function block_mutation();

alter table enquiry_status_events enable row level security;
create policy enquiry_status_events_select on enquiry_status_events for select using (app_can_access_client(client_id));
create policy enquiry_status_events_insert on enquiry_status_events for insert with check (app_can_edit_client(client_id));
grant select, insert on enquiry_status_events to cg_app;
revoke update, delete on enquiry_status_events from cg_app;

create table website_forms (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references websites (id),
  client_id uuid not null references clients (id),
  form_key text not null check (form_key ~ '^[a-z0-9-]{1,64}$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  page_path text check (page_path is null or char_length(page_path) <= 300),
  proposed_active boolean not null default true,
  consent_wording text check (consent_wording is null or char_length(consent_wording) <= 2000),
  screen_confirmation text check (screen_confirmation is null or char_length(screen_confirmation) <= 1000),
  email_acknowledgement text check (email_acknowledgement is null or char_length(email_acknowledgement) <= 1000),
  recipient_contact_id uuid references client_contacts (id),
  application_status text not null default 'unable_to_verify' check (application_status in ('pending_website_update', 'applied', 'failed', 'unable_to_verify')),
  application_note text check (application_note is null or char_length(application_note) <= 300),
  last_verified_at timestamptz,
  updated_by uuid references staff_users (id),
  updated_at timestamptz not null default now(),
  unique (website_id, form_key)
);
create index website_forms_client_idx on website_forms (client_id);

create or replace function website_forms_owner_check() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from websites w where w.id = new.website_id and w.client_id = new.client_id) then
    raise exception 'The website does not belong to this client' using errcode = '23514';
  end if;
  if new.recipient_contact_id is not null and not exists (
    select 1 from client_contacts c where c.id = new.recipient_contact_id and c.client_id = new.client_id
  ) then
    raise exception 'Choose a contact from this client' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger website_forms_owner_trg before insert or update on website_forms
  for each row execute function website_forms_owner_check();

alter table website_forms enable row level security;
create policy website_forms_select on website_forms for select using (app_can_access_client(client_id));
create policy website_forms_write on website_forms for all using (app_is_global()) with check (app_is_global());
grant select, insert, update on website_forms to cg_app;

-- A previously saved client route becomes a proposal on each active website. It is not applied.
insert into website_forms (
  website_id, client_id, form_key, display_name, page_path, proposed_active,
  screen_confirmation, recipient_contact_id, application_status, updated_by, updated_at
)
select w.id, w.client_id, 'appointment-enquiry', 'Appointment enquiry', '/request-appointment', true,
       fr.confirmation_message, fr.recipient_contact_id, 'pending_website_update', fr.updated_by, fr.updated_at
from form_routes fr
join websites w on w.client_id = fr.client_id and w.status = 'active'
on conflict (website_id, form_key) do nothing;

insert into website_forms (website_id, client_id, form_key, display_name, page_path, proposed_active, application_status)
select w.id, w.client_id, v.form_key, v.display_name, v.page_path, true, 'unable_to_verify'
from websites w
join (
  values
    ('appointment-enquiry', 'Appointment enquiry', '/request-appointment'),
    ('contact', 'Contact', '/contact')
) as v(form_key, display_name, page_path) on true
where w.status = 'active'
on conflict (website_id, form_key) do nothing;
