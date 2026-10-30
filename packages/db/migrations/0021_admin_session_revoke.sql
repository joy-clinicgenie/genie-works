-- An admin deactivating a staff account must be able to delete that person's
-- sign-in sessions. Sessions otherwise stay visible only to the service context,
-- so the admin update removed access in the staff record and left the session.

create policy sessions_admin_revoke on sessions for delete
  using (app_platform_role() = 'admin');
