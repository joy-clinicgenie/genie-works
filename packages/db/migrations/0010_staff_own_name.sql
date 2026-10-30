-- A staff member may update their own display name.
-- Email, role and active status stay admin-only.

create or replace function staff_users_protect_privileged_columns() returns trigger
language plpgsql as $$
begin
  if app_is_admin() then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.platform_role is distinct from old.platform_role
     or new.active is distinct from old.active
     or new.deactivated_at is distinct from old.deactivated_at
     or new.created_at is distinct from old.created_at
     or new.id is distinct from app_current_user_id() then
    raise exception 'Only an admin can change access, email or account status' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger staff_users_self_guard
before update on staff_users
for each row execute function staff_users_protect_privileged_columns();

create policy staff_users_self_name on staff_users
for update
using (id = app_current_user_id() and active)
with check (id = app_current_user_id() and active);
