-- Client master list. Short codes are the clinic abbreviations.
-- The three fictional demonstration clients keep their records, but they
-- release CG-001 onwards and leave the active directory.

alter table clients add column short_code text;
create unique index clients_short_code_idx on clients (short_code) where short_code is not null;

update clients
set reference_number = null,
    status = 'archived',
    archived_at = coalesce(archived_at, now()),
    updated_at = now()
where slug in ('harbourview-dental', 'meridian-skin', 'northgate-physio');

insert into clients (slug, name, public_name, reference_number, short_code, channels, is_synthetic)
values
  ('cfac', 'Clementi Family & Aesthetic Clinic', 'Clementi Family & Aesthetic Clinic', 'CG-001', 'CFAC', '{}', false),
  ('cedar', 'Cedar Endocrine, Diabetes & Thyroid Clinic', 'Cedar Endocrine, Diabetes & Thyroid Clinic', 'CG-002', 'CEDAR', '{}', false),
  ('sunrise', 'Sunrise Heart Specialist Clinic', 'Sunrise Heart Specialist Clinic', 'CG-003', 'SUNRISE', '{}', false),
  ('sdic', 'Singapore Dental Implant Centre', 'Singapore Dental Implant Centre', 'CG-004', 'SDIC', '{}', false),
  ('msdc', 'Medical & Surgical Dermatology', 'Medical & Surgical Dermatology', 'CG-005', 'MSDC', '{}', false),
  ('sbsn', 'Singapore Brain Spine Nerves', 'Singapore Brain Spine Nerves', 'CG-006', 'SBSN', '{}', false),
  ('aqua', 'AquaPhysio', 'AquaPhysio', 'CG-007', 'AQUA', '{}', false),
  ('pilot', 'PilotPulse', 'PilotPulse', 'CG-008', 'PILOT', '{}', false),
  ('joyful', 'Joyful Seeds', 'Joyful Seeds', 'CG-009', 'JOYFUL', '{}', false),
  ('tac', 'The Acne Clinic', 'The Acne Clinic', 'CG-010', 'TAC', '{}', false),
  ('thsc', 'The Heart Specialist Clinic', 'The Heart Specialist Clinic', 'CG-011', 'THSC', '{}', false),
  ('dca', 'DCA', 'DCA', 'CG-012', 'DCA', '{}', false),
  ('ekcs', 'EK Centre for Surgery', 'EK Centre for Surgery', 'CG-013', 'EKCS', '{}', false),
  ('komo', 'KOMO', 'KOMO', 'CG-014', 'KOMO', '{}', false)
on conflict (slug) do nothing;
