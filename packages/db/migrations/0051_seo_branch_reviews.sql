-- SEO-06.1 and SEO-06.2 (D64): saved branch details and staff listing reviews.

alter table seo_business_profiles add column address text check (address is null or length(address) <= 500);
alter table seo_business_profiles add column phone text check (phone is null or length(phone) <= 40);
alter table seo_business_profiles add column opening_hours text check (opening_hours is null or length(opening_hours) <= 1000);
-- A review row must name the branch's own client.
alter table seo_business_profiles add constraint seo_business_profiles_id_client_key unique (id, client_id);

create table seo_branch_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  branch_id uuid not null,
  method text not null check (method in ('public_link', 'location', 'unmapped')),
  reviewed_on date not null,
  fields_reviewed text[] not null check (cardinality(fields_reviewed) between 1 and 4 and fields_reviewed <@ array['name', 'address', 'phone', 'hours']),
  discrepancies jsonb not null default '[]' check (jsonb_typeof(discrepancies) = 'array' and octet_length(discrepancies::text) < 8000),
  reviewed_by uuid not null references staff_users (id),
  created_at timestamptz not null default now(),
  foreign key (branch_id, client_id) references seo_business_profiles (id, client_id)
);
create index seo_branch_reviews_branch_idx on seo_branch_reviews (branch_id, created_at desc);

alter table seo_branch_reviews enable row level security;
create policy seo_branch_reviews_select on seo_branch_reviews for select using (app_can_access_client(client_id));
create policy seo_branch_reviews_insert on seo_branch_reviews for insert with check (app_can_edit_client(client_id) and reviewed_by::text = current_setting('app.user_id', true));
-- Staff observations are append-only.
revoke update, delete on seo_branch_reviews from cg_app;
