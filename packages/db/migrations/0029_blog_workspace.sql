-- 23 October blog workspace. Drafts may be incomplete. A published article stays
-- published while working_status tracks one revision. Applied migrations are unchanged.

alter table blog_articles drop constraint blog_articles_title_check;
alter table blog_articles add constraint blog_articles_title_check check (length(title) between 0 and 200);

alter table blog_articles drop constraint blog_articles_slug_check;
alter table blog_articles alter column slug drop not null;
alter table blog_articles add constraint blog_articles_slug_check
  check (slug is null or (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 1 and 80));

alter table blog_articles drop constraint blog_articles_category_check;
alter table blog_articles add constraint blog_articles_category_check check (length(category) between 0 and 80);

alter table blog_articles alter column author_user_id drop not null;

alter table blog_articles drop constraint blog_articles_seo_title_check;
alter table blog_articles add constraint blog_articles_seo_title_check check (length(seo_title) between 0 and 200);

alter table blog_articles drop constraint blog_articles_seo_description_check;
alter table blog_articles add constraint blog_articles_seo_description_check check (length(seo_description) between 0 and 320);

alter table blog_articles
  add column excerpt text not null default '',
  add column featured_media_id uuid,
  add column social_title text not null default '',
  add column social_description text not null default '',
  add column social_media_id uuid,
  add column first_published_at timestamptz,
  add column working_status text;

alter table blog_articles
  add constraint blog_articles_excerpt_check check (length(excerpt) <= 500),
  add constraint blog_articles_social_title_check check (length(social_title) <= 200),
  add constraint blog_articles_social_description_check check (length(social_description) <= 320),
  add constraint blog_articles_working_status_check check (
    working_status is null
    or (status = 'published' and live_version_id is not null and working_status in ('draft', 'in_review', 'approved'))
  );

update blog_articles
   set first_published_at = published_at
 where published_at is not null
   and first_published_at is null;

alter table blog_article_versions
  add column excerpt text not null default '',
  add column featured_media_id uuid,
  add column social_title text not null default '',
  add column social_description text not null default '',
  add column social_media_id uuid,
  add column author_user_id uuid,
  add column reviewer_user_id uuid;

alter table blog_article_versions alter column slug drop not null;

alter table blog_article_versions disable trigger blog_article_versions_no_update;
update blog_article_versions v
   set author_user_id = a.author_user_id,
       reviewer_user_id = a.reviewer_user_id
  from blog_articles a
 where a.id = v.article_id
   and v.author_user_id is null;
alter table blog_article_versions enable trigger blog_article_versions_no_update;

alter table blog_articles
  add constraint blog_articles_featured_media_fk foreign key (featured_media_id) references blog_media (id),
  add constraint blog_articles_social_media_fk foreign key (social_media_id) references blog_media (id);

alter table blog_article_versions
  add constraint blog_article_versions_featured_media_fk foreign key (featured_media_id) references blog_media (id),
  add constraint blog_article_versions_social_media_fk foreign key (social_media_id) references blog_media (id),
  add constraint blog_article_versions_author_fk foreign key (author_user_id) references staff_users (id),
  add constraint blog_article_versions_reviewer_fk foreign key (reviewer_user_id) references staff_users (id);

alter table websites
  add column blog_requirements jsonb not null
    default '{"author":false,"category":false,"featuredImage":false,"seo":false,"social":false}'::jsonb;

alter table websites
  add constraint websites_blog_requirements_shape check (
    jsonb_typeof(blog_requirements) = 'object'
    and (blog_requirements ->> 'author') in ('true', 'false')
    and (blog_requirements ->> 'category') in ('true', 'false')
    and (blog_requirements ->> 'featuredImage') in ('true', 'false')
    and (blog_requirements ->> 'seo') in ('true', 'false')
    and (blog_requirements ->> 'social') in ('true', 'false')
  );

