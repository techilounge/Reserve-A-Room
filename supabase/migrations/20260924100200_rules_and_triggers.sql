-- Reserve-A-Room · Authorization helpers, business-rule triggers, audit trail.
--
-- Custom SQLSTATEs raised here are mapped to friendly messages by the app
-- (src/lib/domain/errors.ts):
--   RAR01 room not reservable      RAR02 beyond advance-booking horizon
--   RAR03 start too soon / past    RAR04 outside bookable hours / bad increments
--   RAR05 invalid status change    RAR06 last active Super Admin protection
--   RAR07 rate limited             RAR08 not found / invalid token
--   RAR09 not authorized
-- 23P01 (exclusion_violation) = time slot already held.

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER so RLS on profiles does not recurse)
-- ---------------------------------------------------------------------------

create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and active
  );
$$;

create function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and active and role = 'super_admin'
  );
$$;


-- ---------------------------------------------------------------------------
-- Settings + booking horizon
-- ---------------------------------------------------------------------------

create function private.settings()
returns public.app_settings
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.app_settings where id;
$$;

-- Last local date on which a reservation may START in the given room.
create function public.booking_horizon_date(p_room_id uuid, p_at timestamptz default now())
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select private.add_advance(
    (p_at at time zone s.timezone)::date,
    coalesce(r.max_advance_value, s.default_max_advance_value),
    coalesce(r.max_advance_unit, s.default_max_advance_unit)
  )
  from public.rooms r
  cross join public.app_settings s
  where r.id = p_room_id and s.id;
$$;

-- ---------------------------------------------------------------------------
-- Reference codes: RAR-YYYYMMDD-XXXX (submission date in church time + 4 chars of
-- Crockford base32 without I, L, O, U). Uniqueness is enforced by an index; callers retry.
-- ---------------------------------------------------------------------------

create function private.generate_reference_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  -- The first 4 bytes of a v4 UUID are fully random; 256 is a multiple of 32, so
  -- "byte % 32" is uniform.
  random_bytes bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
  suffix text := '';
  i integer;
begin
  for i in 0..3 loop
    suffix := suffix || substr(alphabet, (get_byte(random_bytes, i) % 32) + 1, 1);
  end loop;
  return 'RAR-' || to_char(pg_catalog.now() at time zone (select timezone from public.app_settings where id), 'YYYYMMDD') || '-' || suffix;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reservation validation (room state, time rules, horizon) + policy snapshots.
-- Fires on INSERT and whenever room/time change, never on status-only updates,
-- so a tightened rule never invalidates an existing booking (ADR-2).
-- ---------------------------------------------------------------------------

create function private.validate_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.app_settings;
  v_room public.rooms;
  v_local_start timestamp;
  v_local_end timestamp;
  v_horizon date;
  v_minutes integer;
begin
  if tg_op = 'UPDATE' and old.status not in ('pending', 'approved') then
    raise exception 'A % reservation cannot be changed.', old.status using errcode = 'RAR05';
  end if;

  if tg_op = 'INSERT' and new.status not in ('pending', 'approved') then
    raise exception 'New reservations must be pending or approved.' using errcode = 'RAR05';
  end if;

  -- Checked here (before the generated range column is computed) so the caller gets a
  -- clear error instead of a range-construction failure.
  if new.end_at <= new.start_at then
    raise exception 'The end time must be after the start time.' using errcode = 'RAR04';
  end if;

  select * into v_settings from public.app_settings where id;

  -- FOR SHARE: the room's rules cannot change underneath this transaction.
  select * into v_room from public.rooms where id = new.room_id for share;
  if not found or not v_room.active or not v_room.reservable then
    raise exception 'This room is not available for reservations.' using errcode = 'RAR01';
  end if;

  if new.start_at <= pg_catalog.now() + pg_catalog.make_interval(mins => v_settings.min_lead_time_minutes)
     or new.start_at <= pg_catalog.now() then
    raise exception 'Reservations must start in the future.' using errcode = 'RAR03';
  end if;

  v_local_start := new.start_at at time zone v_settings.timezone;
  v_local_end := new.end_at at time zone v_settings.timezone;

  v_horizon := private.add_advance(
    (pg_catalog.now() at time zone v_settings.timezone)::date,
    coalesce(v_room.max_advance_value, v_settings.default_max_advance_value),
    coalesce(v_room.max_advance_unit, v_settings.default_max_advance_unit)
  );
  if v_local_start::date > v_horizon then
    raise exception 'This room may only be reserved through %.', v_horizon
      using errcode = 'RAR02', detail = v_horizon::text;
  end if;

  if v_local_end::date <> v_local_start::date
     or v_local_start::time < v_settings.bookable_day_start
     or v_local_end::time > v_settings.bookable_day_end then
    raise exception 'Reservations must be between % and % on a single day.',
      v_settings.bookable_day_start, v_settings.bookable_day_end using errcode = 'RAR04';
  end if;

  foreach v_minutes in array array[
    (extract(hour from v_local_start) * 60 + extract(minute from v_local_start))::integer,
    (extract(hour from v_local_end) * 60 + extract(minute from v_local_end))::integer
  ] loop
    if v_minutes % v_settings.booking_interval_minutes <> 0 then
      raise exception 'Times must be in % minute increments.', v_settings.booking_interval_minutes
        using errcode = 'RAR04';
    end if;
  end loop;
  if extract(second from v_local_start) <> 0 or extract(second from v_local_end) <> 0 then
    raise exception 'Times must be whole minutes.' using errcode = 'RAR04';
  end if;

  -- Snapshots always come from the (destination) room, never from the caller.
  if tg_op = 'INSERT' then
    new.approval_required_at_submission := v_room.approval_required;
    new.food_drinks_allowed_at_submission := v_room.food_drinks_allowed;
    new.room_capacity_at_submission := v_room.capacity;
    if new.status = 'approved' and new.approved_at is null then
      new.approved_at := pg_catalog.now();
    end if;
  elsif new.room_id is distinct from old.room_id then
    new.food_drinks_allowed_at_submission := v_room.food_drinks_allowed;
    new.room_capacity_at_submission := v_room.capacity;
  end if;

  return new;
