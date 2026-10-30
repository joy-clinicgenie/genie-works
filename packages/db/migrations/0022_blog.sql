-- Native Blog core. Articles are drafted, reviewed and versioned in Genie Works.
-- Publishing is limited to native websites. Wix Blog is not written.
-- Versions, approvals and publication events are append-only.

create table blog_articles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id),
  website_id uuid not null references websites (id),
  title text not null check (length(title) between 1 and 200),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 1 and 80),
  category text not null check (length(category) between 1 and 80),
  author_user_id uuid not null references staff_users (id),
  reviewer_user_id uuid references staff_users (id),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'published', 'archived')),
  seo_title text not null check (length(seo_title) between 1 and 200),
  seo_description text not null check (length(seo_description) between 1 and 320),
  canonical_path text check (canonical_path is null or (canonical_path like '/%' and canonical_path not like '//%' and length(canonical_path) <= 300)),
  indexable boolean not null default true,
  body jsonb not null,
  current_version_id uuid,
  published_at timestamptz,
  unpublished_at timestamptz,
  created_by uuid not null references staff_users (id),
  updated_by uuid not null references staff_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, slug)
);
create index blog_articles_client_idx on blog_articles (client_id, status, updated_at desc);
create index blog_articles_website_idx on blog_articles (website_id, status);

create table blog_article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references blog_articles (id),
  client_id uuid not null references clients (id),
  version_number integer not null check (version_number > 0),
  title text not null,
  slug text not null,
  category text not null,
  body jsonb not null,
  seo_title text not null,
  seo_description text not null,
  canonical_path text,
  indexable boolean not null,
  created_by uuid not null references staff_users (id),
  created_at timestamptz not null default now(),
  unique (article_id, version_number)
);
create index blog_article_versions_client_idx on blog_article_versions (client_id, article_id);

alter table blog_articles
  add constraint blog_articles_current_version_fk
  foreign key (current_version_id) references blog_article_versions (id)
  deferrable initially deferred;

create table blog_media (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references blog_articles (id),
  client_id uuid not null references clients (id),
  storage_key text not null,
  alt_text text not null check (length(btrim(alt_text)) between 1 and 300),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 1000000),
  created_by uuid not null references staff_users (id),
  created_at timestamptz not null default now()
);
create index blog_media_article_idx on blog_media (article_id);

create table blog_approvals (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references blog_articles (id),
  client_id uuid not null references clients (id),
  version_id uuid not null references blog_article_versions (id),
  reviewer_user_id uuid not null references staff_users (id),
  decision text not null check (decision in ('approved', 'returned')),
  note text check (note is null or length(note) <= 1000),
  decided_at timestamptz not null default now()
);
create index blog_approvals_article_idx on blog_approvals (article_id, decided_at desc);

create table blog_publications (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references blog_articles (id),
  client_id uuid not null references clients (id),
  website_id uuid not null references websites (id),
  version_id uuid not null references blog_article_versions (id),
  action text not null check (action in ('publish', 'unpublish')),
  actor_user_id uuid not null references staff_users (id),
  created_at timestamptz not null default now()
);
create index blog_publications_website_idx on blog_publications (website_id, created_at desc);

create table blog_preview_tokens (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references blog_articles (id),
  client_id uuid not null references clients (id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_by uuid not null references staff_users (id),
  created_at timestamptz not null default now()
);
create index blog_preview_tokens_article_idx on blog_preview_tokens (article_id, expires_at desc);

create trigger blog_articles_tenant_trg before insert or update on blog_articles
  for each row execute function seo_website_tenant_check();

create or replace function blog_record_tenant_check() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from blog_articles a where a.id = new.article_id and a.client_id = new.client_id) then
    raise exception 'article does not belong to this client' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger blog_media_tenant_trg before insert or update on blog_media
  for each row execute function blog_record_tenant_check();
create trigger blog_versions_tenant_trg before insert on blog_article_versions
  for each row execute function blog_record_tenant_check();
create trigger blog_approvals_tenant_trg before insert on blog_approvals
  for each row execute function blog_record_tenant_check();
create trigger blog_publications_tenant_trg before insert on blog_publications
  for each row execute function blog_record_tenant_check();
create trigger blog_preview_tokens_tenant_trg before insert on blog_preview_tokens
  for each row execute function blog_record_tenant_check();

