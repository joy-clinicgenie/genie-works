-- Soft-launch SEO settings consumed by connected Next.js clinic websites.

create table seo_page_settings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id),
  website_id uuid not null references websites (id),
  page_path text not null check (length(page_path) between 1 and 500),
  title text not null check (length(title) between 1 and 200),
  description text not null check (length(description) between 1 and 320),
  canonical_path text check (canonical_path is null or (canonical_path like '/%' and canonical_path not like '//%')),
  indexable boolean not null default true,
  updated_by uuid not null references staff_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, page_path)
);
create index seo_page_settings_client_idx on seo_page_settings (client_id, website_id);

create table seo_website_settings (
  website_id uuid primary key references websites (id),
  client_id uuid not null references clients (id),
  google_site_verification text check (google_site_verification is null or length(google_site_verification) between 1 and 200),
  updated_by uuid not null references staff_users (id),
  updated_at timestamptz not null default now()
);

create table seo_redirects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id),
  website_id uuid not null references websites (id),
  source_path text not null check (length(source_path) between 1 and 500 and source_path like '/%' and source_path not like '//%'),
  destination_path text not null check (length(destination_path) between 1 and 500 and destination_path like '/%' and destination_path not like '//%'),
  active boolean not null default true,
  created_by uuid not null references staff_users (id),
  updated_by uuid not null references staff_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_path <> destination_path)
);
create unique index seo_redirects_active_source_idx on seo_redirects (website_id, source_path) where active;
create index seo_redirects_client_idx on seo_redirects (client_id, website_id, source_path);

create table seo_site_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id),
  website_id uuid not null references websites (id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references staff_users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index seo_site_tokens_website_idx on seo_site_tokens (website_id) where revoked_at is null;

create table seo_business_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id),
  branch_name text not null check (length(branch_name) between 1 and 120),
  profile_url text check (profile_url is null or profile_url ~ '^https://'),
  external_identifier text,
  setup_status text not null default 'not_started' check (setup_status in ('not_started', 'in_progress', 'staff_marked_verified')),
  notes text,
  updated_by uuid not null references staff_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, branch_name)
);
create index seo_business_profiles_client_idx on seo_business_profiles (client_id, branch_name);

create or replace function seo_website_tenant_check() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from websites w where w.id = new.website_id and w.client_id = new.client_id) then
    raise exception 'website does not belong to this client' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger seo_page_settings_tenant_trg before insert or update on seo_page_settings
  for each row execute function seo_website_tenant_check();
create trigger seo_website_settings_tenant_trg before insert or update on seo_website_settings
  for each row execute function seo_website_tenant_check();
create trigger seo_redirects_tenant_trg before insert or update on seo_redirects
  for each row execute function seo_website_tenant_check();
create trigger seo_site_tokens_tenant_trg before insert or update on seo_site_tokens
  for each row execute function seo_website_tenant_check();

do $$
declare t text;
begin
  foreach t in array array['seo_page_settings','seo_website_settings','seo_redirects','seo_business_profiles'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_select on %I for select using (app_can_access_client(client_id))', t, t);
    execute format('create policy %I_edit on %I for all using (app_can_edit_client(client_id)) with check (app_can_edit_client(client_id))', t, t);
  end loop;
end $$;

alter table seo_site_tokens enable row level security;
create policy seo_site_tokens_service on seo_site_tokens for all
  using (app_is_service()) with check (app_is_service());
