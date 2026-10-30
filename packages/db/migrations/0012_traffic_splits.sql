-- Demonstration splits for new/returning visitors and sessions by device.
alter table report_snapshots drop constraint report_snapshots_metric_check;
alter table report_snapshots add constraint report_snapshots_metric_check
  check (metric in (
    'impressions', 'clicks', 'sessions', 'enquiries', 'confirmed_appointments', 'patients', 'cost', 'conversions_reported',
    'unique_visitors', 'page_views', 'post_views', 'contact_clicks', 'form_submissions',
    'new_visitors', 'returning_visitors', 'device_sessions'
  ));

alter table report_snapshots drop constraint report_snapshots_channel_check;
alter table report_snapshots add constraint report_snapshots_channel_check
  check (channel in (
    'all', 'organic_search', 'paid_search', 'direct', 'referral', 'social', 'email', 'other',
    'mobile', 'desktop', 'tablet'
  ));
