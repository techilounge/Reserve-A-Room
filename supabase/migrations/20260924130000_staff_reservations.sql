-- Reserve-A-Room · Staff reservation management.
--
-- Reads are SECURITY INVOKER (RLS + column grants still apply) and add an explicit staff
-- check. Writes are SECURITY DEFINER because staff have no direct write grants on
-- reservations; each one re-checks the caller, locks the row, lets the triggers enforce
-- the rules, queues the requester email and writes the audit log — in one transaction.

create function private.require_staff()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'Not authorized.' using errcode = 'RAR09';
  end if;
  return (select auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

create function public.admin_dashboard()
returns table (
  pending_count integer,
  approved_today_count integer,
  upcoming_count integer,
  week_count integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text := (select s.timezone from public.app_settings s where s.id);
  v_today date := (now() at time zone v_tz)::date;
  v_week_start date := v_today - (extract(isodow from v_today)::integer - 1);
begin
  perform private.require_staff();
  return query
  select
    count(*) filter (where r.status = 'pending' and r.end_at > now())::integer,
    count(*) filter (where r.status = 'approved' and (r.approved_at at time zone v_tz)::date = v_today)::integer,
    count(*) filter (where r.status in ('pending', 'approved') and r.start_at >= now())::integer,
    count(*) filter (
      where r.status in ('pending', 'approved')
        and (r.start_at at time zone v_tz)::date between v_week_start and v_week_start + 6
    )::integer
  from public.reservations r;
end;
$$;

-- Search + filters + sort + pagination in one indexed query. total_count is the number of
-- matching rows (for pagination) repeated on every row.
create function public.admin_list_reservations(
  p_search text default null,
  p_statuses public.reservation_status[] default null,
  p_room_id uuid default null,
  p_ministry_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_approval text default null,
  p_sort text default 'start_asc',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  reference_code text,
  status public.reservation_status,
  source public.reservation_source,
  room_id uuid,
  room_name text,
  room_capacity integer,
  start_at timestamptz,
  end_at timestamptz,
  requester_first_name text,
  requester_last_name text,
  requester_email text,
  requester_phone text,
  ministry_name text,
  purpose text,
  estimated_attendance integer,
  approval_required_at_submission boolean,
  approved_by uuid,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text := (select s.timezone from public.app_settings s where s.id);
  v_search text := nullif(lower(btrim(p_search)), '');
begin
  perform private.require_staff();
  return query
  select
    r.id, r.reference_code, r.status, r.source, r.room_id, rm.name, rm.capacity, r.start_at, r.end_at,
    r.requester_first_name, r.requester_last_name, r.requester_email, r.requester_phone,
    coalesce(m.name, r.other_ministry_name), r.purpose, r.estimated_attendance,
    r.approval_required_at_submission, r.approved_by, r.created_at,
    count(*) over ()
  from public.reservations r
  join public.rooms rm on rm.id = r.room_id
  left join public.ministries m on m.id = r.ministry_id
  where (p_statuses is null or r.status = any (p_statuses))
    and (p_room_id is null or r.room_id = p_room_id)
    and (p_ministry_id is null or r.ministry_id = p_ministry_id)
    and (p_from is null or (r.start_at at time zone v_tz)::date >= p_from)
    and (p_to is null or (r.start_at at time zone v_tz)::date <= p_to)
    and (p_approval is null
      or (p_approval = 'required' and r.approval_required_at_submission)
      or (p_approval = 'instant' and not r.approval_required_at_submission))
    and (v_search is null
      or r.search_text like '%' || v_search || '%'
      or lower(rm.name) like '%' || v_search || '%'
      or lower(coalesce(m.name, '')) like '%' || v_search || '%'
      -- Phone numbers are stored as E.164; also match typed digits like "555-0123".
      or (length(regexp_replace(v_search, '\D', '', 'g')) >= 4
          and r.requester_phone like '%' || regexp_replace(v_search, '\D', '', 'g') || '%'))
  order by
    case when p_sort = 'start_asc' then r.start_at end asc,
    case when p_sort = 'start_desc' then r.start_at end desc,
    case when p_sort = 'created_desc' then r.created_at end desc,
    case when p_sort = 'created_asc' then r.created_at end asc,
    r.start_at asc, r.id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
end;
$$;

create function public.admin_get_reservation(p_id uuid)
returns table (
  id uuid,
  reference_code text,
  status public.reservation_status,
  source public.reservation_source,
  room_id uuid,
  room_name text,
  room_slug text,
  room_capacity integer,
  room_food_drinks_allowed boolean,
  room_approval_required boolean,
  start_at timestamptz,
  end_at timestamptz,
  requester_first_name text,
  requester_last_name text,
  requester_email text,
  requester_phone text,
  ministry_id uuid,
  ministry_name text,
  other_ministry_name text,
  purpose text,
  estimated_attendance integer,
  setup_requirements text,
  requester_notes text,
  admin_notes text,
  requester_message text,
  approval_required_at_submission boolean,
  food_drinks_allowed_at_submission boolean,
  room_capacity_at_submission integer,
  created_by_name text,
  approved_by_name text,
  approved_at timestamptz,
  declined_by_name text,
  declined_at timestamptz,
  cancelled_by_name text,
  cancelled_at timestamptz,
  cancelled_by_requester boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.require_staff();
  return query
  select
    r.id, r.reference_code, r.status, r.source, r.room_id, rm.name, rm.slug, rm.capacity,
    rm.food_drinks_allowed, rm.approval_required, r.start_at, r.end_at,
    r.requester_first_name, r.requester_last_name, r.requester_email, r.requester_phone,
    r.ministry_id, m.name, r.other_ministry_name, r.purpose, r.estimated_attendance,
    r.setup_requirements, r.requester_notes, r.admin_notes, r.requester_message,
    r.approval_required_at_submission, r.food_drinks_allowed_at_submission, r.room_capacity_at_submission,
    pc.full_name, pa.full_name, r.approved_at, pd.full_name, r.declined_at, px.full_name, r.cancelled_at,
    r.cancelled_by_requester, r.created_at, r.updated_at
  from public.reservations r
  join public.rooms rm on rm.id = r.room_id
  left join public.ministries m on m.id = r.ministry_id
  left join public.profiles pc on pc.id = r.created_by_user_id
  left join public.profiles pa on pa.id = r.approved_by
  left join public.profiles pd on pd.id = r.declined_by
  left join public.profiles px on px.id = r.cancelled_by_user_id
  where r.id = p_id;
  if not found then
    raise exception 'Reservation not found.' using errcode = 'RAR08';
  end if;
end;
$$;

-- Everything overlapping a local date range, for the calendar.
create function public.admin_calendar(
  p_from date,
  p_to date,
  p_room_id uuid default null,
  p_include_cancelled boolean default false
)
returns table (
  id uuid,
  reference_code text,
  status public.reservation_status,
  room_id uuid,
  room_name text,
  start_at timestamptz,
  end_at timestamptz,
  requester_first_name text,
  requester_last_name text,
  ministry_name text,
  purpose text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text := (select s.timezone from public.app_settings s where s.id);
begin
  perform private.require_staff();
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a range of up to two months.' using errcode = 'RAR10';
  end if;
  return query
  select r.id, r.reference_code, r.status, r.room_id, rm.name, r.start_at, r.end_at,
         r.requester_first_name, r.requester_last_name, coalesce(m.name, r.other_ministry_name), r.purpose
  from public.reservations r
  join public.rooms rm on rm.id = r.room_id
  left join public.ministries m on m.id = r.ministry_id
  where r.reservation_range && tstzrange(
          (p_from::timestamp at time zone v_tz), ((p_to + 1)::timestamp at time zone v_tz), '[)')
    and (p_room_id is null or r.room_id = p_room_id)
    and (r.status in ('pending', 'approved') or (p_include_cancelled and r.status in ('cancelled', 'declined')))
  order by r.start_at, rm.sort_order, rm.name;
end;
$$;

create function public.admin_reservation_emails(p_id uuid)
returns table (
  id uuid,
  recipient text,
  event_type text,
  status public.email_status,
  error_message text,
  attempt_count integer,
  sent_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.require_staff();
  return query
  select e.id, e.recipient, e.event_type, e.status, e.error_message, e.attempt_count, e.sent_at, e.created_at
  from public.email_logs e
  where e.reservation_id = p_id
  order by e.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- State changes
-- ---------------------------------------------------------------------------

create function public.approve_reservation(p_id uuid, p_message text default null)
returns public.reservation_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff();
  v_res public.reservations;
begin
  select * into v_res from public.reservations where id = p_id for update;
  if not found then
    raise exception 'Reservation not found.' using errcode = 'RAR08';
  end if;
  if v_res.status <> 'pending' then
    raise exception 'Only pending requests can be approved.' using errcode = 'RAR05';
  end if;

  -- The status trigger re-checks: still in the future, room still active + reservable.
  update public.reservations
  set status = 'approved', approved_by = v_actor, approved_at = now(),
      requester_message = coalesce(nullif(btrim(p_message), ''), requester_message)
  where id = p_id;

  perform private.queue_email(p_id, v_res.requester_email, 'reservation_approved');
  perform private.write_audit('reservation.approved', 'reservation', p_id::text,
    jsonb_build_object('reference_code', v_res.reference_code));
  return 'approved';
end;
$$;

create function public.decline_reservation(p_id uuid, p_message text default null, p_admin_note text default null)
returns public.reservation_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff();
  v_res public.reservations;
begin
  select * into v_res from public.reservations where id = p_id for update;
  if not found then
    raise exception 'Reservation not found.' using errcode = 'RAR08';
  end if;
  if v_res.status <> 'pending' then
    raise exception 'Only pending requests can be declined.' using errcode = 'RAR05';
  end if;

  update public.reservations
  set status = 'declined', declined_by = v_actor, declined_at = now(),
      requester_message = nullif(btrim(p_message), ''),
      admin_notes = coalesce(nullif(btrim(p_admin_note), ''), admin_notes)
  where id = p_id;

  perform private.queue_email(p_id, v_res.requester_email, 'reservation_declined');
  perform private.write_audit('reservation.declined', 'reservation', p_id::text,
    jsonb_build_object('reference_code', v_res.reference_code, 'with_message', nullif(btrim(p_message), '') is not null));
  return 'declined';
end;
$$;

create function public.cancel_reservation(p_id uuid, p_message text default null)
returns public.reservation_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff();
  v_res public.reservations;
begin
  select * into v_res from public.reservations where id = p_id for update;
  if not found then
    raise exception 'Reservation not found.' using errcode = 'RAR08';
  end if;
  if v_res.status not in ('pending', 'approved') then
    raise exception 'This reservation is already %.', v_res.status using errcode = 'RAR05';
  end if;

  update public.reservations
  set status = 'cancelled', cancelled_by_user_id = v_actor, cancelled_at = now(), cancelled_by_requester = false,
      requester_message = coalesce(nullif(btrim(p_message), ''), requester_message)
  where id = p_id;

  perform private.queue_email(p_id, v_res.requester_email, 'reservation_cancelled');
  perform private.write_audit('reservation.cancelled', 'reservation', p_id::text,
    jsonb_build_object('reference_code', v_res.reference_code, 'from', v_res.status, 'by', 'staff'));
  return 'cancelled';
end;
$$;

-- Edits. Changing room/date/time re-runs every rule via the validation trigger using the
-- destination room (ADR-17). Status never changes here: pending stays pending and
-- approved stays approved. A material change to an approved reservation emails the
-- requester when p_notify is true.
create function public.update_reservation(
  p_id uuid,
  p_room_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_purpose text,
  p_estimated_attendance integer,
  p_ministry_id uuid default null,
  p_other_ministry_name text default null,
  p_setup_requirements text default null,
  p_requester_notes text default null,
  p_admin_notes text default null,
  p_notify boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff();
  v_old public.reservations;
  v_new public.reservations;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_material boolean;
begin
  select * into v_old from public.reservations where id = p_id for update;
  if not found then
    raise exception 'Reservation not found.' using errcode = 'RAR08';
  end if;
  if v_old.status not in ('pending', 'approved') then
    raise exception 'A % reservation cannot be edited.', v_old.status using errcode = 'RAR05';
  end if;
  if p_ministry_id is not null and p_ministry_id is distinct from v_old.ministry_id
     and not exists (select 1 from public.ministries m where m.id = p_ministry_id and m.active) then
    raise exception 'Please choose an active ministry.' using errcode = 'RAR10';
  end if;

  update public.reservations
  set room_id = p_room_id,
      start_at = p_start_at,
      end_at = p_end_at,
      requester_first_name = btrim(p_first_name),
      requester_last_name = btrim(p_last_name),
      requester_email = lower(btrim(p_email)),
      requester_phone = p_phone,
      ministry_id = p_ministry_id,
      other_ministry_name = case when p_ministry_id is null then nullif(btrim(p_other_ministry_name), '') end,
      purpose = btrim(p_purpose),
      estimated_attendance = p_estimated_attendance,
      setup_requirements = nullif(btrim(p_setup_requirements), ''),
      requester_notes = nullif(btrim(p_requester_notes), ''),
      admin_notes = nullif(btrim(p_admin_notes), '')
  where id = p_id
  returning * into v_new;

  foreach v_key in array array[
    'room_id', 'start_at', 'end_at', 'requester_first_name', 'requester_last_name', 'requester_email',
    'requester_phone', 'ministry_id', 'other_ministry_name', 'purpose', 'estimated_attendance',
    'setup_requirements', 'requester_notes', 'admin_notes'
  ] loop
    if (to_jsonb(v_old) -> v_key) is distinct from (to_jsonb(v_new) -> v_key) then
      -- Private notes are recorded as "changed", never their content.
      v_changes := v_changes || jsonb_build_object(v_key,
        case when v_key = 'admin_notes' then jsonb_build_object('changed', true)
             else jsonb_build_object('from', to_jsonb(v_old) -> v_key, 'to', to_jsonb(v_new) -> v_key) end);
    end if;
  end loop;

  if v_changes = '{}'::jsonb then
    return false;
  end if;

  v_material := v_changes ?| array['room_id', 'start_at', 'end_at'];
  if v_material and v_new.status = 'approved' and p_notify then
    perform private.queue_email(p_id, v_new.requester_email, 'reservation_modified');
  end if;

  perform private.write_audit('reservation.updated', 'reservation', p_id::text,
    jsonb_build_object('reference_code', v_new.reference_code, 'material', v_material, 'changes', v_changes));
  return true;
end;
$$;

-- Staff-created reservations are created as approved by that staff member (ADR-1), and
-- still pass every rule. The requester gets the normal confirmation + management link.
create function public.create_staff_reservation(
  p_room_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_purpose text,
  p_estimated_attendance integer,
  p_token_hash bytea,
  p_token_seed bytea,
  p_ministry_id uuid default null,
  p_other_ministry_name text default null,
  p_setup_requirements text default null,
  p_requester_notes text default null,
  p_admin_notes text default null,
  p_notify boolean default true
)
returns table (id uuid, reference_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff();
  v_room public.rooms;
  v_id uuid;
  v_reference text;
  v_attempt integer := 0;
begin
  select * into v_room from public.rooms r where r.id = p_room_id for share;
  if not found or not v_room.active or not v_room.reservable then
    raise exception 'This room is not available for reservations.' using errcode = 'RAR01';
  end if;
  if p_ministry_id is not null
     and not exists (select 1 from public.ministries m where m.id = p_ministry_id and m.active) then
    raise exception 'Please choose an active ministry.' using errcode = 'RAR10';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_reference := private.generate_reference_code();
    begin
      insert into public.reservations (
        reference_code, status, source, room_id, start_at, end_at,
        requester_first_name, requester_last_name, requester_email, requester_phone,
        ministry_id, other_ministry_name, purpose, estimated_attendance,
        setup_requirements, requester_notes, admin_notes,
        approval_required_at_submission, food_drinks_allowed_at_submission, room_capacity_at_submission,
        created_by_user_id, approved_by, approved_at, guest_token_hash, guest_token_seed
      ) values (
        v_reference, 'approved', 'admin', p_room_id, p_start_at, p_end_at,
        btrim(p_first_name), btrim(p_last_name), lower(btrim(p_email)), p_phone,
        p_ministry_id, case when p_ministry_id is null then nullif(btrim(p_other_ministry_name), '') end,
        btrim(p_purpose), p_estimated_attendance,
        nullif(btrim(p_setup_requirements), ''), nullif(btrim(p_requester_notes), ''), nullif(btrim(p_admin_notes), ''),
        v_room.approval_required, v_room.food_drinks_allowed, v_room.capacity,
        v_actor, v_actor, now(), p_token_hash, p_token_seed
      )
      returning reservations.id into v_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  if p_notify then
    perform private.queue_email(v_id, p_email, 'reservation_confirmed');
  end if;
  perform private.write_audit('reservation.created', 'reservation', v_id::text,
    jsonb_build_object('reference_code', v_reference, 'status', 'approved', 'room_id', p_room_id, 'source', 'admin'));
  return query select v_id, v_reference;
end;
$$;

-- Private staff notes only (no requester email, no rescheduling rules involved).
create function public.update_admin_notes(p_id uuid, p_admin_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text;
begin
  perform private.require_staff();
  update public.reservations set admin_notes = nullif(btrim(p_admin_notes), '')
  where id = p_id
  returning reference_code into v_ref;
  if v_ref is null then
    raise exception 'Reservation not found.' using errcode = 'RAR08';
  end if;
  perform private.write_audit('reservation.notes_updated', 'reservation', p_id::text,
    jsonb_build_object('reference_code', v_ref));
end;
$$;

-- The signed-in user's own staff profile (empty when they have none).
create function public.current_staff_profile()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.app_role,
  active boolean,
  email_notifications boolean
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.email, p.full_name, p.role, p.active, p.email_notifications
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function private.require_staff() from public, anon, authenticated;
grant execute on function private.require_staff() to authenticated;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_dashboard()',
    'public.admin_list_reservations(text, public.reservation_status[], uuid, uuid, date, date, text, text, integer, integer)',
    'public.admin_get_reservation(uuid)',
    'public.admin_calendar(date, date, uuid, boolean)',
    'public.admin_reservation_emails(uuid)',
    'public.approve_reservation(uuid, text)',
    'public.decline_reservation(uuid, text, text)',
    'public.cancel_reservation(uuid, text)',
    'public.update_reservation(uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, integer, uuid, text, text, text, text, boolean)',
    'public.create_staff_reservation(uuid, timestamptz, timestamptz, text, text, text, text, text, integer, bytea, bytea, uuid, text, text, text, text, boolean)',
    'public.update_admin_notes(uuid, text)',
    'public.current_staff_profile()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;
