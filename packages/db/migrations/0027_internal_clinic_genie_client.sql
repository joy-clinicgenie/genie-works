-- Internal agency directory row. CG-000 stays ahead of the clinic series.
-- Not a demonstration clinic and not a patient-facing account.

insert into clients (
  slug, name, public_name, legal_name, reference_number, short_code, specialty,
  channels, is_synthetic, notes, owner_user_id, enquiry_owner_user_id,
  notification_owner_user_id, administration_owner_user_id, created_by, updated_by
)
select
  'clinic-genie',
  'Clinic Genie',
  'Clinic Genie',
  'Clinic Genie',
  'CG-000',
  'CG',
  'Internal agency',
  array['website', 'seo']::text[],
  false,
  'Internal Clinic Genie record for agency work. Not a clinic client.',
  staff.id,
  staff.id,
  staff.id,
  staff.id,
  staff.id,
  staff.id
from (select id from staff_users where email = 'admin@example.invalid' and active limit 1) as staff
where not exists (select 1 from clients where slug = 'clinic-genie')
  and not exists (select 1 from clients where reference_number = 'CG-000');

insert into clients (
  slug, name, public_name, legal_name, reference_number, short_code, specialty,
  channels, is_synthetic, notes
)
select
  'clinic-genie',
  'Clinic Genie',
  'Clinic Genie',
  'Clinic Genie',
  'CG-000',
  'CG',
  'Internal agency',
  array['website', 'seo']::text[],
  false,
  'Internal Clinic Genie record for agency work. Not a clinic client.'
where not exists (select 1 from clients where slug = 'clinic-genie')
  and not exists (select 1 from clients where reference_number = 'CG-000');
