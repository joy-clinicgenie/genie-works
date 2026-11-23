-- SEO-05.1 to SEO-05.3 (D63): llms.txt preview, NLWeb tests, AI crawler events, and saved answer tests.

-- (1) llms.txt: keep the retrieved text and its URL with each AI access check.
alter table seo_ai_access_checks add column llms_url text check (llms_url is null or length(llms_url) <= 2048);
alter table seo_ai_access_checks add column llms_body text check (llms_body is null or octet_length(llms_body) <= 65536);

-- (2) NLWeb endpoint per website and the tests run against it.
create table seo_nlweb_endpoints (
  website_id uuid primary key,
  client_id uuid not null,
  endpoint_url text not null check (endpoint_url ~ '^https://' and length(endpoint_url) <= 2048),
  updated_by uuid not null references staff_users (id),
  updated_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id)
);

create table seo_nlweb_tests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  endpoint_url text not null check (length(endpoint_url) <= 2048),
  question text not null check (length(question) between 1 and 300),
  outcome text not null check (outcome in ('answered', 'empty', 'timeout', 'error')),
  http_status integer check (http_status is null or http_status between 100 and 599),
  answer text check (answer is null or length(answer) <= 4000),
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array' and octet_length(sources::text) < 20000),
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  tested_by uuid not null references staff_users (id),
  tested_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id)
);
create index seo_nlweb_tests_site_idx on seo_nlweb_tests (website_id, tested_at desc);

-- (3) Crawler event sources, covered windows and eligible events. Only ChatGPT, Gemini and Claude are stored.
create table seo_crawler_sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  kind text not null check (kind in ('request_log', 'platform_feed')),
  label text not null check (length(label) between 1 and 120),
  gemini_attribution boolean not null default false,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'connected' check (status in ('connected', 'disconnected')),
  last_success_at timestamptz,
  created_by uuid not null references staff_users (id),
  created_at timestamptz not null default now(),
  disconnected_at timestamptz,
  unique (id, website_id),
  foreign key (website_id, client_id) references websites (id, client_id)
);

create table seo_crawler_batches (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  client_id uuid not null,
  website_id uuid not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  accepted integer not null default 0 check (accepted >= 0),
  duplicates integer not null default 0 check (duplicates >= 0),
  ignored integer not null default 0 check (ignored >= 0),
  received_at timestamptz not null default now(),
  check (window_start < window_end and window_end - window_start <= interval '31 days'),
  foreign key (source_id, website_id) references seo_crawler_sources (id, website_id),
  foreign key (website_id, client_id) references websites (id, client_id)
);
create index seo_crawler_batches_source_idx on seo_crawler_batches (source_id, window_start);

create table seo_crawler_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  client_id uuid not null,
  website_id uuid not null,
  event_key text not null check (length(event_key) between 1 and 200),
  occurred_at timestamptz not null,
  provider text not null check (provider in ('chatgpt', 'gemini', 'claude')),
  agent text not null check (length(agent) between 1 and 60),
  purpose text not null check (purpose in ('search', 'training', 'user', 'ads', 'unspecified')),
  page_path text check (page_path is null or (page_path like '/%' and length(page_path) <= 500)),
  http_status integer check (http_status is null or http_status between 100 and 599),
  received_at timestamptz not null default now(),
  unique (source_id, event_key),
  foreign key (source_id, website_id) references seo_crawler_sources (id, website_id),
  foreign key (website_id, client_id) references websites (id, client_id)
);
create index seo_crawler_events_site_idx on seo_crawler_events (website_id, occurred_at);

-- (4) External answer tests saved by staff. A positive test is a tracked mention.
create table seo_answer_tests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  platform text not null check (platform in ('chatgpt', 'gemini', 'claude')),
  question text not null check (length(question) between 1 and 300),
  tested_on date not null,
  mentioned boolean not null,
  cited_url text check (cited_url is null or (cited_url ~ '^https?://' and length(cited_url) <= 2048)),
  answer_excerpt text check (answer_excerpt is null or length(answer_excerpt) <= 1000),
  recorded_by uuid not null references staff_users (id),
  recorded_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id)
);
create index seo_answer_tests_site_idx on seo_answer_tests (website_id, tested_on);

do $$
declare t text;
begin
  foreach t in array array['seo_nlweb_endpoints', 'seo_nlweb_tests', 'seo_crawler_sources', 'seo_crawler_batches', 'seo_crawler_events', 'seo_answer_tests'] loop
    execute format('create trigger %I before insert or update on %I for each row execute function seo_website_tenant_check()', t || '_tenant_trg', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_select on %I for select using (app_can_access_client(client_id))', t, t);
    execute format('create policy %I_write on %I for all using (app_is_service()) with check (app_is_service())', t, t);
  end loop;
end $$;

-- token_hash is a SHA-256 of a high-entropy token, as for seo_site_tokens; staff queries never select it.
revoke update, delete on seo_nlweb_tests, seo_crawler_batches, seo_crawler_events, seo_answer_tests from cg_app;
