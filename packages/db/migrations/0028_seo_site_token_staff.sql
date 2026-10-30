-- Website API tokens are created by staff admins and managers. The public
-- settings API still reads them as the service role.

create policy seo_site_tokens_select on seo_site_tokens
  for select using (app_can_access_client(client_id));

create policy seo_site_tokens_write on seo_site_tokens
  for insert with check (app_is_global() and app_can_access_client(client_id));

create policy seo_site_tokens_update on seo_site_tokens
  for update using (app_is_global()) with check (app_is_global() and app_can_access_client(client_id));
