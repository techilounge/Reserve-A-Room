-- Reserve-A-Room · Super Admins must be deliberately demoted before disabling.

create or replace function public.set_user_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.profiles;
begin
  perform private.require_super_admin();
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found.' using errcode = 'RAR08';
  end if;
  if not p_active and v_target.role = 'super_admin' then
    raise exception 'Demote to Admin before disabling this account.' using errcode = 'RAR11';
  end if;
  update public.profiles set active = p_active where id = p_user_id;
end;
$$;