create or replace function blog_articles_guard() returns trigger
language plpgsql as $$
declare
  native boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'new articles start as drafts' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status = 'published' and new.status = 'archived' then
    raise exception 'unpublish before archiving' using errcode = 'check_violation';
  end if;

  if old.status = 'published' and (
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
    or new.author_user_id is distinct from old.author_user_id
  ) then
    raise exception 'unpublish before editing a live article' using errcode = 'check_violation';
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

  if new.status = 'published' and old.status is distinct from 'published' then
    if not app_is_global() then
      raise exception 'only an admin or manager can publish' using errcode = 'insufficient_privilege';
    end if;
    if old.status <> 'approved' then
      raise exception 'publish requires approved status' using errcode = 'check_violation';
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

  if old.status = 'published' and new.status is distinct from 'published' and new.status <> 'approved' then
    raise exception 'unpublish returns an article to approved' using errcode = 'check_violation';
  end if;
  if old.status = 'published' and new.status = 'approved' and not app_is_global() then
    raise exception 'only an admin or manager can unpublish' using errcode = 'insufficient_privilege';
  end if;

  if app_can_review_client(new.client_id) and not app_can_edit_client(new.client_id) then
    if new.title is distinct from old.title
       or new.slug is distinct from old.slug
       or new.body is distinct from old.body
       or new.category is distinct from old.category
       or new.website_id is distinct from old.website_id
       or new.seo_title is distinct from old.seo_title
       or new.seo_description is distinct from old.seo_description
       or new.canonical_path is distinct from old.canonical_path
       or new.indexable is distinct from old.indexable
       or new.author_user_id is distinct from old.author_user_id
       or new.reviewer_user_id is distinct from old.reviewer_user_id
       or new.client_id is distinct from old.client_id
       or new.current_version_id is distinct from old.current_version_id
    then
      raise exception 'reviewers cannot edit article content' using errcode = 'insufficient_privilege';
    end if;
    if not (old.status = 'in_review' and new.status in ('approved', 'draft')) then
      raise exception 'reviewers can only approve or return an article that is in review' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end $$;

create trigger blog_articles_guard_trg before insert or update on blog_articles
  for each row execute function blog_articles_guard();

create trigger blog_article_versions_no_update before update on blog_article_versions for each row execute function block_mutation();
create trigger blog_article_versions_no_delete before delete on blog_article_versions for each row execute function block_mutation();
create trigger blog_approvals_no_update before update on blog_approvals for each row execute function block_mutation();
create trigger blog_approvals_no_delete before delete on blog_approvals for each row execute function block_mutation();
create trigger blog_publications_no_update before update on blog_publications for each row execute function block_mutation();
create trigger blog_publications_no_delete before delete on blog_publications for each row execute function block_mutation();

alter table blog_articles enable row level security;
alter table blog_article_versions enable row level security;
alter table blog_media enable row level security;
alter table blog_approvals enable row level security;
alter table blog_publications enable row level security;
alter table blog_preview_tokens enable row level security;

create policy blog_articles_select on blog_articles for select using (app_can_access_client(client_id) or app_is_service());
create policy blog_articles_insert on blog_articles for insert with check (app_can_edit_client(client_id));
create policy blog_articles_update on blog_articles for update
  using (app_can_edit_client(client_id) or app_can_review_client(client_id))
  with check (app_can_edit_client(client_id) or app_can_review_client(client_id));

create policy blog_article_versions_select on blog_article_versions for select using (app_can_access_client(client_id) or app_is_service());
create policy blog_article_versions_insert on blog_article_versions for insert with check (app_can_edit_client(client_id));

create policy blog_media_select on blog_media for select using (app_can_access_client(client_id) or app_is_service());
create policy blog_media_write on blog_media for all
  using (app_can_edit_client(client_id))
  with check (app_can_edit_client(client_id));

create policy blog_approvals_select on blog_approvals for select using (app_can_access_client(client_id) or app_is_service());
create policy blog_approvals_insert on blog_approvals for insert with check (app_can_review_client(client_id));

create policy blog_publications_select on blog_publications for select using (app_can_access_client(client_id) or app_is_service());
create policy blog_publications_insert on blog_publications for insert with check (app_is_global());

create policy blog_preview_tokens_select on blog_preview_tokens for select using (app_can_access_client(client_id));
create policy blog_preview_tokens_insert on blog_preview_tokens for insert
  with check (app_can_edit_client(client_id) or app_can_review_client(client_id));

revoke update on blog_article_versions, blog_approvals, blog_publications from cg_app;
