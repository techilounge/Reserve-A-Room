-- Reserve-A-Room · Super Admin management: rooms, amenities, ministries, users, settings,
-- audit log. Every write re-checks the caller is an active Super Admin; configuration
-- tables are audited automatically by the triggers from 20260924100200.

create function private.require_super_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_super_admin() then
    raise exception 'Super Admin access required.' using errcode = 'RAR09';
  end if;
  return (select auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------------

create function public.admin_list_rooms()
returns table (
  id uuid, name text, slug text, description text, location text, capacity integer, image_path text,
  active boolean, reservable boolean, unavailable_message text, approval_required boolean,
  max_advance_value integer, max_advance_unit public.advance_unit, food_drinks_allowed boolean,
  sort_order integer, amenity_ids uuid[], upcoming_count integer, updated_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.require_staff();
  return query
  select r.id, r.name, r.slug, r.description, r.location, r.capacity, r.image_path, r.active, r.reservable,
         r.unavailable_message, r.approval_required, r.max_advance_value, r.max_advance_unit,
         r.food_drinks_allowed, r.sort_order,
         coalesce(array(select ra.amenity_id from public.room_amenities ra where ra.room_id = r.id), '{}'),
         (select count(*)::integer from public.reservations x
           where x.room_id = r.id and x.status in ('pending', 'approved') and x.end_at > now()),
         r.updated_at
  from public.rooms r
  order by r.active desc, r.sort_order, r.name;
end;
$$;

-- Creates (p_id null) or updates a room and its amenities in one transaction.
create function public.save_room(
  p_name text,
  p_slug text,
  p_capacity integer,
  p_approval_required boolean,
  p_food_drinks_allowed boolean,
  p_active boolean,
  p_reservable boolean,
  p_sort_order integer,
  p_amenity_ids uuid[],
  p_description text default null,
  p_location text default null,
  p_unavailable_message text default null,
  p_max_advance_value integer default null,
  p_max_advance_unit public.advance_unit default null,
  -- null ⇒ create a new room
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_super_admin();

  if p_id is null then
    insert into public.rooms (
      name, slug, description, location, capacity, active, reservable, unavailable_message,
      approval_required, max_advance_value, max_advance_unit, food_drinks_allowed, sort_order
    ) values (
      btrim(p_name), lower(btrim(p_slug)), nullif(btrim(p_description), ''), nullif(btrim(p_location), ''),
      p_capacity, p_active, p_reservable, nullif(btrim(p_unavailable_message), ''),
      p_approval_required, p_max_advance_value, p_max_advance_unit, p_food_drinks_allowed, p_sort_order
    )
    returning id into v_id;
  else
    update public.rooms set
      name = btrim(p_name),
      slug = lower(btrim(p_slug)),
      description = nullif(btrim(p_description), ''),
      location = nullif(btrim(p_location), ''),
      capacity = p_capacity,
      active = p_active,
      reservable = p_reservable,
      unavailable_message = nullif(btrim(p_unavailable_message), ''),
      approval_required = p_approval_required,
      max_advance_value = p_max_advance_value,
      max_advance_unit = p_max_advance_unit,
      food_drinks_allowed = p_food_drinks_allowed,
      sort_order = p_sort_order
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Room not found.' using errcode = 'RAR08';
    end if;
  end if;

  delete from public.room_amenities
  where room_id = v_id and not (amenity_id = any (coalesce(p_amenity_ids, '{}')));
  insert into public.room_amenities (room_id, amenity_id)
  select v_id, a.id from public.amenities a where a.id = any (coalesce(p_amenity_ids, '{}'))
  on conflict do nothing;

  return v_id;
end;
$$;

create function public.set_room_image(p_id uuid, p_image_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin();
  if p_image_path is not null and p_image_path !~ ('^rooms/' || p_id::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'Invalid image path.' using errcode = 'RAR10';
  end if;
  update public.rooms set image_path = p_image_path where id = p_id;
  if not found then
    raise exception 'Room not found.' using errcode = 'RAR08';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Amenities + ministries
-- ---------------------------------------------------------------------------

create function public.admin_list_amenities()
returns table (id uuid, name text, icon text, active boolean, sort_order integer)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.require_staff();
  return query select a.id, a.name, a.icon, a.active, a.sort_order from public.amenities a order by a.sort_order, a.name;
end;
$$;

create function public.save_amenity(p_name text, p_icon text, p_active boolean default true, p_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_super_admin();
  if p_id is null then
    insert into public.amenities (name, icon, active, sort_order)
    values (btrim(p_name), nullif(p_icon, ''), p_active, coalesce((select max(sort_order) + 10 from public.amenities), 10))
    returning id into v_id;
  else
    update public.amenities set name = btrim(p_name), icon = nullif(p_icon, ''), active = p_active
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create function public.admin_list_ministries()
returns table (id uuid, name text, active boolean, sort_order integer, reservation_count integer)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.require_staff();
  return query
  select m.id, m.name, m.active, m.sort_order,
         (select count(*)::integer from public.reservations r where r.ministry_id = m.id)
  from public.ministries m
  order by m.active desc, m.sort_order, m.name;
end;
$$;

create function public.save_ministry(p_name text, p_active boolean, p_sort_order integer, p_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_super_admin();
  if p_id is null then
    insert into public.ministries (name, active, sort_order) values (btrim(p_name), p_active, p_sort_order)
    returning id into v_id;
  else
    update public.ministries set name = btrim(p_name), active = p_active, sort_order = p_sort_order
    where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Ministry not found.' using errcode = 'RAR08';
    end if;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Users & roles
-- ---------------------------------------------------------------------------

create function public.admin_list_users()
returns table (
  id uuid, email text, full_name text, role public.app_role, active boolean,
  created_at timestamptz, last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin();
  return query
  select p.id, p.email, p.full_name, p.role, p.active, p.created_at, u.last_sign_in_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by p.active desc, p.role desc, p.full_name;
end;
$$;

-- Called after the server has created/invited the auth user with the service role.
create function public.create_staff_profile(p_user_id uuid, p_full_name text, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_super_admin();
  v_email text;
begin
  select lower(email) into v_email from auth.users where id = p_user_id;
  if v_email is null then
    raise exception 'User not found.' using errcode = 'RAR08';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'That person already has an account.' using errcode = 'RAR10';
  end if;
  insert into public.profiles (id, email, full_name, role, active, invited_by)
  values (p_user_id, v_email, btrim(p_full_name), p_role, true, v_actor);
end;
$$;

-- Role/active changes are audited by the profiles trigger and protected by the
-- last-active-Super-Admin trigger (RAR06).
create function public.set_user_role(p_user_id uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin();
  update public.profiles set role = p_role where id = p_user_id;
  if not found then
    raise exception 'User not found.' using errcode = 'RAR08';
  end if;
end;
$$;

create function public.set_user_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin();
  update public.profiles set active = p_active where id = p_user_id;
  if not found then
    raise exception 'User not found.' using errcode = 'RAR08';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create function public.update_app_settings(
  p_church_name text,
  p_app_name text,
  p_timezone text,
  p_booking_interval_minutes integer,
  p_default_max_advance_value integer,
  p_default_max_advance_unit public.advance_unit,
  p_min_lead_time_minutes integer,
  p_bookable_day_start time,
  p_bookable_day_end time,
  p_allow_guest_cancellation boolean,
  p_extra_admin_notification_emails text[],
  p_email_sender_name text,
  p_contact_email text default null,
  p_contact_phone text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin();
  update public.app_settings set
    church_name = btrim(p_church_name),
    app_name = btrim(p_app_name),
    timezone = p_timezone,
    contact_email = nullif(lower(btrim(p_contact_email)), ''),
    contact_phone = nullif(btrim(p_contact_phone), ''),
    booking_interval_minutes = p_booking_interval_minutes,
    default_max_advance_value = p_default_max_advance_value,
    default_max_advance_unit = p_default_max_advance_unit,
    min_lead_time_minutes = p_min_lead_time_minutes,
    bookable_day_start = p_bookable_day_start,
    bookable_day_end = p_bookable_day_end,
    allow_guest_cancellation = p_allow_guest_cancellation,
    extra_admin_notification_emails = coalesce(
      array(select distinct lower(btrim(e)) from unnest(p_extra_admin_notification_emails) e where btrim(e) <> ''), '{}'),
    email_sender_name = btrim(p_email_sender_name)
  where id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log (Super Admin only; RLS on audit_logs also enforces this)
-- ---------------------------------------------------------------------------

create function public.admin_audit_log(
  p_search text default null,
  p_entity_type text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint, created_at timestamptz, actor_kind public.actor_kind, actor_name text, action text,
  entity_type text, entity_id text, metadata jsonb, total_count bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_search text := nullif(lower(btrim(p_search)), '');
begin
  perform private.require_super_admin();
  return query
  select a.id, a.created_at, a.actor_kind, p.full_name, a.action, a.entity_type, a.entity_id, a.metadata,
         count(*) over ()
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_user_id
  where (p_entity_type is null or a.entity_type = p_entity_type)
    and (v_search is null
      or lower(a.action) like '%' || v_search || '%'
      or lower(coalesce(p.full_name, '')) like '%' || v_search || '%'
      or lower(a.metadata::text) like '%' || v_search || '%'
      or lower(coalesce(a.entity_id, '')) like '%' || v_search || '%')
  order by a.created_at desc, a.id desc
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function private.require_super_admin() from public, anon, authenticated;
grant execute on function private.require_super_admin() to authenticated;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_list_rooms()',
    'public.save_room(text, text, integer, boolean, boolean, boolean, boolean, integer, uuid[], text, text, text, integer, public.advance_unit, uuid)',
    'public.set_room_image(uuid, text)',
    'public.admin_list_amenities()',
    'public.save_amenity(text, text, boolean, uuid)',
    'public.admin_list_ministries()',
    'public.save_ministry(text, boolean, integer, uuid)',
    'public.admin_list_users()',
    'public.create_staff_profile(uuid, text, public.app_role)',
    'public.set_user_role(uuid, public.app_role)',
    'public.set_user_active(uuid, boolean)',
    'public.update_app_settings(text, text, text, integer, integer, public.advance_unit, integer, time, time, boolean, text[], text, text, text)',
    'public.admin_audit_log(text, text, integer, integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;
