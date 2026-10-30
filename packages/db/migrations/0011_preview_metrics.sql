-- Extra counts the analytics cards can store. A null value still means unavailable, never zero.
alter table report_snapshots drop constraint report_snapshots_metric_check;
alter table report_snapshots add constraint report_snapshots_metric_check
  check (metric in (
    'impressions', 'clicks', 'sessions', 'enquiries', 'confirmed_appointments', 'patients', 'cost', 'conversions_reported',
    'unique_visitors', 'page_views', 'post_views', 'contact_clicks', 'form_submissions'
  ));
