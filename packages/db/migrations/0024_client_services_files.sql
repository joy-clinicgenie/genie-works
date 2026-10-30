-- Client services are a plain description, separate from channel tags.
-- Client files are titled https links. The platform does not store the file bytes.
-- An article cannot name a website that belongs to a different client.

alter table clients add column services text;
alter table clients add constraint clients_services_length check (services is null or char_length(services) <= 2000);

update clients set services = 'General dentistry (fictional service list).'
where slug = 'harbourview-dental' and services is null;
update clients set services = 'Dermatology consultations (fictional service list).'
where slug = 'meridian-skin' and services is null;
update clients set services = 'Physiotherapy sessions (fictional service list).'
where slug = 'northgate-physio' and services is null;

create table client_file_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id),
  title text not null check (char_length(title) between 1 and 160),
  url text not null check (url ~ '^https://' and char_length(url) <= 2000),
  notes text check (notes is null or char_length(notes) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references staff_users (id)
);
create index client_file_links_client_idx on client_file_links (client_id) where active;

alter table client_file_links enable row level security;
create policy client_file_links_select on client_file_links for select using (app_can_access_client(client_id));
create policy client_file_links_write on client_file_links for all using (app_is_global()) with check (app_is_global());
grant select, insert, update on client_file_links to cg_app;

alter table blog_articles
  add constraint blog_articles_website_client_fk
  foreign key (website_id, client_id) references websites (id, client_id);
