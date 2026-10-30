-- 0007 Deny by default on identity tables, and keep website records to global roles.
-- Auth.js and the development sign-in links run as the service context. Staff and
-- anonymous contexts have no policy, so they see nothing.

alter table dev_magic_links enable row level security;
alter table verification_token enable row level security;
alter table users enable row level security;
alter table accounts enable row level security;
alter table sessions enable row level security;
alter table schema_migrations enable row level security;

create policy dev_magic_links_service on dev_magic_links for all
  using (app_is_service()) with check (app_is_service());
create policy verification_token_service on verification_token for all
  using (app_is_service()) with check (app_is_service());
create policy users_service on users for all
  using (app_is_service()) with check (app_is_service());
create policy accounts_service on accounts for all
  using (app_is_service()) with check (app_is_service());
create policy sessions_service on sessions for all
  using (app_is_service()) with check (app_is_service());

-- Registry writes match the application rule: admins and managers only.
drop policy websites_write on websites;
create policy websites_write on websites for all
  using (app_is_global()) with check (app_is_global());

drop policy account_references_write on account_references;
create policy account_references_write on account_references for all
  using (app_is_global()) with check (app_is_global());
