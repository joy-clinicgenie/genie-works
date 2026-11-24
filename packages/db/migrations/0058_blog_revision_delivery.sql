-- D87. Revision and delivery tracking for the locked Blog publishing workflow.
--
-- * Website-scoped shipping: an administrator, or an active website_publishers grant.
--   A client membership or the manager role alone no longer publishes or unpublishes.
-- * live_version_id keeps its meaning (the released revision the content API serves).
--   The website-verified revision is recorded separately in blog_verified_revisions.
-- * blog_deliveries (from 0057) becomes one logical delivery per website, article and
--   revision; each attempt is a row in blog_delivery_attempts (the Publishing history).
--
-- Compatible with a clean installation and with a database where 0057 is already applied.
-- Nothing is backfilled: an article released before D87 has no delivery and reports
-- "Website publication unverified".

-- ---------------------------------------------------------------------------
-- Website publishers
-- ---------------------------------------------------------------------------

create table website_publishers (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null,
  client_id uuid not null,
  user_id uuid not null references staff_users (id),
  granted_by uuid not null references staff_users (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references staff_users (id),
  foreign key (website_id, client_id) references websites (id, client_id),
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index website_publishers_active_idx on website_publishers (website_id, user_id) where revoked_at is null;
create index website_publishers_user_idx on website_publishers (user_id) where revoked_at is null;

create or replace function website_publishers_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from staff_users u where u.id = new.user_id and (not u.active or u.platform_role = 'read_only')) then
      raise exception 'a read-only or inactive account cannot publish' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.website_id is distinct from old.website_id or new.client_id is distinct from old.client_id
     or new.user_id is distinct from old.user_id or new.granted_by is distinct from old.granted_by
     or new.granted_at is distinct from old.granted_at or old.revoked_at is not null then
    raise exception 'a publisher grant can only be revoked' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger website_publishers_guard_trg before insert or update on website_publishers
  for each row execute function website_publishers_guard();

alter table website_publishers enable row level security;
create policy website_publishers_select on website_publishers for select
  using (app_can_access_client(client_id) and not app_is_service());
create policy website_publishers_insert on website_publishers for insert
  with check (app_platform_role() = 'admin' and app_can_access_client(client_id));
create policy website_publishers_update on website_publishers for update
  using (app_platform_role() = 'admin' and app_can_access_client(client_id))
  with check (app_platform_role() = 'admin' and app_can_access_client(client_id));
grant select, insert, update on website_publishers to cg_app;
revoke delete on website_publishers from cg_app;

-- The one shipping predicate. The service context is not a publisher.
create or replace function app_can_ship_website(p_website_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from websites w
    join staff_users u on u.id = app_current_user_id() and u.active
    where w.id = p_website_id
      and w.status = 'active'
      and app_context() = 'staff'
      and not app_client_deleted(w.client_id)
      and app_can_access_client(w.client_id)
      and (
        u.platform_role = 'admin'
        or (u.platform_role <> 'read_only' and exists (
          select 1 from website_publishers p
          where p.website_id = w.id and p.user_id = u.id and p.revoked_at is null
        ))
      )
  )
$$;
revoke all on function app_can_ship_website(uuid) from public;
grant execute on function app_can_ship_website(uuid) to cg_app;

drop policy blog_publications_insert on blog_publications;
create policy blog_publications_insert on blog_publications for insert
  with check (app_can_ship_website(website_id));

-- ---------------------------------------------------------------------------
-- Logical deliveries (reshapes 0057's blog_deliveries)
-- ---------------------------------------------------------------------------

alter table blog_deliveries drop constraint blog_deliveries_state_check;
-- 0057 kept no evidence of how a revision was verified, so its 'verified' rows are not carried
-- over as verified: they wait for a fresh verification. Nothing is backfilled.
update blog_deliveries set
  failure_code = case when state = 'verified' then 'reverify_after_upgrade' else failure_code end,
  state = case state
    when 'delivering' then 'delivery_pending'
    when 'verification_pending' then 'awaiting_verification'
    when 'failed' then 'delivery_failed'
    when 'verified' then 'awaiting_verification'
    else state end;
alter table blog_deliveries add constraint blog_deliveries_state_check
  check (state in ('delivery_pending', 'delivery_failed', 'awaiting_verification', 'verified'));
alter table blog_deliveries alter column state set default 'delivery_pending';

alter table blog_deliveries drop constraint blog_deliveries_article_id_version_id_key;
alter table blog_deliveries add constraint blog_deliveries_website_article_version_key unique (website_id, article_id, version_id);

-- 0057's per-row counter is kept for any existing row; attempts now live in blog_delivery_attempts.
alter table blog_deliveries rename column attempts to legacy_attempt_count;
alter table blog_deliveries alter column legacy_attempt_count drop not null;
alter table blog_deliveries alter column legacy_attempt_count drop default;
alter table blog_deliveries add column current_attempt_id uuid;

-- The article, its website, the revision and the client must all belong together.
create or replace function blog_delivery_scope_check() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1
    from blog_articles a
    join blog_article_versions v on v.id = new.version_id and v.article_id = a.id
    where a.id = new.article_id and a.client_id = new.client_id and a.website_id = new.website_id
  ) then
    raise exception 'the article, revision and website do not belong together' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger blog_deliveries_tenant_trg on blog_deliveries;
create trigger blog_deliveries_scope_trg before insert on blog_deliveries
  for each row execute function blog_delivery_scope_check();

-- Identity is fixed (0057), and a verified delivery never goes back.
create or replace function blog_deliveries_identity() returns trigger
language plpgsql as $$
begin
  if new.article_id is distinct from old.article_id
     or new.client_id is distinct from old.client_id
     or new.website_id is distinct from old.website_id
     or new.version_id is distinct from old.version_id then
    raise exception 'Delivery identity cannot change' using errcode = '23514';
  end if;
  if old.state = 'verified' and new.state <> 'verified' then
    raise exception 'a verified delivery cannot return to an earlier state' using errcode = '23514';
  end if;
  return new;
end $$;

drop policy blog_deliveries_insert on blog_deliveries;
drop policy blog_deliveries_update on blog_deliveries;
create policy blog_deliveries_insert on blog_deliveries for insert
  with check (app_can_ship_website(website_id));
create policy blog_deliveries_update on blog_deliveries for update
  using (app_can_ship_website(website_id))
  with check (app_can_ship_website(website_id));

-- ---------------------------------------------------------------------------
-- Attempts: the Publishing history
-- ---------------------------------------------------------------------------

create table blog_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references blog_deliveries (id),
  article_id uuid not null references blog_articles (id),
  client_id uuid not null references clients (id),
  website_id uuid not null references websites (id),
  version_id uuid not null references blog_article_versions (id),
  kind text not null check (kind in ('deliver', 'verify')),
  attempt_number integer not null check (attempt_number between 1 and 100000),
  status text not null default 'started' check (status in ('started', 'succeeded', 'failed', 'timed_out', 'superseded')),
  outcome_code text check (outcome_code is null or outcome_code ~ '^[a-z0-9_]{1,64}$'),
  public_url text check (public_url is null or (public_url ~ '^https?://' and length(public_url) <= 600)),
  started_by uuid not null references staff_users (id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (delivery_id, attempt_number),
  check ((status = 'started') = (finished_at is null))
);
create index blog_delivery_attempts_article_idx on blog_delivery_attempts (article_id, started_at desc);
create unique index blog_delivery_attempts_one_running_idx on blog_delivery_attempts (delivery_id) where status = 'started';

alter table blog_deliveries add constraint blog_deliveries_current_attempt_fkey
  foreign key (current_attempt_id) references blog_delivery_attempts (id) deferrable initially deferred;

create or replace function blog_delivery_attempts_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from blog_deliveries d
      where d.id = new.delivery_id and d.article_id = new.article_id and d.client_id = new.client_id
        and d.website_id = new.website_id and d.version_id = new.version_id
    ) then
      raise exception 'the attempt does not match its delivery' using errcode = 'check_violation';
    end if;
    if new.status <> 'started' then
      raise exception 'an attempt starts as started' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- An attempt finishes once. Nothing else about it changes.
  if old.status <> 'started'
     or new.delivery_id is distinct from old.delivery_id or new.article_id is distinct from old.article_id
     or new.client_id is distinct from old.client_id or new.website_id is distinct from old.website_id
     or new.version_id is distinct from old.version_id or new.kind is distinct from old.kind
     or new.attempt_number is distinct from old.attempt_number or new.started_by is distinct from old.started_by
     or new.started_at is distinct from old.started_at then
    raise exception 'a finished attempt is part of the Publishing history and cannot change' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger blog_delivery_attempts_guard_trg before insert or update on blog_delivery_attempts
  for each row execute function blog_delivery_attempts_guard();

