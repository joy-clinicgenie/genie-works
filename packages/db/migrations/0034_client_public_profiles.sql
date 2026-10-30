-- Fill empty client profile fields from each clinic's public website.
-- DCA and EK Centre for Surgery have no confirmed public website, so they stay blank.
-- A published placeholder address or inbox is not stored.
-- Channel tags record a live website, and social only where the site links a public profile.

update clients set
  specialty = coalesce(specialty, 'Family medicine and medical aesthetics'),
  address = coalesce(address, '321 Clementi Ave 3, #01-14/15, Singapore 129905'),
  contact_email = coalesce(contact_email, 'cfac.clementi@gmail.com'),
  contact_phone = coalesce(contact_phone, '+65 6776 6177'),
  services = case when services is null or btrim(services) = '' then
    'Medical aesthetic services and skin treatments, including laser treatments and care for pigmentation, fine lines, wrinkles, age spots and acne scars. Telemedicine consultations are offered.'
  else services end,
  channels = case when channels = '{}' then array['website', 'social'] else channels end,
  updated_at = now()
where slug = 'cfac';

update clients set
  specialty = coalesce(specialty, 'Endocrinology'),
  address = coalesce(address, E'Mount Alvernia Hospital, 820 Thomson Road, #05-01 Medical Centre A, Singapore 574623\nMount Elizabeth Medical Centre, 3 Mount Elizabeth, #14-06, Singapore 228510'),
  contact_email = coalesce(contact_email, 'hello@cedar-endocrine.sg'),
  contact_phone = coalesce(contact_phone, '+65 6370 7660'),
  services = case when services is null or btrim(services) = '' then
    'Endocrine care for diabetes, thyroid disorders, obesity and hormonal conditions. Published treatment areas include type 1, type 2 and gestational diabetes, diabetic weight management, hyperthyroidism, hypothyroidism, thyroid nodules and cancer, pituitary disorders, adrenal disorders, and osteoporosis and calcium disorders.'
  else services end,
  channels = case when channels = '{}' then array['website', 'social'] else channels end,
  updated_at = now()
where slug = 'cedar';

update clients set
  specialty = coalesce(specialty, 'Cardiology'),
  address = coalesce(address, '365 Sembawang Crescent, #01-02, Singapore 750365'),
  contact_email = coalesce(contact_email, 'sunriseheartsg@gmail.com'),
  contact_phone = coalesce(contact_phone, '+65 6235 1137'),
  services = case when services is null or btrim(services) = '' then
    'Cardiology, including heart screening and preventive cardiology, health screening, heart treatment, home sleep apnea testing and advanced cardiac care.'
  else services end,
  channels = case when channels = '{}' then array['website', 'social'] else channels end,
  updated_at = now()
where slug = 'sunrise';

update clients set
  specialty = coalesce(specialty, 'Dental implants'),
  address = coalesce(address, '1 Orchard Boulevard, #06-06, Camden Medical Centre, Singapore 248649'),
  contact_email = coalesce(contact_email, 'singaporeimplant@gmail.com'),
  contact_phone = coalesce(contact_phone, '+65 6235 0059'),
  services = case when services is null or btrim(services) = '' then
    'Dental care centred on implants, including general dentistry, aesthetic dentistry, gum care, laser dentistry, root canal treatment, wisdom tooth removal, braces, crowns and bridges, and regular check-ups and cleaning.'
  else services end,
  channels = case when channels = '{}' then array['website'] else channels end,
  updated_at = now()
where slug = 'sdic';

update clients set
  specialty = coalesce(specialty, 'Dermatology'),
  address = coalesce(address, '10 Sinaran Drive, #11-35, Novena Medical Center, Singapore 307506'),
  contact_email = coalesce(contact_email, 'contact@msdermatology.com.sg'),
  contact_phone = coalesce(contact_phone, '+65 6513 5327'),
  services = case when services is null or btrim(services) = '' then
    'Medical and surgical dermatology, including acne, eczema, psoriasis, rosacea, rashes, urticaria, hidradenitis suppurativa, scalp itch and dandruff, skin cancer surgery, Mohs surgery, cryotherapy, electrocautery, nail procedures and dermatological lasers.'
  else services end,
  channels = case when channels = '{}' then array['website', 'social'] else channels end,
  updated_at = now()
where slug = 'msdc';

update clients set
  specialty = coalesce(specialty, 'Neurosurgery'),
  address = coalesce(address, 'Mount Elizabeth Medical Centre, 3 Mount Elizabeth, #15-03, Singapore 228510'),
  contact_email = coalesce(contact_email, 'brainspinesg@gmail.com'),
  contact_phone = coalesce(contact_phone, '+65 6835 4325'),
  services = case when services is null or btrim(services) = '' then
    'Neurosurgical care for brain, spine and nerve conditions, for adults and children.'
  else services end,
  channels = case when channels = '{}' then array['website'] else channels end,
  updated_at = now()
