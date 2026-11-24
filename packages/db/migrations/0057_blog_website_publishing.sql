-- D86. Publish an approved article to its assigned Next.js website: the website's blog
-- route, a per-website publishing set-up flag (the secret is derived, never stored),
-- one delivery record per article revision, and a private preview read for the website.
-- Applied migration files are not edited.

alter table websites
  add column blog_base_path text not null default '/blog'
    check (blog_base_path ~ '^(/[a-z0-9][a-z0-9-]{0,62})+$');

create table website_blog_publishing (
  website_id uuid primary key,
  client_id uuid not null,
  generation integer not null default 1 check (generation between 1 and 1000000),
  configured_by uuid not null references staff_users (id),
  configured_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id)
);

alter table website_blog_publishing enable row level security;
create policy website_blog_publishing_select on website_blog_publishing for select
  using (app_can_access_client(client_id) and not app_is_service());
create policy website_blog_publishing_insert on website_blog_publishing for insert
  with check (app_is_admin() and app_can_access_client(client_id));
create policy website_blog_publishing_update on website_blog_publishing for update
  using (app_is_admin() and app_can_access_client(client_id))
  with check (app_is_admin() and app_can_access_client(client_id));
grant select, insert, update on website_blog_publishing to cg_app;

create table blog_deliveries (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references blog_articles (id),
  client_id uuid not null references clients (id),
  website_id uuid not null references websites (id),
  version_id uuid not null references blog_article_versions (id),
  state text not null check (state in ('delivering', 'verification_pending', 'failed', 'verified')),
  failure_code text check (failure_code is null or failure_code ~ '^[a-z0-9_]{1,64}$'),
  public_url text check (public_url is null or (public_url ~ '^https?://' and length(public_url) <= 600)),
  attempts integer not null default 1 check (attempts between 1 and 1000),
  started_by uuid not null references staff_users (id),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (article_id, version_id)
);
create index blog_deliveries_article_idx on blog_deliveries (article_id, updated_at desc);

create trigger blog_deliveries_tenant_trg before insert on blog_deliveries
  for each row execute function blog_record_tenant_check();

create or replace function blog_deliveries_identity() returns trigger
language plpgsql as $$
begin
  if new.article_id is distinct from old.article_id
     or new.client_id is distinct from old.client_id
     or new.website_id is distinct from old.website_id
     or new.version_id is distinct from old.version_id then
    raise exception 'Delivery identity cannot change' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger blog_deliveries_identity_trg before update on blog_deliveries
  for each row execute function blog_deliveries_identity();

alter table blog_deliveries enable row level security;
create policy blog_deliveries_select on blog_deliveries for select
  using (app_can_access_client(client_id) and not app_is_service());
create policy blog_deliveries_insert on blog_deliveries for insert
  with check (app_is_global() and app_can_access_client(client_id));
create policy blog_deliveries_update on blog_deliveries for update
  using (app_is_global() and app_can_access_client(client_id))
  with check (app_is_global() and app_can_access_client(client_id));
grant select, insert, update on blog_deliveries to cg_app;
revoke delete on blog_deliveries from cg_app;

alter table blog_activity drop constraint blog_activity_action_check;
alter table blog_activity add constraint blog_activity_action_check check (action in (
  'saved', 'submitted', 'changes_requested', 'withdrawn', 'approved',
  'published', 'revision_published', 'unpublished', 'archived', 'restored', 'version_restored',
  'publish_verified', 'publish_failed'
));

