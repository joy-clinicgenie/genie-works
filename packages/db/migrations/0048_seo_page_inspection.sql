-- SEO-03.2 and SEO-03.3 (D61): independent page overrides, publication and live evidence, and an
-- append-only URL Inspection history that keeps the last successful Google result beside later failures.
-- Numbered 0048 so it sorts after any unmerged 0046/0047 work.

-- (1) Each page override is independent. A null value inherits the website or blog default.
alter table seo_page_settings alter column title drop not null;
alter table seo_page_settings alter column description drop not null;
alter table seo_page_settings alter column indexable drop not null;
alter table seo_page_settings alter column indexable drop default;
alter table seo_page_settings add constraint seo_page_settings_overrides_something
  check (title is not null or description is not null or indexable is not null or canonical_path is not null);
-- Clearing every override removes the row. The existing edit policy already covers delete.
grant delete on seo_page_settings to cg_app;

-- (2) Publication evidence: when the website last fetched its settings through the authenticated API.
create table seo_settings_deliveries (
  website_id uuid primary key,
  client_id uuid not null,
  last_served_at timestamptz not null,
  foreign key (website_id, client_id) references websites (id, client_id)
);

-- (3) Live evidence: what the public page served when staff checked it. No page body is stored.
create table seo_page_live_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  page_path text not null check (page_path like '/%' and page_path not like '//%' and length(page_path) between 1 and 500),
  page_url text not null check (length(page_url) between 1 and 2000),
  http_status integer check (http_status is null or http_status between 100 and 599),
  observed_title text check (observed_title is null or length(observed_title) <= 300),
  observed_description text check (observed_description is null or length(observed_description) <= 500),
  observed_robots text check (observed_robots is null or length(observed_robots) <= 300),
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  checked_by uuid references staff_users (id),
  checked_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id)
);
create index seo_page_live_checks_page_idx on seo_page_live_checks (website_id, page_path, checked_at desc);

-- (4) Every URL Inspection attempt. A failure never replaces an earlier success.
create table seo_url_inspections (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  page_path text not null check (page_path like '/%' and page_path not like '//%' and length(page_path) between 1 and 500),
  inspection_url text check (inspection_url is null or length(inspection_url) between 1 and 2000),
  property text check (property is null or length(property) between 1 and 300),
  source text not null check (source in ('manual', 'scheduled')),
  result text not null check (result in ('succeeded', 'failed')),
  verdict text check (verdict is null or verdict in ('VERDICT_UNSPECIFIED', 'PASS', 'PARTIAL', 'FAIL', 'NEUTRAL')),
  coverage_state text check (coverage_state is null or length(coverage_state) between 1 and 120),
  indexing_state text check (indexing_state is null or indexing_state ~ '^[A-Z_]{1,60}$'),
  page_fetch_state text check (page_fetch_state is null or page_fetch_state ~ '^[A-Z_0-9]{1,60}$'),
  robots_txt_state text check (robots_txt_state is null or robots_txt_state ~ '^[A-Z_]{1,60}$'),
  last_crawl_time timestamptz,
  google_canonical text check (google_canonical is null or length(google_canonical) <= 2000),
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  requested_by uuid references staff_users (id),
  checked_at timestamptz not null default now(),
  check ((result = 'succeeded') = (safe_error_code is null)),
  foreign key (website_id, client_id) references websites (id, client_id)
);
create index seo_url_inspections_page_idx on seo_url_inspections (website_id, page_path, checked_at desc);

create trigger seo_settings_deliveries_tenant_trg before insert or update on seo_settings_deliveries
  for each row execute function seo_website_tenant_check();
create trigger seo_page_live_checks_tenant_trg before insert or update on seo_page_live_checks
  for each row execute function seo_website_tenant_check();
create trigger seo_url_inspections_tenant_trg before insert or update on seo_url_inspections
  for each row execute function seo_website_tenant_check();

do $$
declare t text;
begin
  foreach t in array array['seo_settings_deliveries', 'seo_page_live_checks', 'seo_url_inspections'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_select on %I for select using (app_can_access_client(client_id))', t, t);
    execute format('create policy %I_write on %I for all using (app_is_service()) with check (app_is_service())', t, t);
  end loop;
end $$;

-- Evidence rows are append-only for the application role.
revoke update, delete on seo_page_live_checks, seo_url_inspections from cg_app;
