-- 0008 Client directory details, contacts, account owners and operational contacts.
-- Contract dates, service scope and renewal reminders are intentionally not stored yet.

alter table clients
  add column reference_number text,
  add column specialty text,
  add column legal_name text,
  add column public_name text,
  add column address text,
  add column contact_email text,
  add column contact_phone text,
  add column enquiry_owner_user_id uuid references staff_users (id),
  add column notification_owner_user_id uuid references staff_users (id),
  add column administration_owner_user_id uuid references staff_users (id),
  add column created_by uuid references staff_users (id),
  add column updated_by uuid references staff_users (id),
  add column updated_at timestamptz;

update clients set updated_at = coalesce(archived_at, created_at) where updated_at is null;
alter table clients alter column updated_at set default now();
alter table clients alter column updated_at set not null;

create unique index clients_reference_number_idx on clients (reference_number) where reference_number is not null;

update clients c
set created_by = a.actor_user_id
from (
  select distinct on (client_id) client_id, actor_user_id
  from audit_events
  where action = 'client.create' and actor_user_id is not null
  order by client_id, occurred_at
) a
where c.id = a.client_id and c.created_by is null;

alter table account_references
  add column owner_user_id uuid references staff_users (id);

create table client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id),
  name text not null,
  designation text,
  work_email text,
  work_phone text,
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references staff_users (id),
  updated_by uuid references staff_users (id)
);
create index client_contacts_client_idx on client_contacts (client_id) where active;
create unique index client_contacts_one_primary_idx on client_contacts (client_id) where is_primary and active;

alter table client_contacts enable row level security;
create policy client_contacts_select on client_contacts for select using (app_can_access_client(client_id));
create policy client_contacts_write on client_contacts for all using (app_is_global()) with check (app_is_global());

grant select, insert, update on client_contacts to cg_app;

-- Demonstration rows already in a local database. A fresh seed writes the same fictional details.
update clients set
  reference_number = 'CG-001',
  specialty = 'General dentistry',
  legal_name = 'Harbourview Dental Pte. Ltd. (fictional)',
  public_name = 'Harbourview Dental',
  address = '18 Harbour Road, Singapore (fictional)',
  contact_email = 'hello@harbourview-dental.example.invalid',
  contact_phone = '+65 6000 0001',
  enquiry_owner_user_id = owner_user_id,
  notification_owner_user_id = owner_user_id,
  administration_owner_user_id = owner_user_id
where slug = 'harbourview-dental' and reference_number is null;

update clients set
  reference_number = 'CG-002',
  specialty = 'Dermatology',
  legal_name = 'Meridian Skin Pte. Ltd. (fictional)',
  public_name = 'Meridian Skin Clinic',
  address = '42 Meridian Avenue, Singapore (fictional)',
  contact_email = 'hello@meridian-skin.example.invalid',
  contact_phone = '+65 6000 0002',
  enquiry_owner_user_id = owner_user_id,
  notification_owner_user_id = owner_user_id,
  administration_owner_user_id = owner_user_id
where slug = 'meridian-skin' and reference_number is null;

update clients set
  reference_number = 'CG-003',
  specialty = 'Physiotherapy',
  legal_name = 'Northgate Physio Pte. Ltd. (fictional)',
  public_name = 'Northgate Physio',
  address = '7 Northgate Lane, Singapore (fictional)',
  contact_email = 'hello@northgate-physio.example.invalid',
  contact_phone = '+65 6000 0003',
  enquiry_owner_user_id = owner_user_id,
  notification_owner_user_id = owner_user_id,
  administration_owner_user_id = owner_user_id
where slug = 'northgate-physio' and reference_number is null;

update account_references r
set owner_user_id = c.owner_user_id
from clients c
where r.client_id = c.id
  and r.owner_user_id is null
  and c.slug in ('harbourview-dental', 'meridian-skin', 'northgate-physio');

insert into client_contacts (client_id, name, designation, work_email, work_phone, is_primary)
select c.id, v.name, v.designation, v.work_email, v.work_phone, true
from clients c
join (values
  ('harbourview-dental', 'Alex Tan (fictional)', 'Clinic director', 'hello@harbourview-dental.example.invalid', '+65 6000 0001'),
  ('meridian-skin', 'Priya Nair (fictional)', 'Practice manager', 'hello@meridian-skin.example.invalid', '+65 6000 0002'),
  ('northgate-physio', 'Jordan Lim (fictional)', 'Clinic coordinator', 'hello@northgate-physio.example.invalid', '+65 6000 0003')
) as v(slug, name, designation, work_email, work_phone) on v.slug = c.slug
where not exists (select 1 from client_contacts cc where cc.client_id = c.id);
