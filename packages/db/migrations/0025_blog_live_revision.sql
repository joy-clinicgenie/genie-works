-- Published output stays on live_version_id. A later draft changes the working copy only.
-- Preview tokens name one revision and can be revoked. 0022 is unchanged.

alter table blog_articles
  add column live_version_id uuid references blog_article_versions (id);

update blog_articles
   set live_version_id = current_version_id
 where status = 'published'
   and live_version_id is null
   and current_version_id is not null;

alter table blog_preview_tokens
  add column version_id uuid references blog_article_versions (id),
  add column revoked_at timestamptz;

create policy blog_preview_tokens_update on blog_preview_tokens for update
  using (app_can_edit_client(client_id) or app_can_review_client(client_id))
  with check (app_can_edit_client(client_id) or app_can_review_client(client_id));

create or replace function blog_articles_guard() returns trigger
language plpgsql as $$
declare
  native boolean;
  content_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'new articles start as drafts' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  content_changed :=
    new.title is distinct from old.title
    or new.slug is distinct from old.slug
    or new.category is distinct from old.category
    or new.body is distinct from old.body
    or new.website_id is distinct from old.website_id
    or new.client_id is distinct from old.client_id
    or new.seo_title is distinct from old.seo_title
    or new.seo_description is distinct from old.seo_description
    or new.canonical_path is distinct from old.canonical_path
    or new.indexable is distinct from old.indexable
    or new.author_user_id is distinct from old.author_user_id;

  if new.status = 'archived' and (old.status = 'published' or new.live_version_id is not null) then
    raise exception 'unpublish before archiving' using errcode = 'check_violation';
  end if;

  if old.status = 'published' and new.status = 'published' and content_changed then
    raise exception 'save a draft revision before changing the live article' using errcode = 'check_violation';
  end if;

  if old.status = 'published' and new.status = 'draft' and new.live_version_id is distinct from old.live_version_id then
    raise exception 'a draft revision keeps the published version live' using errcode = 'check_violation';
  end if;

  if old.live_version_id is not null and new.live_version_id is null then
    if not app_is_global() then
      raise exception 'only an admin or manager can unpublish' using errcode = 'insufficient_privilege';
    end if;
    if content_changed then
      raise exception 'unpublish does not change the article' using errcode = 'check_violation';
    end if;
    if new.status = 'published' then
      raise exception 'unpublish removes the live revision' using errcode = 'check_violation';
    end if;
  end if;

  if new.status = 'in_review' and old.status is distinct from 'in_review' and new.reviewer_user_id is null then
    raise exception 'a reviewer is required' using errcode = 'check_violation';
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved' and old.status <> 'published' then
    if not app_can_review_client(new.client_id) then
      raise exception 'only a reviewer can approve' using errcode = 'insufficient_privilege';
    end if;
    if new.current_version_id is null or not exists (
      select 1 from blog_approvals a
      where a.article_id = new.id and a.version_id = new.current_version_id and a.decision = 'approved'
    ) then
      raise exception 'approval required' using errcode = 'check_violation';
    end if;
  end if;

  if new.status = 'published' and (old.status is distinct from 'published' or new.live_version_id is distinct from old.live_version_id) then
    if not app_is_global() then
      raise exception 'only an admin or manager can publish' using errcode = 'insufficient_privilege';
    end if;
    if old.status <> 'approved' and old.status <> 'published' then
      raise exception 'publish requires approved status' using errcode = 'check_violation';
    end if;
    if old.status is distinct from 'published' and old.status <> 'approved' then
      raise exception 'publish requires approved status' using errcode = 'check_violation';
    end if;
    if new.live_version_id is distinct from new.current_version_id then
      raise exception 'publication uses the approved version' using errcode = 'check_violation';
    end if;
    if new.current_version_id is null or not exists (
      select 1 from blog_approvals a
      where a.article_id = new.id and a.version_id = new.current_version_id and a.decision = 'approved'
    ) then
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
  end if;

  if old.status = 'published' and new.status is distinct from 'published' and new.status not in ('approved', 'draft') then
    raise exception 'unpublish returns an article to approved' using errcode = 'check_violation';
  end if;
  if old.status = 'published' and new.status = 'approved' and new.live_version_id is not null then
    raise exception 'unpublish removes the live revision' using errcode = 'check_violation';
  end if;
  if old.status = 'published' and new.status = 'approved' and not app_is_global() then
    raise exception 'only an admin or manager can unpublish' using errcode = 'insufficient_privilege';
  end if;

  if app_can_review_client(new.client_id) and not app_can_edit_client(new.client_id) then
    if content_changed
       or new.reviewer_user_id is distinct from old.reviewer_user_id
       or new.current_version_id is distinct from old.current_version_id
       or new.live_version_id is distinct from old.live_version_id
    then
      raise exception 'reviewers cannot edit article content' using errcode = 'insufficient_privilege';
    end if;
    if not (old.status = 'in_review' and new.status in ('approved', 'draft')) then
      raise exception 'reviewers can only approve or return an article that is in review' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end $$;
