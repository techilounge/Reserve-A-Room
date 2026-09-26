-- Reserve-A-Room · Recurring staff reservations.
--
-- Rules are stored in typed columns. Occurrences remain ordinary approved reservations,
-- so the existing validation trigger and exclusion constraint stay authoritative.

-- ---------------------------------------------------------------------------
-- Series, occurrence linkage, and materialization exceptions
-- ---------------------------------------------------------------------------

create function private.has_unique_smallints(p_values smallint[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select cardinality(p_values) = cardinality(array(select distinct value from unnest(p_values) as item(value)));
$$;

create table public.reservation_series (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active',
  room_id uuid not null references public.rooms (id) on delete restrict,
  created_by_user_id uuid not null references public.profiles (id) on delete restrict,

  frequency text not null,
  interval_count smallint not null default 1,
  weekdays smallint[] not null default '{}',
  weekday smallint,
  month_ordinals smallint[] not null default '{}',
  month_ordinal smallint,
  day_of_month smallint,
  month_of_year smallint,
  instance_limit smallint not null default 50,
  start_date date not null,
  end_date date,
  local_start_time time not null,
  local_end_time time not null,
  timezone text not null,

  requester_first_name text not null,
  requester_last_name text not null,
  requester_email text not null,
  requester_phone text not null,
  ministry_id uuid references public.ministries (id) on delete restrict,
  other_ministry_name text,
  purpose text not null,
  estimated_attendance integer not null,
  setup_requirements text,
  requester_notes text,
  admin_notes text,
  notify_requester boolean not null default true,

  materialized_through date,
  paused_reason text,
  materialization_claim_id uuid,
  materialization_claimed_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint reservation_series_status_valid check (status in ('active', 'paused', 'ended', 'cancelled')),
  constraint reservation_series_rule_valid check (
    (frequency = 'daily' and interval_count between 1 and 365 and cardinality(weekdays) = 0 and cardinality(month_ordinals) = 0
      and weekday is null and month_ordinal is null and day_of_month is null and month_of_year is null)
    or (frequency = 'weekdays' and interval_count = 1 and cardinality(weekdays) = 0 and cardinality(month_ordinals) = 0
      and weekday is null and month_ordinal is null and day_of_month is null and month_of_year is null)
    or (frequency = 'weekly' and interval_count between 1 and 52 and cardinality(weekdays) between 1 and 7 and cardinality(month_ordinals) = 0
      and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
      and weekday is null and month_ordinal is null and day_of_month is null and month_of_year is null)
    or (frequency = 'monthly_day' and interval_count between 1 and 12 and cardinality(weekdays) = 0 and cardinality(month_ordinals) = 0
      and day_of_month between 1 and 31 and weekday is null and month_ordinal is null and month_of_year is null)
    or (frequency = 'monthly_nth_weekday' and interval_count between 1 and 12 and cardinality(weekdays) = 0
      and weekday between 0 and 6 and cardinality(month_ordinals) between 1 and 5
      and month_ordinals <@ array[-1,1,2,3,4]::smallint[] and private.has_unique_smallints(month_ordinals)
      and month_ordinal is null and day_of_month is null and month_of_year is null)
    or (frequency = 'yearly_date' and interval_count = 1 and cardinality(weekdays) = 0 and cardinality(month_ordinals) = 0
      and month_of_year between 1 and 12 and day_of_month between 1 and 31
      and weekday is null and month_ordinal is null)
    or (frequency = 'yearly_nth_weekday' and interval_count = 1 and cardinality(weekdays) = 0 and cardinality(month_ordinals) = 0
      and month_of_year between 1 and 12 and weekday between 0 and 6
      and month_ordinal in (-1, 1, 2, 3, 4) and day_of_month is null)
  ),
  constraint reservation_series_instance_limit check (instance_limit between 1 and 50),
  constraint reservation_series_date_order check (
    end_date is null or (end_date >= start_date and end_date <= (start_date + interval '1 year')::date)
  ),
  constraint reservation_series_time_order check (local_end_time > local_start_time),
  constraint reservation_series_timezone_valid check (private.is_valid_timezone(timezone)),
  constraint reservation_series_first_name_length check (char_length(btrim(requester_first_name)) between 1 and 80),
  constraint reservation_series_last_name_length check (char_length(btrim(requester_last_name)) between 1 and 80),
  constraint reservation_series_email_valid check (private.is_valid_email(requester_email)),
  constraint reservation_series_phone_e164 check (requester_phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint reservation_series_ministry_choice check ((ministry_id is null) <> (other_ministry_name is null)),
  constraint reservation_series_other_ministry_length check (
    other_ministry_name is null or char_length(btrim(other_ministry_name)) between 1 and 120
  ),
  constraint reservation_series_purpose_length check (char_length(btrim(purpose)) between 1 and 500),
  constraint reservation_series_attendance_range check (estimated_attendance between 1 and 10000),
  constraint reservation_series_setup_length check (setup_requirements is null or char_length(setup_requirements) <= 1000),
  constraint reservation_series_requester_notes_length check (requester_notes is null or char_length(requester_notes) <= 1000),
  constraint reservation_series_admin_notes_length check (admin_notes is null or char_length(admin_notes) <= 4000),
  constraint reservation_series_paused_reason_length check (paused_reason is null or char_length(paused_reason) <= 500),
  constraint reservation_series_materialized_range check (
    materialized_through is null or (
      materialized_through >= start_date
      and materialized_through <= least(coalesce(end_date, (start_date + interval '1 year')::date), (start_date + interval '1 year')::date)
    )
  ),
  constraint reservation_series_claim_pair check (
    (materialization_claim_id is null) = (materialization_claimed_at is null)
  ),
  constraint reservation_series_ended_state check (
    (status in ('ended', 'cancelled')) = (ended_at is not null)
  )
);

create index reservation_series_due_idx
  on public.reservation_series (status, materialized_through, start_date)
  where status = 'active';
create index reservation_series_room_idx on public.reservation_series (room_id);
create index reservation_series_creator_idx on public.reservation_series (created_by_user_id);

create trigger reservation_series_set_updated_at
  before update on public.reservation_series
  for each row execute function private.set_updated_at();

alter table public.reservations
  add column series_id uuid references public.reservation_series (id) on delete set null,
  add column occurrence_date date;

alter table public.reservations
  add constraint reservations_series_occurrence_pair check (
    (series_id is null) = (occurrence_date is null)
  );

create unique index reservations_series_occurrence_key
  on public.reservations (series_id, occurrence_date)
  where series_id is not null;

create table public.reservation_series_exceptions (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.reservation_series (id) on delete cascade,
  occurrence_date date not null,
  reason text not null,
  message text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reservation_series_exceptions_reason_valid check (
    reason in ('conflict', 'room_unavailable', 'outside_rules', 'invalid_local_time')
  ),
  constraint reservation_series_exceptions_message_length check (char_length(btrim(message)) between 1 and 500),
  constraint reservation_series_exceptions_unique unique (series_id, occurrence_date)
);

-- Generic, entity-backed outbox for emails that are not tied to one reservation.
-- Phase 3 uses it for one series summary; later staff-lifecycle events reuse the same
-- delivery infrastructure without overloading reservation email_logs.
create table public.system_email_logs (
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  status public.email_status not null default 'queued',
  provider_message_id text,
  error_message text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint system_email_logs_recipient_valid check (private.is_valid_email(recipient)),
  constraint system_email_logs_event_type_length check (char_length(btrim(event_type)) between 1 and 80),
  constraint system_email_logs_entity_type_length check (char_length(btrim(entity_type)) between 1 and 80),
  constraint system_email_logs_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint system_email_logs_error_length check (error_message is null or char_length(error_message) <= 500),
  constraint system_email_logs_attempts_range check (attempt_count between 0 and 100),
  constraint system_email_logs_once_per_recipient unique (event_type, entity_type, entity_id, recipient)
);

create index system_email_logs_pending_idx
  on public.system_email_logs (status, created_at)
  where status in ('queued', 'sending', 'failed');
create index reservation_series_exceptions_open_idx
  on public.reservation_series_exceptions (series_id, occurrence_date)
  where resolved_at is null;

-- Although series are never deleted by application code, keep the requested SET NULL
-- behavior compatible with the pair constraint by detaching both occurrence fields first.
create function private.detach_series_occurrences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.reservations
  set series_id = null, occurrence_date = null
  where series_id = old.id;
  return old;
end;
$$;

create trigger reservation_series_detach_occurrences
  before delete on public.reservation_series
  for each row execute function private.detach_series_occurrences();

-- ---------------------------------------------------------------------------
-- Pure SQL validation helpers
-- ---------------------------------------------------------------------------

create function private.recurrence_date_matches(
  p_frequency text,
  p_interval_count smallint,
  p_weekdays smallint[],
  p_weekday smallint,
  p_month_ordinals smallint[],
  p_month_ordinal smallint,
  p_day_of_month smallint,
  p_month_of_year smallint,
  p_start_date date,
  p_end_date date,
  p_occurrence_date date
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_occurrence_date >= p_start_date
    and p_occurrence_date <= least(
      coalesce(p_end_date, (p_start_date + interval '1 year')::date),
      (p_start_date + interval '1 year')::date
    )
    and case p_frequency
      when 'daily' then mod(p_occurrence_date - p_start_date, p_interval_count) = 0
      when 'weekdays' then extract(isodow from p_occurrence_date)::integer between 1 and 5
      when 'weekly' then
        extract(dow from p_occurrence_date)::smallint = any(p_weekdays)
        and mod(
          ((p_occurrence_date - (p_start_date - extract(dow from p_start_date)::integer)) / 7),
          p_interval_count
        ) = 0
      when 'monthly_day' then
        extract(day from p_occurrence_date)::smallint = p_day_of_month
        and mod(
          (extract(year from p_occurrence_date)::integer - extract(year from p_start_date)::integer) * 12
            + extract(month from p_occurrence_date)::integer - extract(month from p_start_date)::integer,
          p_interval_count
        ) = 0
      when 'monthly_nth_weekday' then
        extract(dow from p_occurrence_date)::smallint = p_weekday
        and mod(
          (extract(year from p_occurrence_date)::integer - extract(year from p_start_date)::integer) * 12
            + extract(month from p_occurrence_date)::integer - extract(month from p_start_date)::integer,
          p_interval_count
        ) = 0
        and (
          (((extract(day from p_occurrence_date)::integer - 1) / 7) + 1)::smallint = any(p_month_ordinals)
          or (
            -1::smallint = any(p_month_ordinals)
            and (p_occurrence_date + 7)::date > (date_trunc('month', p_occurrence_date)::date + interval '1 month - 1 day')::date
          )
        )
      when 'yearly_date' then
        extract(month from p_occurrence_date)::smallint = p_month_of_year
        and extract(day from p_occurrence_date)::smallint = p_day_of_month
      when 'yearly_nth_weekday' then
        extract(month from p_occurrence_date)::smallint = p_month_of_year
        and extract(dow from p_occurrence_date)::smallint = p_weekday
        and case
          when p_month_ordinal = -1
            then (p_occurrence_date + 7)::date > (date_trunc('month', p_occurrence_date)::date + interval '1 month - 1 day')::date
          when p_month_ordinal between 1 and 4
            then ((extract(day from p_occurrence_date)::integer - 1) / 7) + 1 = p_month_ordinal
          else false
        end
      else false
    end;
$$;

create function private.upsert_series_exception(
  p_series_id uuid,
  p_occurrence_date date,
  p_reason text,
  p_message text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.reservation_series_exceptions (series_id, occurrence_date, reason, message)
  values (p_series_id, p_occurrence_date, p_reason, left(btrim(p_message), 500))
  on conflict (series_id, occurrence_date) do update
    set reason = excluded.reason,
        message = excluded.message,
        resolved_at = null;
$$;

create function private.queue_system_email(
  p_recipient text,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.system_email_logs (recipient, event_type, entity_type, entity_id, payload)
  values (lower(btrim(p_recipient)), btrim(p_event_type), btrim(p_entity_type), p_entity_id, coalesce(p_payload, '{}'::jsonb))
  on conflict (event_type, entity_type, entity_id, recipient) do nothing;
$$;

-- Insert one ordinary approved reservation from a server-produced token pair. Existing
-- occurrence dates are idempotent. Every new row still passes the standard triggers.
create function private.insert_series_occurrence(p_series_id uuid, p_occurrence jsonb)
returns table (occurrence_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series public.reservation_series;
  v_room public.rooms;
  v_date date;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_hash bytea;
  v_seed bytea;
  v_reference text;
  v_id uuid;
  v_attempt integer := 0;
begin
  select * into v_series from public.reservation_series where id = p_series_id for share;
  if not found then
    raise exception 'Recurring series not found.' using errcode = 'RAR08';
  end if;
  if v_series.status <> 'active' then
    raise exception 'This recurring series is not active.' using errcode = 'RAR05';
  end if;
  select * into v_room from public.rooms where id = v_series.room_id for share;
  if not found then
    raise exception 'This room is not available for reservations.' using errcode = 'RAR01';
  end if;

  begin
    v_date := (p_occurrence ->> 'occurrence_date')::date;
    v_start_at := (p_occurrence ->> 'start_at')::timestamptz;
    v_end_at := (p_occurrence ->> 'end_at')::timestamptz;
  exception when others then
    raise exception 'Each recurrence occurrence must include valid date and time values.' using errcode = 'RAR10';
  end;

  if not private.recurrence_date_matches(
    v_series.frequency, v_series.interval_count, v_series.weekdays,
    v_series.weekday, v_series.month_ordinals, v_series.month_ordinal, v_series.day_of_month, v_series.month_of_year,
    v_series.start_date, v_series.end_date, v_date
  ) then
    raise exception 'Occurrence date % does not match the recurrence rule.', v_date using errcode = 'RAR10';
  end if;
  if (v_start_at at time zone v_series.timezone)::date <> v_date
     or (v_end_at at time zone v_series.timezone)::date <> v_date
     or (v_start_at at time zone v_series.timezone)::time <> v_series.local_start_time
     or (v_end_at at time zone v_series.timezone)::time <> v_series.local_end_time then
    raise exception 'Occurrence times do not match the series local schedule.' using errcode = 'RAR10';
  end if;

  select r.id into v_id
  from public.reservations r
  where r.series_id = p_series_id and r.occurrence_date = v_date;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  if (select count(*) from public.reservations r where r.series_id = p_series_id) >= 500 then
    raise exception 'A recurring series may contain at most 500 occurrences.' using errcode = 'RAR10';
  end if;

  begin
    v_hash := decode(p_occurrence ->> 'token_hash', 'hex');
    v_seed := decode(p_occurrence ->> 'token_seed', 'hex');
  exception when others then
    raise exception 'Each recurrence occurrence requires a valid token pair.' using errcode = 'RAR10';
  end;
  if octet_length(v_hash) <> 32 or octet_length(v_seed) <> 16 then
    raise exception 'Each recurrence occurrence requires a valid token pair.' using errcode = 'RAR10';
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
        created_by_user_id, approved_by, approved_at, guest_token_hash, guest_token_seed,
        series_id, occurrence_date
      ) values (
        v_reference, 'approved', 'admin', v_series.room_id, v_start_at, v_end_at,
        v_series.requester_first_name, v_series.requester_last_name,
        v_series.requester_email, v_series.requester_phone,
        v_series.ministry_id, v_series.other_ministry_name, v_series.purpose,
        v_series.estimated_attendance, v_series.setup_requirements,
        v_series.requester_notes, v_series.admin_notes,
        v_room.approval_required, v_room.food_drinks_allowed, v_room.capacity,
        v_series.created_by_user_id, v_series.created_by_user_id, now(), v_hash, v_seed,
        p_series_id, v_date
      )
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then raise; end if;
    end;
  end loop;

  update public.reservation_series_exceptions
  set resolved_at = now()
  where series_id = p_series_id and occurrence_date = v_date and resolved_at is null;

  return query select v_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff create/read/end RPCs
-- ---------------------------------------------------------------------------

create function public.create_recurring_reservation_series(
  p_room_id uuid,
  p_frequency text,
  p_interval_count smallint,
  p_weekdays smallint[],
  p_weekday smallint,
  p_month_ordinals smallint[],
  p_month_ordinal smallint,
  p_day_of_month smallint,
  p_month_of_year smallint,
  p_instance_limit smallint,
  p_start_date date,
  p_end_date date,
  p_local_start_time time,
  p_local_end_time time,
  p_timezone text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_purpose text,
  p_estimated_attendance integer,
  p_occurrences jsonb,
  p_materialized_through date,
  p_ministry_id uuid default null,
  p_other_ministry_name text default null,
  p_setup_requirements text default null,
  p_requester_notes text default null,
  p_admin_notes text default null,
  p_notify boolean default true
)
returns table (series_id uuid, occurrence_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff();
  v_series_id uuid;
  v_room public.rooms;
  v_settings public.app_settings;
  v_horizon date;
  v_item jsonb;
  v_count integer;
  v_distinct_count integer;
  v_insert record;
begin
  if jsonb_typeof(p_occurrences) <> 'array' then
    raise exception 'Occurrences must be an array.' using errcode = 'RAR10';
  end if;
  v_count := jsonb_array_length(p_occurrences);
  if p_instance_limit < 1 or p_instance_limit > 50 or v_count < 1 or v_count > p_instance_limit then
    raise exception 'A recurring series must contain between 1 and 50 occurrences.' using errcode = 'RAR10';
  end if;
  select count(distinct value ->> 'occurrence_date') into v_distinct_count
  from jsonb_array_elements(p_occurrences);
  if v_distinct_count <> v_count then
    raise exception 'Recurring occurrence dates must be unique.' using errcode = 'RAR10';
  end if;

  select * into v_settings from public.app_settings where id;
  if p_timezone <> v_settings.timezone then
    raise exception 'The recurrence timezone must match the application timezone.' using errcode = 'RAR10';
  end if;
  select * into v_room from public.rooms where id = p_room_id for share;
  if not found or not v_room.active or not v_room.reservable then
    raise exception 'This room is not available for reservations.' using errcode = 'RAR01';
  end if;
  if p_ministry_id is not null
     and not exists (select 1 from public.ministries m where m.id = p_ministry_id and m.active) then
    raise exception 'Please choose an active ministry.' using errcode = 'RAR10';
  end if;

  v_horizon := public.booking_horizon_date(p_room_id);
  if p_materialized_through < p_start_date
     or p_materialized_through > v_horizon
     or p_materialized_through > least(
       coalesce(p_end_date, (p_start_date + interval '1 year')::date),
       (p_start_date + interval '1 year')::date
     ) then
    raise exception 'The materialized-through date is outside the allowed window.' using errcode = 'RAR10';
  end if;

  insert into public.reservation_series (
    room_id, created_by_user_id, frequency, interval_count, weekdays,
    weekday, month_ordinals, month_ordinal, day_of_month, month_of_year, instance_limit,
    start_date, end_date, local_start_time, local_end_time, timezone,
    requester_first_name, requester_last_name, requester_email, requester_phone,
    ministry_id, other_ministry_name, purpose, estimated_attendance,
    setup_requirements, requester_notes, admin_notes, notify_requester, materialized_through
  ) values (
    p_room_id, v_actor, p_frequency, p_interval_count, coalesce(p_weekdays, '{}'),
    p_weekday, coalesce(p_month_ordinals, '{}'), p_month_ordinal, p_day_of_month, p_month_of_year, p_instance_limit,
    p_start_date, p_end_date, p_local_start_time, p_local_end_time, p_timezone,
    btrim(p_first_name), btrim(p_last_name), lower(btrim(p_email)), p_phone,
    p_ministry_id, case when p_ministry_id is null then nullif(btrim(p_other_ministry_name), '') end,
    btrim(p_purpose), p_estimated_attendance,
    nullif(btrim(p_setup_requirements), ''), nullif(btrim(p_requester_notes), ''),
    nullif(btrim(p_admin_notes), ''), p_notify, p_materialized_through
  ) returning id into v_series_id;

  for v_item in select value from jsonb_array_elements(p_occurrences) loop
    if (v_item ->> 'occurrence_date')::date > p_materialized_through then
      raise exception 'An occurrence is beyond the materialized-through date.' using errcode = 'RAR10';
    end if;
    select * into v_insert from private.insert_series_occurrence(v_series_id, v_item);
  end loop;

  perform private.write_audit(
    'reservation_series.created', 'reservation_series', v_series_id::text,
    jsonb_build_object(
      'room_id', p_room_id,
      'frequency', p_frequency,
      'occurrence_count', v_count,
      'materialized_through', p_materialized_through
    )
  );
  if p_notify then
    perform private.queue_system_email(
      p_email,
      'recurring_series_created',
      'reservation_series',
      v_series_id,
      jsonb_build_object('occurrence_count', v_count)
    );
  end if;
  return query select v_series_id, v_count;
end;
$$;

create function public.admin_get_reservation_series(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.require_staff();
  select jsonb_build_object(
    'series', to_jsonb(s),
    'occurrences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'reference_code', r.reference_code,
        'occurrence_date', r.occurrence_date,
        'status', r.status,
        'start_at', r.start_at,
        'end_at', r.end_at
      ) order by r.occurrence_date)
      from public.reservations r where r.series_id = s.id
    ), '[]'::jsonb),
    'exceptions', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.occurrence_date)
      from public.reservation_series_exceptions e where e.series_id = s.id
    ), '[]'::jsonb)
  ) into v_result
  from public.reservation_series s
  where s.id = p_id;

  if v_result is null then
    raise exception 'Recurring series not found.' using errcode = 'RAR08';
  end if;
  return v_result;
end;
$$;

create function public.admin_reservation_series_links(p_ids uuid[])
returns table (reservation_id uuid, series_id uuid, occurrence_date date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return query
    select r.id, r.series_id, r.occurrence_date
    from public.reservations r
    where r.id = any(coalesce(p_ids, '{}'::uuid[]));
end;
$$;

create function public.admin_end_reservation_series(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff();
  v_changed boolean := false;
begin
  update public.reservation_series
  set status = 'ended',
      ended_at = now(),
      paused_reason = null,
      materialization_claim_id = null,
      materialization_claimed_at = null
  where id = p_id and status in ('active', 'paused')
  returning true into v_changed;

  if not found then
    if not exists (select 1 from public.reservation_series where id = p_id) then
      raise exception 'Recurring series not found.' using errcode = 'RAR08';
    end if;
    return false;
  end if;

  perform private.write_audit(
    'reservation_series.ended', 'reservation_series', p_id::text,
    jsonb_build_object('ended_by', v_actor)
  );
  return v_changed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role rolling materialization RPCs
-- ---------------------------------------------------------------------------

create function public.claim_series_to_materialize(p_limit integer default 20)
returns table (
  id uuid,
  claim_id uuid,
  room_id uuid,
  frequency text,
  interval_count smallint,
  weekdays smallint[],
  weekday smallint,
  month_ordinals smallint[],
  month_ordinal smallint,
  day_of_month smallint,
  month_of_year smallint,
  instance_limit smallint,
  start_date date,
  end_date date,
  local_start_time time,
  local_end_time time,
  timezone text,
  materialized_through date,
  target_through date,
  occurrence_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'Claim limit must be between 1 and 100.' using errcode = 'RAR10';
  end if;

  return query
  with candidates as (
    select s.id,
      least(
        coalesce(s.end_date, (s.start_date + interval '1 year')::date),
        (s.start_date + interval '1 year')::date,
        public.booking_horizon_date(s.room_id)
      ) as target_date
    from public.reservation_series s
    where s.status = 'active'
      and (select count(*) from public.reservations r where r.series_id = s.id) < s.instance_limit
      and (s.materialization_claimed_at is null or s.materialization_claimed_at < now() - interval '10 minutes')
      and least(
        coalesce(s.end_date, (s.start_date + interval '1 year')::date),
        (s.start_date + interval '1 year')::date,
        public.booking_horizon_date(s.room_id)
      ) >= s.start_date
      and coalesce(s.materialized_through, s.start_date - 1)
          < least(
            coalesce(s.end_date, (s.start_date + interval '1 year')::date),
            (s.start_date + interval '1 year')::date,
            public.booking_horizon_date(s.room_id)
          )
    order by coalesce(s.materialized_through, s.start_date - 1), s.created_at
    for update of s skip locked
    limit p_limit
  ), claimed as (
    update public.reservation_series s
    set materialization_claim_id = gen_random_uuid(),
        materialization_claimed_at = now()
    from candidates c
    where s.id = c.id
    returning s.*, c.target_date
  )
  select c.id, c.materialization_claim_id, c.room_id, c.frequency,
    c.interval_count, c.weekdays, c.weekday, c.month_ordinals, c.month_ordinal, c.day_of_month,
    c.month_of_year, c.instance_limit, c.start_date, c.end_date, c.local_start_time,
    c.local_end_time, c.timezone, c.materialized_through, c.target_date,
    (select count(*)::integer from public.reservations r where r.series_id = c.id)
  from claimed c;
end;
$$;

create function public.materialize_series_occurrences(
  p_series_id uuid,
  p_claim_id uuid,
  p_occurrences jsonb,
  p_materialized_through date,
  p_exceptions jsonb default '[]'::jsonb
)
returns table (created_count integer, exception_count integer, series_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series public.reservation_series;
  v_target date;
  v_item jsonb;
  v_date date;
  v_reason text;
  v_message text;
  v_insert record;
  v_created integer := 0;
  v_exceptions integer := 0;
  v_pause boolean := false;
  v_sqlstate text;
begin
  if jsonb_typeof(p_occurrences) <> 'array' or jsonb_typeof(p_exceptions) <> 'array' then
    raise exception 'Occurrences and exceptions must be arrays.' using errcode = 'RAR10';
  end if;
  if jsonb_array_length(p_occurrences) > 50 or jsonb_array_length(p_exceptions) > 50 then
    raise exception 'A materialization batch may contain at most 50 items.' using errcode = 'RAR10';
  end if;

  select * into v_series from public.reservation_series where id = p_series_id for update;
  if not found then
    raise exception 'Recurring series not found.' using errcode = 'RAR08';
  end if;
  if v_series.status <> 'active' then
    raise exception 'This recurring series is not active.' using errcode = 'RAR05';
  end if;
  if v_series.materialization_claim_id is distinct from p_claim_id
     or v_series.materialization_claimed_at < now() - interval '10 minutes' then
    raise exception 'The materialization claim is missing or expired.' using errcode = 'RAR09';
  end if;

  v_target := least(
    coalesce(v_series.end_date, (v_series.start_date + interval '1 year')::date),
    (v_series.start_date + interval '1 year')::date,
    public.booking_horizon_date(v_series.room_id)
  );
  if p_materialized_through < coalesce(v_series.materialized_through, v_series.start_date - 1)
     or p_materialized_through > v_target then
    raise exception 'The materialized-through date is outside the current window.' using errcode = 'RAR10';
  end if;
  if (select count(*) from public.reservations r where r.series_id = p_series_id)
       + jsonb_array_length(p_occurrences) > v_series.instance_limit then
    raise exception 'A recurring series may contain at most 50 occurrences.' using errcode = 'RAR10';
  end if;

  for v_item in select value from jsonb_array_elements(p_exceptions) loop
    begin
      v_date := (v_item ->> 'occurrence_date')::date;
    exception when others then
      raise exception 'Each exception requires a valid occurrence date.' using errcode = 'RAR10';
    end;
    v_reason := v_item ->> 'reason';
    v_message := coalesce(nullif(btrim(v_item ->> 'message'), ''), 'This occurrence could not be created.');
    if v_date > p_materialized_through
       or not private.recurrence_date_matches(
         v_series.frequency, v_series.interval_count, v_series.weekdays,
         v_series.weekday, v_series.month_ordinals, v_series.month_ordinal, v_series.day_of_month, v_series.month_of_year,
         v_series.start_date, v_series.end_date, v_date
       ) then
      raise exception 'Exception date % does not match the materialization window.', v_date using errcode = 'RAR10';
    end if;
    perform private.upsert_series_exception(p_series_id, v_date, v_reason, v_message);
    v_exceptions := v_exceptions + 1;
    if v_reason = 'room_unavailable' then v_pause := true; end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_occurrences) loop
    if (v_item ->> 'occurrence_date')::date > p_materialized_through then
      raise exception 'An occurrence is beyond the materialized-through date.' using errcode = 'RAR10';
    end if;
    begin
      select * into v_insert from private.insert_series_occurrence(p_series_id, v_item);
      if v_insert.inserted then v_created := v_created + 1; end if;
    exception
      when exclusion_violation then
        v_date := (v_item ->> 'occurrence_date')::date;
        perform private.upsert_series_exception(
          p_series_id, v_date, 'conflict',
          'Another reservation already holds this room and time.'
        );
        v_exceptions := v_exceptions + 1;
      when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
        if v_sqlstate in ('RAR01', 'RAR02', 'RAR03', 'RAR04') then
          v_date := (v_item ->> 'occurrence_date')::date;
          v_reason := case when v_sqlstate = 'RAR01' then 'room_unavailable' else 'outside_rules' end;
          perform private.upsert_series_exception(p_series_id, v_date, v_reason, v_message);
          v_exceptions := v_exceptions + 1;
          if v_sqlstate = 'RAR01' then v_pause := true; end if;
        else
          raise;
        end if;
    end;
  end loop;

  update public.reservation_series
  set materialized_through = greatest(coalesce(materialized_through, p_materialized_through), p_materialized_through),
      status = case when v_pause then 'paused' else status end,
      paused_reason = case when v_pause then 'The room is currently unavailable.' else paused_reason end,
      materialization_claim_id = null,
      materialization_claimed_at = null
  where id = p_series_id;

  perform private.write_audit(
    'reservation_series.materialized', 'reservation_series', p_series_id::text,
    jsonb_build_object(
      'created_count', v_created,
      'exception_count', v_exceptions,
      'materialized_through', p_materialized_through
    ),
    'system'
  );
  if v_pause then
    perform private.write_audit(
      'reservation_series.paused', 'reservation_series', p_series_id::text,
      jsonb_build_object('reason', 'room_unavailable'), 'system'
    );
  end if;

  return query select v_created, v_exceptions, case when v_pause then 'paused' else 'active' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Generic system-email outbox (service-role delivery only)
-- ---------------------------------------------------------------------------

create function public.claim_system_emails(p_limit integer default 20, p_entity_id uuid default null)
returns setof uuid
language sql
security definer
set search_path = ''
as $$
  update public.system_email_logs e
  set status = 'sending', attempt_count = e.attempt_count + 1, last_attempt_at = now()
  where e.id in (
    select x.id from public.system_email_logs x
    where (x.status in ('queued', 'failed') or (x.status = 'sending' and x.last_attempt_at < now() - interval '10 minutes'))
      and x.attempt_count < 5
      and (p_entity_id is null or x.entity_id = p_entity_id)
    order by x.created_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  returning e.id;
$$;

create function public.system_email_context(p_email_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email_id', e.id,
    'recipient', e.recipient,
    'event_type', e.event_type,
    'attempt_count', e.attempt_count,
    'entity_type', e.entity_type,
    'entity_id', e.entity_id,
    'payload', e.payload,
    'settings', to_jsonb(settings),
    'series', to_jsonb(series),
    'room', to_jsonb(room),
    'ministry_name', coalesce(ministry.name, series.other_ministry_name),
    'occurrences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'reference_code', r.reference_code,
        'occurrence_date', r.occurrence_date,
        'start_at', r.start_at,
        'end_at', r.end_at
      ) order by r.occurrence_date)
      from public.reservations r
      where r.series_id = series.id
    ), '[]'::jsonb)
  )
  from public.system_email_logs e
  join public.reservation_series series
    on e.entity_type = 'reservation_series' and series.id = e.entity_id
  join public.rooms room on room.id = series.room_id
  left join public.ministries ministry on ministry.id = series.ministry_id
  cross join public.app_settings settings
  where e.id = p_email_id and settings.id;
$$;

create function public.complete_system_email(
  p_id uuid,
  p_status public.email_status,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email public.system_email_logs;
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'Invalid email status.' using errcode = 'RAR10';
  end if;
  update public.system_email_logs
  set status = p_status,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      error_message = case when p_status = 'failed' then left(p_error, 500) else null end,
      sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_id
  returning * into v_email;

  if p_status = 'failed' then
    perform private.notify_staff(
      'email_failed',
      'Recurring reservation email not delivered',
      'An email to ' || v_email.recipient || ' could not be sent. Review the recurring series.',
      null
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Least-privilege reads and function grants
-- ---------------------------------------------------------------------------

alter table public.reservation_series enable row level security;
alter table public.reservation_series_exceptions enable row level security;
alter table public.system_email_logs enable row level security;

grant select on public.reservation_series to authenticated;
grant select on public.reservation_series_exceptions to authenticated;
grant select (series_id, occurrence_date) on public.reservations to authenticated;

create policy reservation_series_read_staff on public.reservation_series
  for select to authenticated using ((select private.is_staff()));
create policy reservation_series_exceptions_read_staff on public.reservation_series_exceptions
  for select to authenticated using ((select private.is_staff()));

revoke insert, update, delete, truncate on public.reservation_series from anon, authenticated;
revoke insert, update, delete, truncate on public.reservation_series_exceptions from anon, authenticated;
revoke all on public.system_email_logs from anon, authenticated;

revoke execute on function public.create_recurring_reservation_series(
  uuid, text, smallint, smallint[], smallint, smallint[], smallint, smallint, smallint, smallint,
  date, date, time, time, text,
  text, text, text, text, text, integer, jsonb, date,
  uuid, text, text, text, text, boolean
) from public, anon;
grant execute on function public.create_recurring_reservation_series(
  uuid, text, smallint, smallint[], smallint, smallint[], smallint, smallint, smallint, smallint,
  date, date, time, time, text,
  text, text, text, text, text, integer, jsonb, date,
  uuid, text, text, text, text, boolean
) to authenticated, service_role;

revoke execute on function public.admin_get_reservation_series(uuid) from public, anon;
grant execute on function public.admin_get_reservation_series(uuid) to authenticated, service_role;
revoke execute on function public.admin_reservation_series_links(uuid[]) from public, anon;
grant execute on function public.admin_reservation_series_links(uuid[]) to authenticated, service_role;
revoke execute on function public.admin_end_reservation_series(uuid) from public, anon;
grant execute on function public.admin_end_reservation_series(uuid) to authenticated, service_role;

revoke execute on function public.claim_series_to_materialize(integer) from public, anon, authenticated;
grant execute on function public.claim_series_to_materialize(integer) to service_role;
revoke execute on function public.materialize_series_occurrences(uuid, uuid, jsonb, date, jsonb)
  from public, anon, authenticated;
grant execute on function public.materialize_series_occurrences(uuid, uuid, jsonb, date, jsonb)
  to service_role;

revoke execute on function public.claim_system_emails(integer, uuid) from public, anon, authenticated;
revoke execute on function public.system_email_context(uuid) from public, anon, authenticated;
revoke execute on function public.complete_system_email(uuid, public.email_status, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_system_emails(integer, uuid) to service_role;
grant execute on function public.system_email_context(uuid) to service_role;
grant execute on function public.complete_system_email(uuid, public.email_status, text, text) to service_role;

revoke execute on function private.detach_series_occurrences() from public, anon, authenticated;
revoke execute on function private.has_unique_smallints(smallint[]) from public, anon, authenticated;
revoke execute on function private.recurrence_date_matches(
  text, smallint, smallint[], smallint, smallint[], smallint, smallint, smallint, date, date, date
)
  from public, anon, authenticated;
revoke execute on function private.upsert_series_exception(uuid, date, text, text)
  from public, anon, authenticated;
revoke execute on function private.insert_series_occurrence(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function private.queue_system_email(text, text, text, uuid, jsonb)
  from public, anon, authenticated;
