-- SEO-04.1 to SEO-04.4 (D62): stored results of bounded, read-only checks against a website's own address.

create table seo_sitemap_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  source text not null check (source in ('robots', 'default')),
  sitemap_url text not null check (length(sitemap_url) between 1 and 2048),
  final_url text check (final_url is null or length(final_url) <= 2048),
  http_status integer check (http_status is null or http_status between 100 and 599),
  kind text check (kind is null or kind in ('urlset', 'sitemapindex')),
  url_count integer not null default 0 check (url_count >= 0),
  result text not null check (result in ('passed', 'incomplete', 'failed')),
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  children jsonb not null default '[]' check (jsonb_typeof(children) = 'array' and octet_length(children::text) < 60000),
  checked_by uuid references staff_users (id),
  checked_at timestamptz not null default now(),
  check ((result = 'passed') = (safe_error_code is null)),
  foreign key (website_id, client_id) references websites (id, client_id)
);
create index seo_sitemap_checks_site_idx on seo_sitemap_checks (website_id, checked_at desc);

create table seo_robots_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  robots_url text not null check (length(robots_url) between 1 and 2048),
  final_url text check (final_url is null or length(final_url) <= 2048),
  http_status integer check (http_status is null or http_status between 100 and 599),
  availability text not null check (availability in ('available', 'not_found', 'unavailable')),
  body text check (body is null or octet_length(body) <= 512000),
  truncated boolean not null default false,
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  checked_by uuid references staff_users (id),
  checked_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id)
);
create index seo_robots_checks_site_idx on seo_robots_checks (website_id, checked_at desc);

create table seo_site_check_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  status text not null default 'running' check (status in ('running', 'completed')),
  attempted integer not null default 0 check (attempted >= 0),
  completed integer not null default 0 check (completed >= 0),
  failed integer not null default 0 check (failed >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  started_by uuid references staff_users (id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (id, website_id),
  foreign key (website_id, client_id) references websites (id, client_id)
);
-- One running check per website.
create unique index seo_site_check_runs_running_idx on seo_site_check_runs (website_id) where status = 'running';

create table seo_site_check_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  client_id uuid not null,
  website_id uuid not null,
  page_path text not null check (page_path like '/%' and length(page_path) between 1 and 500),
  url text check (url is null or length(url) <= 2048),
  outcome text not null check (outcome in ('completed', 'failed', 'skipped')),
  reason text check (reason is null or reason ~ '^[a-z0-9_]{1,64}$'),
  http_status integer check (http_status is null or http_status between 100 and 599),
  checked_at timestamptz not null default now(),
  check ((outcome = 'completed') = (reason is null)),
  foreign key (run_id, website_id) references seo_site_check_runs (id, website_id),
  foreign key (website_id, client_id) references websites (id, client_id)
);
create index seo_site_check_items_run_idx on seo_site_check_items (run_id);

create table seo_site_findings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  page_path text not null check (page_path like '/%' and length(page_path) between 1 and 500),
  check_type text not null check (check_type in ('http_error', 'missing_title', 'missing_description')),
  detail text check (detail is null or length(detail) <= 300),
  status text not null default 'open' check (status in ('open', 'resolved')),
  first_seen_run uuid not null,
  last_seen_run uuid not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  seen_count integer not null default 1 check (seen_count >= 1),
  resolved_run uuid,
  resolved_at timestamptz,
  -- Reserved for the Issues link (SEO build pack Part 6).
  issue_id uuid,
  foreign key (website_id, client_id) references websites (id, client_id)
);
-- A repeat finding stays one open finding per website, page and check type.
create unique index seo_site_findings_open_idx on seo_site_findings (website_id, page_path, check_type) where status = 'open';

create table seo_redirect_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  source_path text not null check (source_path like '/%' and length(source_path) between 1 and 500),
  expected_path text not null check (expected_path like '/%' and length(expected_path) between 1 and 500),
  result text not null check (result in ('passed', 'failed')),
  failure text check (failure is null or failure ~ '^[a-z0-9_]{1,64}$'),
  failing_hop integer check (failing_hop is null or failing_hop >= 0),
  hops jsonb not null default '[]' check (jsonb_typeof(hops) = 'array' and octet_length(hops::text) < 30000),
  final_url text check (final_url is null or length(final_url) <= 2048),
  final_status integer check (final_status is null or final_status between 100 and 599),
  checked_by uuid references staff_users (id),
  checked_at timestamptz not null default now(),
  check ((result = 'passed') = (failure is null)),
  foreign key (website_id, client_id) references websites (id, client_id)
);
create index seo_redirect_checks_site_idx on seo_redirect_checks (website_id, source_path, checked_at desc);

do $$
declare t text;
begin
  foreach t in array array['seo_sitemap_checks', 'seo_robots_checks', 'seo_site_check_runs', 'seo_site_check_items', 'seo_site_findings', 'seo_redirect_checks'] loop
    execute format('create trigger %I before insert or update on %I for each row execute function seo_website_tenant_check()', t || '_tenant_trg', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_select on %I for select using (app_can_access_client(client_id))', t, t);
    execute format('create policy %I_write on %I for all using (app_is_service()) with check (app_is_service())', t, t);
  end loop;
end $$;

-- Check evidence is append-only for the application role; runs and findings change state.
revoke update, delete on seo_sitemap_checks, seo_robots_checks, seo_site_check_items, seo_redirect_checks from cg_app;