-- The public read now carries the live revision id (the website prints it for verification)
-- and the website's blog route.
drop function published_blog_articles(uuid, text);
create function published_blog_articles(p_website_id uuid, p_token_hash text)
returns table (
  id uuid,
  published_at timestamptz,
  first_published_at timestamptz,
  title text,
  slug text,
  excerpt text,
  category text,
  author_name text,
  body jsonb,
  seo_title text,
  seo_description text,
  social_title text,
  social_description text,
  canonical_path text,
  indexable boolean,
  featured_media_id uuid,
  social_media_id uuid,
  revised_at timestamptz,
  website_url text,
  version_id uuid,
  blog_base_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.published_at, a.first_published_at, v.title, v.slug, v.excerpt, v.category,
         author.display_name, v.body, v.seo_title, v.seo_description, v.social_title, v.social_description,
         v.canonical_path, v.indexable, v.featured_media_id, v.social_media_id, v.created_at, w.url,
         v.id, w.blog_base_path
  from blog_articles a
  join blog_article_versions v on v.id = a.live_version_id
  join websites w on w.id = a.website_id
  left join staff_users author on author.id = v.author_user_id
  where a.website_id = p_website_id
    and a.live_version_id is not null
    and v.slug is not null
    and exists (
      select 1 from seo_site_tokens t
      where t.website_id = p_website_id and t.token_hash = p_token_hash and t.revoked_at is null
    )
  order by a.published_at
$$;
revoke all on function published_blog_articles(uuid, text) from public;
grant execute on function published_blog_articles(uuid, text) to cg_app;

-- One saved revision, for the website's private preview. Needs both the site token and an
-- unexpired, unrevoked preview token issued for an article on that same website.
create function preview_blog_article(p_website_id uuid, p_token_hash text, p_preview_hash text)
returns table (
  id uuid,
  title text,
  slug text,
  excerpt text,
  category text,
  author_name text,
  body jsonb,
  seo_title text,
  seo_description text,
  social_title text,
  social_description text,
  featured_media_id uuid,
  social_media_id uuid,
  revised_at timestamptz,
  version_id uuid,
  blog_base_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, v.title, v.slug, v.excerpt, v.category, author.display_name, v.body,
         v.seo_title, v.seo_description, v.social_title, v.social_description,
         v.featured_media_id, v.social_media_id, v.created_at, v.id, w.blog_base_path
  from blog_preview_tokens p
  join blog_articles a on a.id = p.article_id
  join blog_article_versions v on v.id = p.version_id and v.article_id = a.id
  join websites w on w.id = a.website_id
  left join staff_users author on author.id = v.author_user_id
  where p.token_hash = p_preview_hash
    and p.revoked_at is null
    and p.expires_at > now()
    and a.website_id = p_website_id
    and exists (
      select 1 from seo_site_tokens t
      where t.website_id = p_website_id and t.token_hash = p_token_hash and t.revoked_at is null
    )
$$;

create function preview_blog_media(p_website_id uuid, p_media_id uuid, p_token_hash text, p_preview_hash text)
returns table (id uuid, alt_text text, content_type text, byte_size integer, storage_key text, body jsonb, featured_media_id uuid, social_media_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.alt_text, m.content_type, m.byte_size, m.storage_key, v.body, v.featured_media_id, v.social_media_id
  from blog_preview_tokens p
  join blog_articles a on a.id = p.article_id
  join blog_article_versions v on v.id = p.version_id and v.article_id = a.id
  join blog_media m on m.article_id = a.id and m.id = p_media_id
  where p.token_hash = p_preview_hash
    and p.revoked_at is null
    and p.expires_at > now()
    and a.website_id = p_website_id
    and exists (
      select 1 from seo_site_tokens t
      where t.website_id = p_website_id and t.token_hash = p_token_hash and t.revoked_at is null
    )
$$;
revoke all on function preview_blog_article(uuid, text, text) from public;
revoke all on function preview_blog_media(uuid, uuid, text, text) from public;
grant execute on function preview_blog_article(uuid, text, text) to cg_app;
grant execute on function preview_blog_media(uuid, uuid, text, text) to cg_app;

-- Site Health lists live articles at the website's own blog route.
create or replace function live_blog_index_paths(p_website_id uuid)
returns table (client_id uuid, website_id uuid, page_path text, indexable boolean)
language sql
stable
security definer
set search_path = public
as $$
  select a.client_id,
         a.website_id,
         coalesce(nullif(v.canonical_path, ''), w.blog_base_path || '/' || v.slug) as page_path,
         v.indexable
  from blog_articles a
  join blog_article_versions v on v.id = a.live_version_id
  join websites w on w.id = a.website_id
  where a.live_version_id is not null
    and v.slug is not null
    and v.slug <> ''
    and (p_website_id is null or a.website_id = p_website_id)
    and (app_is_service() or app_can_access_client(a.client_id))
$$;
