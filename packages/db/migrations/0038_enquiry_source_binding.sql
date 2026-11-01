-- Assign the enquiry key for websites created after 0034, and keep Wix
-- identifier changes to an administrator. The key is the client slug plus
-- the environment. It maps this website to its own enquiry rows. Answers
-- are not copied. Applied migration files are not edited.

do $$
declare
  rec record;
  candidate text;
  n int;
begin
  for rec in
    select w.id, c.slug, w.environment
    from websites w
    join clients c on c.id = w.client_id
    where w.enquiry_key is null
    order by w.created_at
  loop
    candidate := left(rec.slug || '-' || rec.environment, 64);
    n := 2;
    while exists (select 1 from websites where enquiry_key = candidate) loop
      candidate := left(rec.slug || '-' || rec.environment, 64 - length('-' || n::text)) || '-' || n::text;
      n := n + 1;
      if n > 999 then
        raise exception 'enquiry key could not be assigned';
      end if;
    end loop;
    update websites set enquiry_key = candidate where id = rec.id;
  end loop;
end $$;

create or replace function websites_wix_binding_admin_only() returns trigger
language plpgsql as $$
begin
  if current_user <> 'cg_app' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.enquiry_source = 'database'
       and new.wix_instance_id is null
       and new.wix_form_id is null
       and new.wix_form_namespace is null
       and new.wix_form_key is null
       and new.wix_counts_in_totals = false then
      return new;
    end if;
  elsif new.enquiry_source is not distinct from old.enquiry_source
     and new.wix_instance_id is not distinct from old.wix_instance_id
     and new.wix_form_id is not distinct from old.wix_form_id
     and new.wix_form_namespace is not distinct from old.wix_form_namespace
     and new.wix_form_key is not distinct from old.wix_form_key
     and new.wix_counts_in_totals is not distinct from old.wix_counts_in_totals then
    return new;
  end if;
  if app_is_admin() then
    return new;
  end if;
  raise exception 'Only an administrator can change the Wix enquiry binding' using errcode = '42501';
end $$;

create trigger websites_wix_binding_admin_trg
  before insert or update on websites
  for each row execute function websites_wix_binding_admin_only();
