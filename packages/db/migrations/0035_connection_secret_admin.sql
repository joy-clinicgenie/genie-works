-- D14: connection credential writes stay with an administrator.
-- app_is_admin() still includes the service context, so worker and
-- service writes continue. Registry edits stay with admin and manager.
-- Applied migrations are not edited.

drop policy analytics_connections_write on analytics_connections;
create policy analytics_connections_write on analytics_connections
  for all using (app_is_admin()) with check (app_is_admin());

drop policy seo_site_tokens_write on seo_site_tokens;
create policy seo_site_tokens_write on seo_site_tokens
  for insert with check (app_is_admin() and app_can_access_client(client_id));

drop policy seo_site_tokens_update on seo_site_tokens;
create policy seo_site_tokens_update on seo_site_tokens
  for update using (app_is_admin()) with check (app_is_admin() and app_can_access_client(client_id));
