-- Public websites and clinic locations for the active clinic directory.
-- Locations are the addresses published on those websites.
-- DCA and EK Centre for Surgery have no confirmed public website, so they are left blank.

update clients set address = '321 Clementi Ave 3, #01-14/15, Singapore 129905', updated_at = now()
where slug = 'cfac' and address is null;

update clients set address = E'Mount Alvernia Hospital, 820 Thomson Road, #05-01 Medical Centre A, Singapore 574623\nMount Elizabeth Medical Centre, 3 Mount Elizabeth, #14-06, Singapore 228510', updated_at = now()
where slug = 'cedar' and address is null;

update clients set address = '365 Sembawang Crescent, #01-02, Singapore 750365', updated_at = now()
where slug = 'sunrise' and address is null;

update clients set address = '1 Orchard Boulevard, #06-06, Camden Medical Centre, Singapore 248649', updated_at = now()
where slug = 'sdic' and address is null;

update clients set address = '10 Sinaran Drive, #11-35, Novena Medical Center, Singapore 307506', updated_at = now()
where slug = 'msdc' and address is null;

update clients set address = '3 Mount Elizabeth, #15-03, Mount Elizabeth Medical Centre, Singapore 228510', updated_at = now()
where slug = 'sbsn' and address is null;

update clients set address = '1 Orchard Boulevard, #03-04, Camden Medical Centre, Singapore 248649', updated_at = now()
where slug = 'aqua' and address is null;

update clients set address = '51 Goldhill Plaza, #14-01, Singapore 308900', updated_at = now()
where slug = 'pilot' and address is null;

update clients set address = '883 Bukit Timah Road, Singapore 279894', updated_at = now()
where slug = 'joyful' and address is null;

update clients set address = '112 East Coast Road, #03-08, i12 Katong, Singapore 428802', updated_at = now()
where slug = 'tac' and address is null;

update clients set address = '3 Mount Elizabeth, #14-10, Mount Elizabeth Medical Centre, Singapore 228510', updated_at = now()
where slug = 'thsc' and address is null;

update clients set address = '8 Burn Road, #12-05, Trivex, Singapore 369977', updated_at = now()
where slug = 'komo' and address is null;

insert into websites (client_id, name, url, platform, environment, notes)
select c.id, v.name, v.url, 'unknown', 'production', c.address
from clients c
join (
  values
    ('cfac', 'Clementi Family & Aesthetic Clinic website', 'https://www.clementiaesthetic.com/'),
    ('cedar', 'Cedar Endocrine Clinic website', 'https://www.cedar-endocrine.sg/'),
    ('sunrise', 'Sunrise Heart Specialist Clinic website', 'https://www.sunriseheart.com.sg/'),
    ('sdic', 'Singapore Dental Implant Centre website', 'https://www.singaporeimplant.com/'),
    ('msdc', 'Medical & Surgical Dermatology website', 'https://www.msdermatology.com.sg/'),
    ('sbsn', 'Singapore Brain Spine Nerves website', 'https://www.brainspinenervesg.com/'),
    ('aqua', 'AquaPhysio website', 'https://www.aquaphysiosg.com/'),
    ('pilot', 'PilotPulse website', 'https://pilotpulse.ai/'),
    ('joyful', 'Joyful Seeds website', 'https://www.joyfulseedspaeds.com.sg/'),
    ('tac', 'The Acne Clinic website', 'https://www.theacneclinic.sg/'),
    ('thsc', 'The Heart Specialist Clinic website', 'https://www.theheartspecialistclinic.com/'),
    ('komo', 'KOMO Wellness website', 'https://www.komowellness.com/')
) as v(slug, name, url) on v.slug = c.slug
where not exists (
  select 1 from websites w where w.client_id = c.id and w.url = v.url
);
