-- Keep clinic websites to the profile Website fields: name, URL, platform and environment.
-- Street addresses recorded with those websites are removed. Notes stay empty.

update websites w
set platform = v.platform,
    environment = 'production',
    notes = case when w.notes is not distinct from c.address then null else w.notes end
from clients c
join (
  values
    ('cfac', 'https://www.clementiaesthetic.com/', 'Wix'),
    ('cedar', 'https://www.cedar-endocrine.sg/', 'Wix'),
    ('sunrise', 'https://www.sunriseheart.com.sg/', 'Wix'),
    ('sdic', 'https://www.singaporeimplant.com/', 'Wix'),
    ('msdc', 'https://www.msdermatology.com.sg/', 'Wix'),
    ('sbsn', 'https://www.brainspinenervesg.com/', 'Wix'),
    ('aqua', 'https://www.aquaphysiosg.com/', 'Wix'),
    ('pilot', 'https://pilotpulse.ai/', 'WordPress'),
    ('joyful', 'https://www.joyfulseedspaeds.com.sg/', 'Wix'),
    ('tac', 'https://www.theacneclinic.sg/', 'Wix'),
    ('thsc', 'https://www.theheartspecialistclinic.com/', 'Wix'),
    ('komo', 'https://www.komowellness.com/', 'Vue')
) as v(slug, url, platform) on v.slug = c.slug
where w.client_id = c.id and w.url = v.url;

update clients set address = null, updated_at = now()
where (slug, address) in (
  values
    ('cfac', '321 Clementi Ave 3, #01-14/15, Singapore 129905'),
    ('cedar', E'Mount Alvernia Hospital, 820 Thomson Road, #05-01 Medical Centre A, Singapore 574623\nMount Elizabeth Medical Centre, 3 Mount Elizabeth, #14-06, Singapore 228510'),
    ('sunrise', '365 Sembawang Crescent, #01-02, Singapore 750365'),
    ('sdic', '1 Orchard Boulevard, #06-06, Camden Medical Centre, Singapore 248649'),
    ('msdc', '10 Sinaran Drive, #11-35, Novena Medical Center, Singapore 307506'),
    ('sbsn', '3 Mount Elizabeth, #15-03, Mount Elizabeth Medical Centre, Singapore 228510'),
    ('aqua', '1 Orchard Boulevard, #03-04, Camden Medical Centre, Singapore 248649'),
    ('pilot', '51 Goldhill Plaza, #14-01, Singapore 308900'),
    ('joyful', '883 Bukit Timah Road, Singapore 279894'),
    ('tac', '112 East Coast Road, #03-08, i12 Katong, Singapore 428802'),
    ('thsc', '3 Mount Elizabeth, #14-10, Mount Elizabeth Medical Centre, Singapore 228510'),
    ('komo', '8 Burn Road, #12-05, Trivex, Singapore 369977')
);
