-- D85. A website may read the Clinic Genie website's Supabase contact form
-- (`contact_submissions`). Rows are read live and are not copied here. Only the
-- source flag, follow-up status and read receipts are stored. Wix columns and
-- tables are left in place. Applied migration files are not edited.

alter table websites drop constraint websites_enquiry_source_check;
alter table websites
  add constraint websites_enquiry_source_check check (enquiry_source in ('database', 'wix', 'supabase'));

alter table websites drop constraint websites_wix_binding_shape;
alter table websites
  add constraint websites_wix_binding_shape check (
    (
      enquiry_source in ('database', 'supabase')
      and wix_instance_id is null
      and wix_form_id is null
      and wix_form_namespace is null
      and wix_form_key is null
      and wix_counts_in_totals = false
    )
    or (
      enquiry_source = 'wix'
      and wix_instance_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and wix_form_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and wix_form_namespace = 'wix.form_app.form'
      and wix_form_key is not null
      and enquiry_key is not null
    )
  );

-- contact_submissions has no website column, so one website reads it.
create unique index websites_one_supabase_source_idx on websites ((true))
  where enquiry_source = 'supabase' and status = 'active';

create or replace function enquiry_follow_ups_owner_check() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from websites w
    where w.id = new.website_id and w.client_id = new.client_id and w.enquiry_source in ('wix', 'supabase')
  ) then
    raise exception 'Follow-up is only stored for an externally read enquiry website' using errcode = '23514';
  end if;
  return new;
end $$;

alter table enquiry_reads drop constraint enquiry_reads_source_check;
alter table enquiry_reads
  add constraint enquiry_reads_source_check check (source in ('database', 'wix', 'supabase'));
