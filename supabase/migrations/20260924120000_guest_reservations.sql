-- Reserve-A-Room · Guest reservation functions.
--
-- Guests never touch tables. The server validates input, rate-limits, then calls these
-- SECURITY DEFINER functions with the service role. Each does its whole job in one
-- transaction: reservation + queued emails + staff notifications + audit.
--
-- RAR10 = invalid input (e.g. inactive ministry).

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Staff email recipients: active staff who opted in + extra configured addresses.
create function private.staff_email_recipients()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct lower(email) from (
    select email from public.profiles where active and email_notifications
    union all
    select unnest(extra_admin_notification_emails) from public.app_settings where id
  ) recipients
  where email is not null;
$$;

create function private.queue_email(p_reservation_id uuid, p_recipient text, p_event_type text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.email_logs (reservation_id, recipient, event_type)
  values (p_reservation_id, lower(p_recipient), p_event_type);
$$;

create function private.queue_staff_emails(p_reservation_id uuid, p_event_type text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.email_logs (reservation_id, recipient, event_type)
  select p_reservation_id, r, p_event_type from private.staff_email_recipients() r;
$$;

create function private.notify_staff(p_type text, p_title text, p_message text, p_reservation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, title, message, reservation_id)
  select id, p_type, p_title, p_message, p_reservation_id
  from public.profiles where active;
$$;

-- ---------------------------------------------------------------------------
-- Create (guest)
-- ---------------------------------------------------------------------------

create function public.create_guest_reservation(
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
  -- Exactly one of p_ministry_id / p_other_ministry_name ("Other / Not Listed").
  p_ministry_id uuid default null,
  p_other_ministry_name text default null,
  p_setup_requirements text default null,
  p_requester_notes text default null
)
returns table (id uuid, reference_code text, status public.reservation_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_status public.reservation_status;
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
    raise exception 'Please choose a ministry from the list.' using errcode = 'RAR10';
  end if;

  -- Room-specific approval rule, read in the same transaction as the insert (ADR-1).
  v_status := case when v_room.approval_required then 'pending' else 'approved' end;

  loop
    v_attempt := v_attempt + 1;
    v_reference := private.generate_reference_code();
    begin
      insert into public.reservations (
        reference_code, status, source, room_id, start_at, end_at,
        requester_first_name, requester_last_name, requester_email, requester_phone,
        ministry_id, other_ministry_name, purpose, estimated_attendance,
        setup_requirements, requester_notes,
        approval_required_at_submission, food_drinks_allowed_at_submission, room_capacity_at_submission,
        guest_token_hash, guest_token_seed
      ) values (
        v_reference, v_status, 'guest', p_room_id, p_start_at, p_end_at,
        btrim(p_first_name), btrim(p_last_name), lower(btrim(p_email)), p_phone,
        p_ministry_id, nullif(btrim(p_other_ministry_name), ''), btrim(p_purpose), p_estimated_attendance,
        nullif(btrim(p_setup_requirements), ''), nullif(btrim(p_requester_notes), ''),
        -- Placeholders; the validation trigger replaces them from the room.
        v_room.approval_required, v_room.food_drinks_allowed, v_room.capacity,
        p_token_hash, p_token_seed
      )
      returning reservations.id into v_id;
      exit;
    exception when unique_violation then
      -- Only the reference code is unique; retry with a new one.
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  if v_status = 'pending' then
    perform private.queue_email(v_id, p_email, 'request_submitted');
    perform private.queue_staff_emails(v_id, 'admin_new_request');
    perform private.notify_staff(
      'reservation_pending',
      'New request: ' || v_room.name,
      btrim(p_first_name) || ' ' || btrim(p_last_name) || ' requested ' || v_room.name || '.',
      v_id
    );
  else
    perform private.queue_email(v_id, p_email, 'reservation_confirmed');
  end if;

  perform private.write_audit('reservation.created', 'reservation', v_id::text,
    jsonb_build_object('reference_code', v_reference, 'status', v_status, 'room_id', p_room_id, 'source', 'guest'),
    'guest');

  return query select v_id, v_reference, v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- View + cancel (guest, via secure token)
-- ---------------------------------------------------------------------------

create function public.get_guest_reservation(p_reference text, p_token_hash bytea)
returns table (
  id uuid,
  reference_code text,
  status public.reservation_status,
  room_name text,
  room_slug text,
  room_capacity integer,
  start_at timestamptz,
  end_at timestamptz,
  requester_first_name text,
  ministry_name text,
  purpose text,
  estimated_attendance integer,
  setup_requirements text,
  requester_notes text,
  requester_message text,
  approval_required_at_submission boolean,
  food_drinks_allowed_at_submission boolean,
  room_capacity_at_submission integer,
  created_at timestamptz,
  approved_at timestamptz,
  declined_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_requester boolean,
  can_cancel boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    r.id, r.reference_code, r.status, rm.name, rm.slug, rm.capacity, r.start_at, r.end_at,
    r.requester_first_name, coalesce(m.name, r.other_ministry_name), r.purpose, r.estimated_attendance,
    r.setup_requirements, r.requester_notes, r.requester_message,
    r.approval_required_at_submission, r.food_drinks_allowed_at_submission, r.room_capacity_at_submission,
    r.created_at, r.approved_at, r.declined_at, r.cancelled_at, r.cancelled_by_requester,
    (s.allow_guest_cancellation and r.status in ('pending', 'approved') and r.start_at > now())
  from public.reservations r
  join public.rooms rm on rm.id = r.room_id
  left join public.ministries m on m.id = r.ministry_id
  cross join public.app_settings s
  where r.reference_code = upper(btrim(p_reference))
    and r.guest_token_hash = p_token_hash
    and s.id;

  if not found then
    raise exception 'Reservation not found.' using errcode = 'RAR08';
  end if;
end;
$$;

create function public.cancel_guest_reservation(p_reference text, p_token_hash bytea)
returns public.reservation_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res public.reservations;
  v_allowed boolean;
  v_room_name text;
begin
  select * into v_res from public.reservations r
  where r.reference_code = upper(btrim(p_reference)) and r.guest_token_hash = p_token_hash
  for update;
  if not found then
    raise exception 'Reservation not found.' using errcode = 'RAR08';
  end if;

  select allow_guest_cancellation into v_allowed from public.app_settings where id;
  if not v_allowed then
    raise exception 'Please contact the church office to cancel.' using errcode = 'RAR09';
  end if;
  if v_res.status not in ('pending', 'approved') or v_res.start_at <= now() then
    raise exception 'This reservation can no longer be cancelled online.' using errcode = 'RAR05';
  end if;

  update public.reservations
  set status = 'cancelled', cancelled_at = now(), cancelled_by_requester = true
  where id = v_res.id;

  select name into v_room_name from public.rooms where id = v_res.room_id;

  perform private.queue_email(v_res.id, v_res.requester_email, 'reservation_cancelled');
  perform private.queue_staff_emails(v_res.id, 'admin_reservation_cancelled');
  perform private.notify_staff(
    'reservation_cancelled_by_requester',
    'Cancelled: ' || v_room_name,
    v_res.requester_first_name || ' ' || v_res.requester_last_name || ' cancelled ' || v_res.reference_code || '.',
    v_res.id
  );
  perform private.write_audit('reservation.cancelled', 'reservation', v_res.id::text,
    jsonb_build_object('reference_code', v_res.reference_code, 'from', v_res.status, 'by', 'requester'), 'guest');

  return 'cancelled';
end;
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting (sliding window, keys are HMACs computed by the server)
-- ---------------------------------------------------------------------------

create function public.hit_rate_limit(p_bucket text, p_key_hash text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Serialize hits for the same key so concurrent requests can't both slip under the limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_bucket || ':' || p_key_hash));

  select count(*) into v_count
  from public.rate_limit_events
  where bucket = p_bucket and key_hash = p_key_hash
    and created_at > now() - pg_catalog.make_interval(secs => p_window_seconds);

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.rate_limit_events (bucket, key_hash) values (p_bucket, p_key_hash);

  -- Opportunistic cleanup keeps the table small without a scheduled job.
  if pg_catalog.random() < 0.02 then
    delete from public.rate_limit_events where created_at < now() - interval '2 days';
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service role only
-- ---------------------------------------------------------------------------

revoke execute on function public.create_guest_reservation(uuid, timestamptz, timestamptz, text, text, text, text, text, integer, bytea, bytea, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.get_guest_reservation(text, bytea) from public, anon, authenticated;
revoke execute on function public.cancel_guest_reservation(text, bytea) from public, anon, authenticated;
revoke execute on function public.hit_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke execute on function private.staff_email_recipients() from public, anon, authenticated;
revoke execute on function private.queue_email(uuid, text, text) from public, anon, authenticated;
revoke execute on function private.queue_staff_emails(uuid, text) from public, anon, authenticated;
revoke execute on function private.notify_staff(text, text, text, uuid) from public, anon, authenticated;

grant execute on function public.create_guest_reservation(uuid, timestamptz, timestamptz, text, text, text, text, text, integer, bytea, bytea, uuid, text, text, text) to service_role;
grant execute on function public.get_guest_reservation(text, bytea) to service_role;
grant execute on function public.cancel_guest_reservation(text, bytea) to service_role;
grant execute on function public.hit_rate_limit(text, text, integer, integer) to service_role;
