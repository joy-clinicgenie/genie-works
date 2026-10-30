-- Each report download takes the next value from this sequence.
-- The sequence starts at 1. That start value is the serial-number seed.

create sequence report_download_serial as integer start with 1 increment by 1 minvalue 1 no cycle;

create table saved_report_downloads (
  serial_number integer primary key default nextval('report_download_serial'),
  report_id uuid not null references saved_reports (id),
  client_id uuid not null references clients (id),
  version_number integer,
  format text not null check (format in ('csv', 'pdf')),
  downloaded_by uuid not null references staff_users (id),
  downloaded_at timestamptz not null default now()
);

alter sequence report_download_serial owned by saved_report_downloads.serial_number;

create index saved_report_downloads_report_idx on saved_report_downloads (report_id, downloaded_at desc);

alter table saved_report_downloads enable row level security;

create policy saved_report_downloads_select on saved_report_downloads for select using (app_can_access_client(client_id));
create policy saved_report_downloads_insert on saved_report_downloads for insert with check (app_can_access_client(client_id));

create trigger saved_report_downloads_no_update before update on saved_report_downloads for each row execute function block_mutation();
create trigger saved_report_downloads_no_delete before delete on saved_report_downloads for each row execute function block_mutation();

grant select, insert on saved_report_downloads to cg_app;
grant usage, select on sequence report_download_serial to cg_app;