alter table blog_approvals drop constraint blog_approvals_decision_check;
alter table blog_approvals add constraint blog_approvals_decision_check
  check (decision in ('approved', 'returned', 'withdrawn'));

drop policy blog_approvals_insert on blog_approvals;
create policy blog_approvals_insert on blog_approvals for insert
  with check (
    app_can_review_client(client_id)
    or (app_can_edit_client(client_id) and decision = 'withdrawn')
  );

create table blog_activity (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references blog_articles (id),
  client_id uuid not null references clients (id),
  version_id uuid references blog_article_versions (id),
  actor_user_id uuid not null references staff_users (id),
  action text not null check (action in (
    'saved', 'submitted', 'changes_requested', 'withdrawn', 'approved',
    'published', 'revision_published', 'unpublished', 'archived', 'restored', 'version_restored'
  )),
  note text check (note is null or length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index blog_activity_article_idx on blog_activity (article_id, created_at desc);

create trigger blog_activity_tenant_trg before insert on blog_activity
  for each row execute function blog_record_tenant_check();
create trigger blog_activity_no_update before update on blog_activity for each row execute function block_mutation();
create trigger blog_activity_no_delete before delete on blog_activity for each row execute function block_mutation();

alter table blog_activity enable row level security;
create policy blog_activity_select on blog_activity for select
  using (app_can_access_client(client_id) and not app_is_service());
create policy blog_activity_insert on blog_activity for insert
  with check (app_can_edit_client(client_id) or app_can_review_client(client_id));

revoke update, delete on blog_activity from cg_app;

create or replace function blog_latest_decision(p_article uuid, p_version uuid) returns text
language sql stable as $$
  select decision
  from blog_approvals
  where article_id = p_article and version_id = p_version
  order by decided_at desc, ctid desc
  limit 1
$$;

create or replace function blog_articles_guard() returns trigger
language plpgsql as $$
declare
  transition text;
  latest text;
  content_changed boolean;
  native boolean;
  locked boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.working_status is not null or new.live_version_id is not null then
      raise exception 'new articles start as drafts' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.client_id is distinct from old.client_id or new.website_id is distinct from old.website_id then
    raise exception 'an article stays on the website where it was created' using errcode = 'check_violation';
  end if;

  if new.featured_media_id is not null and not exists (
    select 1 from blog_media m where m.id = new.featured_media_id and m.article_id = new.id and m.client_id = new.client_id
  ) then
    raise exception 'choose a featured image from this article' using errcode = 'check_violation';
  end if;
  if new.social_media_id is not null and not exists (
    select 1 from blog_media m where m.id = new.social_media_id and m.article_id = new.id and m.client_id = new.client_id
  ) then
    raise exception 'choose a sharing image from this article' using errcode = 'check_violation';
  end if;

  content_changed :=
    new.title is distinct from old.title
    or new.slug is distinct from old.slug
    or new.category is distinct from old.category
    or new.body is distinct from old.body
    or new.excerpt is distinct from old.excerpt
    or new.seo_title is distinct from old.seo_title
    or new.seo_description is distinct from old.seo_description
    or new.social_title is distinct from old.social_title
    or new.social_description is distinct from old.social_description
    or new.canonical_path is distinct from old.canonical_path
    or new.indexable is distinct from old.indexable
    or new.author_user_id is distinct from old.author_user_id
    or new.featured_media_id is distinct from old.featured_media_id
    or new.social_media_id is distinct from old.social_media_id;

  transition := current_setting('app.blog_transition', true);
  if transition is null or transition = '' then
    raise exception 'article changes need an explicit workflow action' using errcode = 'check_violation';
  end if;

  locked := old.status in ('in_review', 'approved', 'archived')
    or (old.status = 'published' and old.working_status in ('in_review', 'approved'));

  if transition = 'save' and locked then
    raise exception 'return the article to draft before editing' using errcode = 'check_violation';
  end if;

  if transition in ('save', 'archive', 'restore', 'restore_version', 'publish', 'unpublish')
     and not app_can_edit_client(new.client_id) then
    raise exception 'you cannot edit this article' using errcode = 'insufficient_privilege';
  end if;

  if transition = 'submit' and not (app_can_edit_client(new.client_id) or app_can_review_client(new.client_id)) then
    raise exception 'you cannot submit this article' using errcode = 'insufficient_privilege';
  end if;

  latest := blog_latest_decision(new.id, new.current_version_id);

  if transition in ('approve', 'request_changes') then
    if not app_is_global() and app_current_user_id() is distinct from new.reviewer_user_id then
      raise exception 'only the assigned reviewer can decide' using errcode = 'insufficient_privilege';
    end if;
    if not app_can_review_client(new.client_id) then
      raise exception 'you cannot review this article' using errcode = 'insufficient_privilege';
    end if;
  end if;

  if transition = 'withdraw'
     and not (app_is_global() or app_can_edit_client(new.client_id) or app_current_user_id() = new.reviewer_user_id) then
    raise exception 'you cannot return this article to draft' using errcode = 'insufficient_privilege';
  end if;

  if transition = 'save' then
    if new.live_version_id is distinct from old.live_version_id then
      raise exception 'saving does not publish or unpublish' using errcode = 'check_violation';
    end if;
    if old.status = 'draft' and new.status = 'draft' and new.working_status is null and new.live_version_id is null then
      return new;
    end if;
    if old.status = 'published' and new.status = 'published' and old.live_version_id is not null
       and new.working_status = 'draft' and (old.working_status is null or old.working_status = 'draft') then
      return new;
    end if;
    raise exception 'this article cannot be edited in its current state' using errcode = 'check_violation';
  end if;

  if content_changed or new.current_version_id is distinct from old.current_version_id then
    if transition <> 'restore_version' then
      raise exception 'this version is locked' using errcode = 'check_violation';
    end if;
  end if;

  if transition = 'submit' then
    if new.reviewer_user_id is null then
      raise exception 'a reviewer is required' using errcode = 'check_violation';
    end if;
    if old.status = 'draft' and new.status = 'in_review' and new.working_status is null and new.live_version_id is null then
      return new;
    end if;
    if old.status = 'published' and new.status = 'published' and old.working_status = 'draft'
       and new.working_status = 'in_review' and new.live_version_id is not distinct from old.live_version_id then
      return new;
    end if;
    raise exception 'only a draft can be submitted' using errcode = 'check_violation';
  end if;

  if transition = 'request_changes' then
    if latest is distinct from 'returned' then
      raise exception 'requesting changes needs feedback' using errcode = 'check_violation';
    end if;
    if old.status = 'in_review' and new.status = 'draft' and new.working_status is null and new.live_version_id is null then
      return new;
    end if;
    if old.status = 'published' and new.status = 'published' and old.working_status = 'in_review'
       and new.working_status = 'draft' and new.live_version_id is not distinct from old.live_version_id then
      return new;
    end if;
    raise exception 'this article is not in review' using errcode = 'check_violation';
  end if;

  if transition = 'withdraw' then
    if latest is distinct from 'withdrawn' then
      raise exception 'returning to draft must be recorded' using errcode = 'check_violation';
    end if;
    if old.status in ('in_review', 'approved') and new.status = 'draft' and new.working_status is null and new.live_version_id is null then
      return new;
    end if;
    if old.status = 'published' and new.status = 'published' and old.working_status in ('in_review', 'approved')
       and new.working_status = 'draft' and new.live_version_id is not distinct from old.live_version_id then
      return new;
    end if;
    raise exception 'this article cannot be returned to draft' using errcode = 'check_violation';
  end if;

  if transition = 'approve' then
    if latest is distinct from 'approved' then
      raise exception 'approval required' using errcode = 'check_violation';
    end if;
    if old.status = 'in_review' and new.status = 'approved' and new.working_status is null and new.live_version_id is null then
      return new;
    end if;
    if old.status = 'published' and new.status = 'published' and old.working_status = 'in_review'
       and new.working_status = 'approved' and new.live_version_id is not distinct from old.live_version_id then
      return new;
    end if;
    raise exception 'this article is not in review' using errcode = 'check_violation';
  end if;

  if transition = 'publish' then
    if not app_is_global() then
      raise exception 'only an admin or manager can publish' using errcode = 'insufficient_privilege';
    end if;
    if new.status <> 'published' or new.working_status is not null then
      raise exception 'publication clears the working revision' using errcode = 'check_violation';
    end if;
    if new.live_version_id is null or new.live_version_id is distinct from new.current_version_id then
      raise exception 'publication uses the approved version' using errcode = 'check_violation';
    end if;
    if not (
      (old.status = 'approved' and old.working_status is null)
      or (old.status = 'published' and old.working_status = 'approved')
    ) then
      raise exception 'publish requires approved status' using errcode = 'check_violation';
    end if;
    if latest is distinct from 'approved' then
      raise exception 'approval required before publication' using errcode = 'check_violation';
    end if;
    select (
      lower(w.platform) like '%next.js%'
      or lower(w.platform) like '%nextjs%'
      or (lower(w.platform) like '%vercel%' and lower(w.platform) not like '%wix%')
    ) into native
    from websites w where w.id = new.website_id;
    if not coalesce(native, false) then
      raise exception 'publishing is only available for native websites' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if transition = 'unpublish' then
    if not app_is_global() then
      raise exception 'only an admin or manager can unpublish' using errcode = 'insufficient_privilege';
    end if;
    if old.live_version_id is null or new.live_version_id is not null or new.status <> 'draft' or new.working_status is not null then
      raise exception 'unpublish returns an article to draft' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if transition = 'archive' then
    if new.status <> 'archived' or old.live_version_id is not null or old.working_status is not null or old.status not in ('draft', 'approved') then
      raise exception 'only a draft or approved article that is not live can be archived' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if transition = 'restore' then
    if old.status <> 'archived' or new.status <> 'draft' or new.live_version_id is not null or new.working_status is not null then
      raise exception 'restore returns an archived article to draft' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if transition = 'restore_version' then
    if old.live_version_id is not null then
      if new.status <> 'published' or new.working_status <> 'draft' or new.live_version_id is distinct from old.live_version_id then
        raise exception 'restoring history on a live article updates the working revision only' using errcode = 'check_violation';
      end if;
      return new;
    end if;
    if old.status in ('in_review', 'approved') then
      raise exception 'return the article to draft before restoring a version' using errcode = 'check_violation';
    end if;
    if new.status <> 'draft' or new.working_status is not null or new.live_version_id is not null then
      raise exception 'restoring history creates a draft' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  raise exception 'that article transition is not available' using errcode = 'check_violation';
end $$;

-- Public reads gain the snapshot fields used by the article template.
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
  website_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.published_at, a.first_published_at, v.title, v.slug, v.excerpt, v.category,
         author.display_name, v.body, v.seo_title, v.seo_description, v.social_title, v.social_description,
         v.canonical_path, v.indexable, v.featured_media_id, v.social_media_id, v.created_at, w.url
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

drop function published_blog_media(uuid, uuid, text);
create function published_blog_media(p_website_id uuid, p_media_id uuid, p_token_hash text)
returns table (
  id uuid,
  alt_text text,
  content_type text,
  byte_size integer,
  storage_key text,
  body jsonb,
  featured_media_id uuid,
  social_media_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.alt_text, m.content_type, m.byte_size, m.storage_key, v.body, v.featured_media_id, v.social_media_id
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
revoke all on function blog_latest_decision(uuid, uuid) from public;
grant execute on function blog_latest_decision(uuid, uuid) to cg_app;
