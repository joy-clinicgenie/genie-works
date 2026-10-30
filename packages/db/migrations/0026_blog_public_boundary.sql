-- The service context used by public routes is global for client access.
-- It may read only the live published revision, through these functions.
-- Draft rows, revision history, approvals and preview tokens stay with staff.

create or replace function published_blog_articles(p_website_id uuid, p_token_hash text)
returns table (
  id uuid,
  published_at timestamptz,
  title text,
  slug text,
  category text,
  body jsonb,
  seo_title text,
  seo_description text,
  canonical_path text,
  indexable boolean,
  revised_at timestamptz,
  website_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.published_at, v.title, v.slug, v.category, v.body, v.seo_title, v.seo_description,
         v.canonical_path, v.indexable, v.created_at, w.url
  from blog_articles a
  join blog_article_versions v on v.id = a.live_version_id
  join websites w on w.id = a.website_id
  where a.website_id = p_website_id
    and a.live_version_id is not null
    and exists (
      select 1 from seo_site_tokens t
      where t.website_id = p_website_id and t.token_hash = p_token_hash and t.revoked_at is null
    )
  order by a.published_at
$$;

create or replace function published_blog_media(p_website_id uuid, p_media_id uuid, p_token_hash text)
returns table (
  id uuid,
  alt_text text,
  content_type text,
  byte_size integer,
  storage_key text,
  body jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.alt_text, m.content_type, m.byte_size, m.storage_key, v.body
  from blog_media m
  join blog_articles a on a.id = m.article_id
  join blog_article_versions v on v.id = a.live_version_id
  where m.id = p_media_id
    and a.website_id = p_website_id
    and a.live_version_id is not null
    and exists (
      select 1 from seo_site_tokens t
      where t.website_id = p_website_id and t.token_hash = p_token_hash and t.revoked_at is null
    )
$$;

revoke all on function published_blog_articles(uuid, text) from public;
revoke all on function published_blog_media(uuid, uuid, text) from public;
grant execute on function published_blog_articles(uuid, text) to cg_app;
grant execute on function published_blog_media(uuid, uuid, text) to cg_app;

drop policy blog_articles_select on blog_articles;
create policy blog_articles_select on blog_articles for select
  using (app_can_access_client(client_id) and not app_is_service());

drop policy blog_article_versions_select on blog_article_versions;
create policy blog_article_versions_select on blog_article_versions for select
  using (app_can_access_client(client_id) and not app_is_service());

drop policy blog_media_select on blog_media;
create policy blog_media_select on blog_media for select
  using (app_can_access_client(client_id) and not app_is_service());

drop policy blog_approvals_select on blog_approvals;
create policy blog_approvals_select on blog_approvals for select
  using (app_can_access_client(client_id) and not app_is_service());

drop policy blog_publications_select on blog_publications;
create policy blog_publications_select on blog_publications for select
  using (app_can_access_client(client_id) and not app_is_service());

drop policy blog_preview_tokens_select on blog_preview_tokens;
create policy blog_preview_tokens_select on blog_preview_tokens for select
  using (app_can_access_client(client_id) and not app_is_service());

drop policy blog_preview_tokens_update on blog_preview_tokens;
create policy blog_preview_tokens_update on blog_preview_tokens for update
  using ((app_can_edit_client(client_id) or app_can_review_client(client_id)) and not app_is_service())
  with check ((app_can_edit_client(client_id) or app_can_review_client(client_id)) and not app_is_service());
