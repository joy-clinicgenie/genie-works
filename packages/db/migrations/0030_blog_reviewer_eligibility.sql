-- Staff cannot read another person's membership, so reviewer eligibility is checked here.

create or replace function blog_reviewer_can_review(p_user uuid, p_client uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from staff_users u
    where u.id = p_user
      and u.active
      and (
        u.platform_role in ('admin', 'manager')
        or (
          u.platform_role = 'reviewer'
          and exists (
            select 1 from memberships m
            where m.user_id = u.id and m.client_id = p_client and m.active
          )
        )
      )
  )
$$;

revoke all on function blog_reviewer_can_review(uuid, uuid) from public;
grant execute on function blog_reviewer_can_review(uuid, uuid) to cg_app;
