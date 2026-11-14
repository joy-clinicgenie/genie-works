-- D57: read-only AI access checks. Each run reads robots.txt and llms.txt from the
-- website's registry origin and stores what it found. Rows are append-only history.
-- No page content, cookies or response headers are stored.

create table seo_ai_access_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  origin text not null check (origin ~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$' and length(origin) <= 300),
  robots_status text not null check (robots_status in ('found', 'missing', 'not_text', 'error')),
  robots_http integer check (robots_http is null or robots_http between 100 and 599),
  llms_status text not null check (llms_status in ('found', 'missing', 'not_text', 'error')),
  llms_http integer check (llms_http is null or llms_http between 100 and 599),
  llms_bytes integer check (llms_bytes is null or llms_bytes >= 0),
  crawlers jsonb not null check (jsonb_typeof(crawlers) = 'array'),
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  checked_by uuid not null references staff_users (id),
  checked_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id)
);

create index seo_ai_access_checks_site_idx on seo_ai_access_checks (website_id, checked_at desc);
create index seo_ai_access_checks_client_idx on seo_ai_access_checks (client_id);

alter table seo_ai_access_checks enable row level security;
create policy seo_ai_access_checks_select on seo_ai_access_checks
  for select using (app_can_access_client(client_id));
create policy seo_ai_access_checks_insert on seo_ai_access_checks
  for insert with check (app_can_edit_client(client_id) and checked_by = app_current_user_id());

grant select, insert on seo_ai_access_checks to cg_app;
revoke update, delete on seo_ai_access_checks from cg_app;
