-- Wix Inbox as an additional read source for a Wix website, alongside the New Wix
-- Forms connector (D31, D49), which is unchanged. Legacy form submissions appear in
-- Inbox as `form` messages, and the Inbox API has no endpoint that lists conversations,
-- so conversations are discovered from the message_sent_to_business event.
--
-- No submitted field, message body or raw event payload is stored. These rows hold
-- only what is needed to locate a message again and to count it: the website, the
-- conversation and message ids, the source app, the form's own name and the message
-- timestamp. Content is read from Wix when authorised staff open the enquiry.

create table wix_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references websites (id),
  client_id uuid not null references clients (id),
  conversation_id uuid not null,
  -- Wix message ids are numeric strings, not UUIDs.
  message_id text not null check (message_id ~ '^[0-9A-Za-z_-]{1,64}$'),
  sequence text check (sequence is null or sequence ~ '^[0-9]{1,32}$'),
  -- The app that produced the message, so a legacy form can be told from a chat.
  app_id text check (app_id is null or app_id ~ '^[0-9a-fA-F-]{36}$'),
  -- The form's own title as Inbox shows it. Not a submitted field.
  form_title text check (form_title is null or char_length(form_title) between 1 and 200),
  message_created_at timestamptz not null,
  discovered_via text not null check (discovered_via in ('webhook', 'registered')),
  -- Webhook event id, kept for tracing a delivery. Not the message content.
  event_id text check (event_id is null or char_length(event_id) <= 100),
  recorded_at timestamptz not null default now(),
  -- Site, conversation and message together identify one Inbox record, so a repeated
  -- delivery or a repeated read never creates a second enquiry.
  unique (website_id, conversation_id, message_id)
);

create index wix_inbox_messages_client_idx on wix_inbox_messages (client_id, message_created_at desc);
create index wix_inbox_messages_website_idx on wix_inbox_messages (website_id, message_created_at desc);
create index wix_inbox_messages_conversation_idx on wix_inbox_messages (conversation_id);

-- Inbox coverage is partial by nature: events only describe messages received after
-- the webhook was subscribed. The start date is shown beside the counts so a partial
-- window is never presented as every enquiry.
create table wix_inbox_coverage (
  website_id uuid primary key references websites (id),
  client_id uuid not null references clients (id),
  coverage_start_at timestamptz,
  note text check (note is null or char_length(note) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid references staff_users (id)
);

create or replace function wix_inbox_owner_check() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from websites w
    where w.id = new.website_id and w.client_id = new.client_id
      and w.enquiry_source = 'wix' and w.wix_instance_id is not null
  ) then
    raise exception 'Inbox records are only stored for a Wix website of this client' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger wix_inbox_messages_owner_trg before insert or update on wix_inbox_messages
  for each row execute function wix_inbox_owner_check();
create trigger wix_inbox_coverage_owner_trg before insert or update on wix_inbox_coverage
  for each row execute function wix_inbox_owner_check();

-- A message record is evidence of a delivery and is not edited afterwards. The
-- webhook writes it once; a repeated delivery is ignored by the unique index.
create or replace function wix_inbox_messages_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'An Inbox message record cannot be changed' using errcode = '23514';
end $$;

create trigger wix_inbox_messages_append_only_trg before update on wix_inbox_messages
  for each row execute function wix_inbox_messages_append_only();

alter table wix_inbox_messages enable row level security;
create policy wix_inbox_messages_select on wix_inbox_messages for select using (app_can_access_client(client_id));
-- Only trusted server code (the webhook) and an administrator record a message.
create policy wix_inbox_messages_insert on wix_inbox_messages for insert with check (app_is_admin());
grant select, insert on wix_inbox_messages to cg_app;
revoke update, delete on wix_inbox_messages from cg_app;

alter table wix_inbox_coverage enable row level security;
create policy wix_inbox_coverage_select on wix_inbox_coverage for select using (app_can_access_client(client_id));
create policy wix_inbox_coverage_insert on wix_inbox_coverage for insert with check (app_is_admin());
create policy wix_inbox_coverage_update on wix_inbox_coverage for update using (app_is_admin()) with check (app_is_admin());
grant select, insert, update on wix_inbox_coverage to cg_app;
revoke delete on wix_inbox_coverage from cg_app;
