-- Stored Google index verdicts and mobile lab scores for known public pages.
-- A draft article is not a public page. Inspection reads Google's verdict and does not submit a URL.

create or replace function live_blog_index_paths(p_website_id uuid)
returns table (client_id uuid, website_id uuid, page_path text, indexable boolean)
language sql
stable
security definer
set search_path = public
as $$
  select a.client_id,
         a.website_id,
         coalesce(nullif(v.canonical_path, ''), '/blog/' || v.slug) as page_path,
         v.indexable
  from blog_articles a
  join blog_article_versions v on v.id = a.live_version_id
  where a.live_version_id is not null
    and v.slug is not null
    and v.slug <> ''
    and (p_website_id is null or a.website_id = p_website_id)
    and (app_is_service() or app_can_access_client(a.client_id))
$$;

revoke all on function live_blog_index_paths(uuid) from public;
grant execute on function live_blog_index_paths(uuid) to cg_app;

create table seo_index_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  page_path text not null check (page_path like '/%' and page_path not like '//%' and length(page_path) between 1 and 500),
  item_kind text not null check (item_kind in ('home', 'page', 'blog', 'setting')),
  configured text not null check (configured in ('index_allowed', 'noindex_saved')),
  live_status text not null default 'not_checked' check (live_status in ('not_checked', 'indexable', 'blocked')),
  google_status text not null default 'not_connected' check (google_status in ('not_connected', 'connected', 'indexed', 'not_indexed', 'unknown')),
  coverage_state text check (coverage_state is null or length(coverage_state) between 1 and 120),
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (website_id, page_path),
  foreign key (website_id, client_id) references websites (id, client_id)
);
create index seo_index_checks_due_idx on seo_index_checks (checked_at nulls first, id);

create table seo_speed_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  page_path text not null check (page_path like '/%' and page_path not like '//%' and length(page_path) between 1 and 500),
  strategy text not null check (strategy in ('mobile', 'desktop')),
  score integer check (score is null or score between 0 and 100),
  lcp_ms integer check (lcp_ms is null or lcp_ms >= 0),
  cls numeric(8, 3) check (cls is null or cls >= 0),
  tbt_ms integer check (tbt_ms is null or tbt_ms >= 0),
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{1,64}$'),
  checked_at timestamptz not null default now(),
  unique (website_id, page_path, strategy),
  foreign key (website_id, client_id) references websites (id, client_id)
);

create trigger seo_index_checks_tenant_trg before insert or update on seo_index_checks
  for each row execute function seo_website_tenant_check();
create trigger seo_speed_checks_tenant_trg before insert or update on seo_speed_checks
  for each row execute function seo_website_tenant_check();

do $$
declare t text;
begin
  foreach t in array array['seo_index_checks', 'seo_speed_checks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_select on %I for select using (app_can_access_client(client_id))', t, t);
    execute format('create policy %I_write on %I for all using (app_is_service()) with check (app_is_service())', t, t);
  end loop;
end $$;

grant delete on seo_index_checks, seo_speed_checks to cg_app;