where slug = 'sbsn';

update clients set
  specialty = coalesce(specialty, 'Physiotherapy'),
  address = coalesce(address, 'Camden Medical Centre, 1 Orchard Boulevard, #03-04, Singapore 248649'),
  contact_email = coalesce(contact_email, 'aquaphysio.rehab@gmail.com'),
  contact_phone = coalesce(contact_phone, '+65 6887 4845'),
  services = case when services is null or btrim(services) = '' then
    'Physiotherapy and aquatic physiotherapy, including electrotherapy, combined therapy and precision therapy, with assessment and treatment for pain, strength, mobility and joint conditions such as arthritis.'
  else services end,
  channels = case when channels = '{}' then array['website', 'social'] else channels end,
  updated_at = now()
where slug = 'aqua';

update clients set
  specialty = coalesce(specialty, 'Artificial intelligence'),
  address = coalesce(address, '51 Goldhill Plaza, #14-01, Singapore 308900'),
  contact_email = coalesce(contact_email, 'info@pilotpulse.ai'),
  contact_phone = coalesce(contact_phone, '+65 9876 8216'),
  services = case when services is null or btrim(services) = '' then
    'AI services, including CTO-as-a-service, an AI solution suite and customisation, conversational AI, audit and training.'
  else services end,
  channels = case when channels = '{}' then array['website'] else channels end,
  updated_at = now()
where slug = 'pilot';

update clients set
  specialty = coalesce(specialty, 'Paediatrics'),
  address = coalesce(address, '883 Bukit Timah Road, Singapore 279894'),
  contact_email = coalesce(contact_email, 'contact@joyfulseedspaeds.com.sg'),
  contact_phone = coalesce(contact_phone, '+65 6322 7307'),
  services = case when services is null or btrim(services) = '' then
    'General paediatrics, developmental and behavioural paediatrics, and vaccination. On-site services include ECG and vision screening.'
  else services end,
  channels = case when channels = '{}' then array['website', 'social'] else channels end,
  updated_at = now()
where slug = 'joyful';

update clients set
  specialty = coalesce(specialty, 'Dermatology'),
  address = coalesce(address, '112 East Coast Road, #03-08, i12 Katong, Singapore 428802'),
  contact_email = coalesce(contact_email, 'contact@theacneclinic.sg'),
  contact_phone = coalesce(contact_phone, '+65 6050 5150'),
  services = case when services is null or btrim(services) = '' then
    'Doctor-led acne care, including assessment and management of comedonal, inflammatory, hormonal and cystic acne. Treatments include medical acne treatment, professional extraction, chemical peels, MesoJet and acne scar care.'
  else services end,
  channels = case when channels = '{}' then array['website', 'social'] else channels end,
  updated_at = now()
where slug = 'tac';

update clients set
  specialty = coalesce(specialty, 'Cardiology'),
  address = coalesce(address, '3 Mount Elizabeth, #14-09/10, Mount Elizabeth Medical Centre, Singapore 228510'),
  contact_phone = coalesce(contact_phone, '+65 6235 8733'),
  services = case when services is null or btrim(services) = '' then
    'General and specialised cardiac care, including cardiac investigations, cardiac implantable electronic devices, cardiac procedures, cardiac screening, echocardiography, electrophysiology and pacing, interventional cardiology and advanced cardiac imaging.'
  else services end,
  channels = case when channels = '{}' then array['website'] else channels end,
  updated_at = now()
where slug = 'thsc';

update clients set
  specialty = coalesce(specialty, 'Scalp and hair wellness'),
  contact_phone = coalesce(contact_phone, '+65 6742 3033'),
  services = case when services is null or btrim(services) = '' then
    'Scalp and hair wellness, combining AI analysis, botanical science and in-person care.'
  else services end,
  channels = case when channels = '{}' then array['website'] else channels end,
  updated_at = now()
where slug = 'komo';

update clients set
  address = coalesce(address, '164 Bukit Merah Central, #03-3625, Singapore 150164'),
  contact_email = coalesce(contact_email, 'hello@clinic-genie.com'),
  services = case when services is null or btrim(services) = '' then
    'Healthcare marketing for private and specialist clinics: healthcare SEO, medical SEM, clinic websites, content and AI search.'
  else services end,
  channels = case when 'social' = any(channels) then channels else channels || array['social'] end,
  updated_at = now()
where slug = 'clinic-genie';
