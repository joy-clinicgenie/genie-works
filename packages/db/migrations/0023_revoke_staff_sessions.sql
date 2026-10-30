-- Session rows are hidden from staff by row-level security, including admins.
-- Deactivation still has to remove the live sign-in session. This function runs
-- as the owner, and only after the caller is an admin or the service context.

create or replace function revoke_staff_sessions(staff_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  removed integer;
begin
  if not app_is_admin() then
    raise exception 'only an admin can revoke sessions' using errcode = 'insufficient_privilege';
  end if;
  delete from sessions s
  using users u, staff_users st
  where s."userId" = u.id
    and lower(u.email) = lower(st.email)
    and st.id = staff_id;
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function revoke_staff_sessions(uuid) from public;
grant execute on function revoke_staff_sessions(uuid) to cg_app;