end;
$$;

create trigger reservations_10_validate
  before insert or update of room_id, start_at, end_at on public.reservations
  for each row execute function private.validate_reservation();

-- ---------------------------------------------------------------------------
-- Central state machine (ADR-17):
--   pending  → approved | declined | cancelled
--   approved → cancelled
--   declined, cancelled → terminal
-- ---------------------------------------------------------------------------

create function private.enforce_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'pending' and new.status in ('approved', 'declined', 'cancelled'))
    or (old.status = 'approved' and new.status = 'cancelled')
  ) then
    raise exception 'A % reservation cannot become %.', old.status, new.status using errcode = 'RAR05';
  end if;

  if new.status = 'approved' then
    -- Approval re-checks that the booking is still usable. It deliberately does NOT
    -- re-apply a horizon that was shortened after submission (ADR-2).
    if new.start_at <= pg_catalog.now() then
      raise exception 'This reservation has already started.' using errcode = 'RAR03';
    end if;
    select * into v_room from public.rooms where id = new.room_id for share;
    if not v_room.active or not v_room.reservable then
      raise exception 'This room is not available for reservations.' using errcode = 'RAR01';
    end if;
    new.approved_at := coalesce(new.approved_at, pg_catalog.now());
  elsif new.status = 'declined' then
    new.declined_at := coalesce(new.declined_at, pg_catalog.now());
  elsif new.status = 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, pg_catalog.now());
  end if;

  return new;
end;
$$;

create trigger reservations_20_status_transition
  before update of status on public.reservations
  for each row execute function private.enforce_status_transition();

-- ---------------------------------------------------------------------------
-- Last active Super Admin protection (ADR-13). The advisory lock serializes
-- concurrent demotions so two Super Admins cannot remove each other at once.
-- ---------------------------------------------------------------------------

create function private.protect_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining integer;
begin
  if not (old.role = 'super_admin' and old.active) then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'super_admin' and new.active then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('reserve_a_room.super_admins'));

  select count(*) into v_remaining
  from public.profiles
  where role = 'super_admin' and active and id <> old.id;

  if v_remaining = 0 then
    raise exception 'At least one active Super Admin is required.' using errcode = 'RAR06';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger profiles_protect_last_super_admin
  before update of role, active or delete on public.profiles
  for each row execute function private.protect_last_super_admin();

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

create function private.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_kind public.actor_kind default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  insert into public.audit_logs (actor_user_id, actor_kind, action, entity_type, entity_id, metadata)
  values (
    -- Only record actors that are real staff profiles.
    (select id from public.profiles where id = v_actor),
    coalesce(p_actor_kind, case when v_actor is null then 'system' else 'staff' end::public.actor_kind),
    p_action,
    p_entity_type,
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- Generic change auditing for configuration tables. Records only the fields that
-- changed. TG_ARGV[0] is the entity name used in the action ("room" → "room.updated").
create function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_entity text := tg_argv[0];
  v_id text;
begin
  for v_key in select jsonb_object_keys(v_old || v_new) loop
    if v_key in ('updated_at', 'created_at') then
      continue;
    end if;
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_changes := v_changes || jsonb_build_object(
        v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key)
      );
    end if;
  end loop;

  if v_changes = '{}'::jsonb then
    return null;
  end if;

  v_id := coalesce(v_new ->> 'id', v_old ->> 'id');
  if v_entity = 'room_amenity' then
    v_id := coalesce(v_new ->> 'room_id', v_old ->> 'room_id');
  end if;

  perform private.write_audit(
    v_entity || '.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
    v_entity,
    v_id,
    jsonb_build_object('changes', v_changes)
  );
  return null;
end;
$$;

create trigger rooms_audit after insert or update or delete on public.rooms
  for each row execute function private.audit_row_change('room');
create trigger room_amenities_audit after insert or delete on public.room_amenities
  for each row execute function private.audit_row_change('room_amenity');
create trigger ministries_audit after insert or update or delete on public.ministries
  for each row execute function private.audit_row_change('ministry');
create trigger amenities_audit after insert or update or delete on public.amenities
  for each row execute function private.audit_row_change('amenity');
create trigger app_settings_audit after update on public.app_settings
  for each row execute function private.audit_row_change('settings');
create trigger profiles_audit after insert or update of role, active, full_name or delete on public.profiles
  for each row execute function private.audit_row_change('user');

-- Audit records are immutable. The single exception is the foreign key's
-- ON DELETE SET NULL, so a deleted staff account leaves its history behind anonymized.
create function private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.actor_user_id is not null
     and new.actor_user_id is null
     and (to_jsonb(new) - 'actor_user_id') = (to_jsonb(old) - 'actor_user_id') then
    return new;
  end if;
  raise exception 'Audit log entries cannot be changed or deleted.' using errcode = 'RAR09';
end;
$$;

create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function private.prevent_audit_mutation();

-- Whoever last changed settings (for the Settings page).
create function private.stamp_settings_editor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := (select id from public.profiles where id = (select auth.uid()));
  return new;
end;
$$;

create trigger app_settings_stamp_editor before update on public.app_settings
  for each row execute function private.stamp_settings_editor();
