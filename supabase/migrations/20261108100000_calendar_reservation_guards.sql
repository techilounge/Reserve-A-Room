-- Phase 6 foundation. This migration does not expose an approval RPC.
-- Only a subsequent, authenticated calendar transaction may write a capability.
alter table public.reservations add column calendar_submission_occurrence_id uuid
  references public.calendar_submission_occurrences(id);
create index reservations_calendar_occurrence_idx on public.reservations(calendar_submission_occurrence_id)
  where calendar_submission_occurrence_id is not null;

create table private.calendar_reservation_capabilities (
  transaction_id bigint not null,
  reservation_id uuid not null,
  submission_occurrence_id uuid not null references public.calendar_submission_occurrences(id),
  operation text not null check (operation in ('create','cancel')),
  primary key(transaction_id,reservation_id,operation)
);
revoke all on private.calendar_reservation_capabilities from public, anon, authenticated, service_role;

create function private.calendar_has_reservation_capability(p_reservation uuid,p_occurrence uuid,p_operation text)
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists(select 1 from private.calendar_reservation_capabilities c
    where c.transaction_id=pg_catalog.txid_current() and c.reservation_id=p_reservation
      and c.submission_occurrence_id=p_occurrence and c.operation=p_operation);
$$;
revoke execute on function private.calendar_has_reservation_capability(uuid,uuid,text) from public, anon, authenticated, service_role;

create function private.guard_calendar_reservation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' and new.calendar_submission_occurrence_id is not null then
    if new.source<>'admin' or new.status<>'approved' or new.series_id is not null or
      not private.calendar_has_reservation_capability(new.id,new.calendar_submission_occurrence_id,'create') or
      not exists (select 1 from public.calendar_submission_occurrences o
        join public.calendar_submission_room_requests r on r.submission_occurrence_id=o.id
        join public.calendar_event_submissions s on s.id=o.submission_id
        join public.calendar_event_commitments commitment on commitment.id=new.calendar_commitment_id
          and commitment.submission_id=o.submission_id and commitment.state='active'
        join public.rooms room on room.id=r.room_id
        where o.id=new.calendar_submission_occurrence_id and r.room_id=new.room_id
          and o.occupancy_start=new.start_at and o.occupancy_end=new.end_at
          and (not s.food_drinks_planned or room.food_drinks_allowed)) then
      raise exception 'Calendar reservations require an authorized calendar transaction.' using errcode='RAR09';
    end if;
  elsif tg_op='UPDATE' then
    if old.calendar_submission_occurrence_id is null and new.calendar_submission_occurrence_id is not null then
      raise exception 'An ordinary reservation cannot become a calendar reservation.' using errcode='RAR09';
    end if;
    if old.calendar_submission_occurrence_id is not null then
      if not private.calendar_has_reservation_capability(old.id,old.calendar_submission_occurrence_id,'cancel')
        or new.status<>'cancelled' or old.status<>'approved'
        or (to_jsonb(new)-array['status','cancelled_at','cancelled_by_user_id','updated_at','reservation_range','search_text'])
           is distinct from (to_jsonb(old)-array['status','cancelled_at','cancelled_by_user_id','updated_at','reservation_range','search_text']) then
        raise exception 'Calendar reservations can only be changed through calendar transactions.' using errcode='RAR09';
      end if;
    end if;
  elsif tg_op='DELETE' and old.calendar_submission_occurrence_id is not null then
    raise exception 'Calendar reservation history cannot be deleted.' using errcode='RAR09';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger reservations_00_calendar_guard before insert or update or delete on public.reservations
  for each row execute function private.guard_calendar_reservation();
revoke execute on function private.guard_calendar_reservation() from public, anon, authenticated, service_role;
create or replace function private.validate_reservation()
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

  -- An UPDATE that lists room/time but doesn't change them (e.g. editing notes on a past
  -- reservation) is not a reschedule and must not be re-validated.
  if tg_op = 'UPDATE'
     and new.room_id = old.room_id and new.start_at = old.start_at and new.end_at = old.end_at then
    return new;
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
  if v_local_start::date > v_horizon and not (tg_op = 'INSERT' and new.calendar_submission_occurrence_id is not null
    and private.calendar_has_reservation_capability(new.id,new.calendar_submission_occurrence_id,'create')) then
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
