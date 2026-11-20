-- SEO-02.1 to SEO-02.4 (D65): staff setup reviews and evidence-based recommendations.

create table seo_setup_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  step text not null check (step in ('website_details', 'homepage_seo', 'indexing')),
  note text check (note is null or length(note) <= 500),
  reviewed_by uuid not null references staff_users (id),
  reviewed_at timestamptz not null default now(),
  foreign key (website_id, client_id) references websites (id, client_id)
);
create index seo_setup_reviews_site_idx on seo_setup_reviews (website_id, step, reviewed_at desc);

create table seo_recommendations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  website_id uuid not null,
  rec_key text not null check (length(rec_key) between 1 and 300),
  kind text not null check (kind in ('missing_description', 'google_excluded', 'sitemap_incomplete', 'llms_missing', 'branch_unmapped')),
  title text not null check (length(title) between 1 and 200),
  affected text not null check (length(affected) between 1 and 300),
  affected_href text check (affected_href is null or (affected_href like '/%' and length(affected_href) <= 500)),
  evidence text not null check (length(evidence) between 1 and 500),
  proposed_action text not null check (length(proposed_action) between 1 and 500),
  status text not null default 'new' check (status in ('new', 'task_created', 'dismissed')),
  task_id uuid unique references tasks (id),
  decided_by uuid references staff_users (id),
  decided_at timestamptz,
  dismiss_reason text check (dismiss_reason is null or length(dismiss_reason) <= 300),
  created_at timestamptz not null default now(),
  unique (website_id, rec_key),
  check ((status = 'task_created') = (task_id is not null)),
  check ((status = 'new') = (decided_at is null)),
  foreign key (website_id, client_id) references websites (id, client_id)
);

do $$
declare t text;
begin
  foreach t in array array['seo_setup_reviews', 'seo_recommendations'] loop
    execute format('create trigger %I before insert or update on %I for each row execute function seo_website_tenant_check()', t || '_tenant_trg', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I_select on %I for select using (app_can_access_client(client_id))', t, t);
  end loop;
end $$;
create policy seo_setup_reviews_insert on seo_setup_reviews for insert
  with check (app_can_edit_client(client_id) and reviewed_by::text = current_setting('app.user_id', true));
create policy seo_recommendations_edit on seo_recommendations for all
  using (app_can_edit_client(client_id)) with check (app_can_edit_client(client_id));
revoke update, delete on seo_setup_reviews from cg_app;
revoke delete on seo_recommendations from cg_app;
