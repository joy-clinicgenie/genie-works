-- Report builder: template, checklist, website, draft status and frozen preview blocks.
-- Existing reports keep their section keys. A draft updates the working copy and does not add a review version.

alter table saved_reports drop constraint saved_reports_sections;
alter table saved_reports add constraint saved_reports_sections check (
  cardinality(sections) >= 1
  and sections <@ array[
    'traffic', 'engagement', 'enquiries', 'search', 'campaigns',
    'executive', 'website', 'organic', 'seo', 'leads', 'ads', 'blog', 'recommendations'
  ]::text[]
);

alter table saved_reports
  add column website_id uuid references websites (id) on delete set null,
  add column website_label text,
  add column report_type text not null default 'custom' check (report_type in ('monthly', 'quarterly', 'custom')),
  add column template_key text check (template_key is null or template_key in ('monthly', 'seo', 'sem', 'comprehensive')),
  add column status text not null default 'saved' check (status in ('draft', 'saved')),
  add column checklist text[] not null default '{}',
  add column insights jsonb not null default '{}'::jsonb;

alter table saved_report_versions
  add column website_id uuid,
  add column website_label text,
  add column report_type text not null default 'custom',
  add column template_key text,
  add column checklist text[] not null default '{}',
  add column insights jsonb not null default '{}'::jsonb,
  add column blocks jsonb not null default '[]'::jsonb;