alter table blog_delivery_attempts enable row level security;
create policy blog_delivery_attempts_select on blog_delivery_attempts for select
  using (app_can_access_client(client_id) and not app_is_service());
create policy blog_delivery_attempts_insert on blog_delivery_attempts for insert
  with check (app_can_ship_website(website_id));
create policy blog_delivery_attempts_update on blog_delivery_attempts for update
  using (app_can_ship_website(website_id))
  with check (app_can_ship_website(website_id));
grant select, insert, update on blog_delivery_attempts to cg_app;
revoke delete on blog_delivery_attempts from cg_app;

-- ---------------------------------------------------------------------------
-- The website-verified revision, independent of live_version_id
-- ---------------------------------------------------------------------------

create table blog_verified_revisions (
  article_id uuid not null references blog_articles (id),
  website_id uuid not null references websites (id),
  client_id uuid not null references clients (id),
  version_id uuid not null references blog_article_versions (id),
  version_number integer not null,
  delivery_id uuid not null references blog_deliveries (id),
  public_url text check (public_url is null or (public_url ~ '^https?://' and length(public_url) <= 600)),
  verified_at timestamptz not null default now(),
  primary key (article_id, website_id)
);

create or replace function blog_verified_revisions_guard() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1
    from blog_deliveries d
    join blog_article_versions v on v.id = d.version_id
    where d.id = new.delivery_id and d.article_id = new.article_id and d.website_id = new.website_id
      and d.client_id = new.client_id and d.version_id = new.version_id
      and d.state = 'verified' and v.version_number = new.version_number
  ) then
    raise exception 'the verified revision must come from a verified delivery of that revision' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    if new.article_id is distinct from old.article_id or new.website_id is distinct from old.website_id or new.client_id is distinct from old.client_id then
      raise exception 'verified revision identity cannot change' using errcode = 'check_violation';
    end if;
    if new.version_number < old.version_number then
      raise exception 'an older revision cannot replace a newer verified revision' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger blog_verified_revisions_guard_trg before insert or update on blog_verified_revisions
  for each row execute function blog_verified_revisions_guard();

alter table blog_verified_revisions enable row level security;
create policy blog_verified_revisions_select on blog_verified_revisions for select
  using (app_can_access_client(client_id) and not app_is_service());
create policy blog_verified_revisions_insert on blog_verified_revisions for insert
  with check (app_can_ship_website(website_id));
create policy blog_verified_revisions_update on blog_verified_revisions for update
  using (app_can_ship_website(website_id))
  with check (app_can_ship_website(website_id));
grant select, insert, update on blog_verified_revisions to cg_app;
revoke delete on blog_verified_revisions from cg_app;

-- ---------------------------------------------------------------------------
-- The article guard: publish and unpublish are website-scoped. Every other rule is
-- unchanged from 0029 (this body is 0029's with those two checks replaced).
-- ---------------------------------------------------------------------------

create or replace function blog_articles_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
    if not app_can_ship_website(new.website_id) then
      raise exception 'not authorised to publish to this website' using errcode = 'insufficient_privilege';
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
    if not app_can_ship_website(new.website_id) then
      raise exception 'not authorised to unpublish from this website' using errcode = 'insufficient_privilege';
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
end $function$;
