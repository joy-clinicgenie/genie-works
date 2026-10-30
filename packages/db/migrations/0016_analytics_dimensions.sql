-- Page, click, flow and location rows need their own slot. Headline totals stay on a blank dimension.
alter table report_snapshots add column dimension text not null default '';

alter table report_snapshots drop constraint report_snapshots_metric_check;
alter table report_snapshots add constraint report_snapshots_metric_check
  check (metric in (
    'impressions', 'clicks', 'sessions', 'enquiries', 'confirmed_appointments', 'patients', 'cost', 'conversions_reported',
    'unique_visitors', 'page_views', 'post_views', 'contact_clicks', 'form_submissions',
    'new_visitors', 'returning_visitors', 'device_sessions',
    'avg_session_duration', 'pages_per_session', 'bounce_rate', 'avg_position',
    'form_views', 'form_starts', 'form_failures',
    'contact_whatsapp', 'contact_phone', 'contact_email', 'contact_booking',
    'page_visits', 'page_clicks', 'page_time', 'page_exit_rate',
    'click_target', 'nav_flow', 'form_location',
    'landing_sessions', 'landing_contacts'
  ));

drop index report_snapshots_current_idx;
create unique index report_snapshots_current_idx
  on report_snapshots (client_id, source, channel, metric, dimension, period_start, period_end)
  where superseded_by_id is null;

create or replace function report_snapshots_guard() returns trigger
language plpgsql as $$
begin
  if old.superseded_by_id is not null or new.superseded_by_id is null
     or new.value is distinct from old.value or new.note is distinct from old.note or new.metric <> old.metric
     or new.period_start <> old.period_start or new.period_end <> old.period_end or new.source <> old.source
     or new.channel <> old.channel or new.dimension is distinct from old.dimension
     or new.client_id <> old.client_id or new.entered_by <> old.entered_by then
    raise exception 'report_snapshots is append-only' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
