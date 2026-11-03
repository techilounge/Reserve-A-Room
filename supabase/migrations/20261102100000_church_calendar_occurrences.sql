-- Phase 3 planning facts only. No reservation or confirmed allocation is created.
create table public.calendar_event_occurrences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events(id),
  logical_occurrence_id uuid not null default gen_random_uuid(),
  source_key text not null,
  source_date_id uuid,
  schedule_revision integer not null check (schedule_revision > 0),
  local_start timestamp without time zone not null,
  local_end timestamp without time zone not null,
  timezone text not null check (private.is_valid_timezone(timezone)),
  all_day boolean not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  event_range tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  occupancy_start timestamptz not null,
  occupancy_end timestamptz not null,
  occupancy_range tstzrange generated always as (tstzrange(occupancy_start, occupancy_end, '[)')) stored,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'superseded')),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, logical_occurrence_id),
  check (end_at > start_at and occupancy_start <= start_at and occupancy_end >= end_at)
);
create unique index calendar_occurrences_current_source on public.calendar_event_occurrences(event_id, source_key) where status = 'scheduled';
create index calendar_occurrences_event_start on public.calendar_event_occurrences(event_id, start_at);

create table public.calendar_event_room_requests (
  occurrence_id uuid not null references public.calendar_event_occurrences(id),
  room_id uuid not null references public.rooms(id),
  origin text not null check (origin in ('template', 'exception')),
  primary key (occurrence_id, room_id)
);
create table public.calendar_event_resource_requests (
  occurrence_id uuid not null references public.calendar_event_occurrences(id),
  resource_id uuid not null references public.calendar_resources(id),
  origin text not null check (origin in ('template', 'exception')),
  quantity_requested integer not null check (quantity_requested > 0),
  notes text check (char_length(notes) <= 1000),
  primary key (occurrence_id, resource_id)
);
create table public.calendar_occurrence_room_exceptions (
  occurrence_id uuid not null references public.calendar_event_occurrences(id),
  room_id uuid not null references public.rooms(id),
  operation text not null check (operation in ('add', 'remove')),
  reason text check (char_length(reason) <= 1000),
  primary key (occurrence_id, room_id)
);
create table public.calendar_occurrence_resource_exceptions (
  occurrence_id uuid not null references public.calendar_event_occurrences(id),
  resource_id uuid not null references public.calendar_resources(id),
  operation text not null check (operation in ('add', 'remove', 'quantity_override')),
  quantity_requested integer,
  notes text check (char_length(notes) <= 1000),
  primary key (occurrence_id, resource_id),
  check ((operation = 'remove' and quantity_requested is null) or (operation <> 'remove' and quantity_requested > 0))
);

create table public.calendar_submission_occurrences (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.calendar_event_submissions(id),
  occurrence_id uuid not null references public.calendar_event_occurrences(id),
  logical_occurrence_id uuid not null,
  source_date_id uuid,
  local_start timestamp without time zone not null,
  local_end timestamp without time zone not null,
  timezone text not null,
  all_day boolean not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  occupancy_start timestamptz not null,
  occupancy_end timestamptz not null,
  event_range tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  occupancy_range tstzrange generated always as (tstzrange(occupancy_start, occupancy_end, '[)')) stored,
  unique (submission_id, logical_occurrence_id),
  check (end_at > start_at and occupancy_start <= start_at and occupancy_end >= end_at)
);
create table public.calendar_submission_room_requests (
  submission_occurrence_id uuid not null references public.calendar_submission_occurrences(id),
  room_id uuid not null references public.rooms(id),
  origin text not null check (origin in ('template', 'exception')),
  primary key (submission_occurrence_id, room_id)
);
create table public.calendar_submission_resource_requests (
  submission_occurrence_id uuid not null references public.calendar_submission_occurrences(id),
  resource_id uuid not null references public.calendar_resources(id),
  origin text not null check (origin in ('template', 'exception')),
  quantity_requested integer not null check (quantity_requested > 0),
  notes text,
  primary key (submission_occurrence_id, resource_id)
);
create trigger calendar_submission_occurrences_immutable before update or delete on public.calendar_submission_occurrences for each row execute function private.calendar_snapshot_immutable();
create trigger calendar_submission_room_requests_immutable before update or delete on public.calendar_submission_room_requests for each row execute function private.calendar_snapshot_immutable();
create trigger calendar_submission_resource_requests_immutable before update or delete on public.calendar_submission_resource_requests for each row execute function private.calendar_snapshot_immutable();

alter table public.calendar_event_occurrences enable row level security;
alter table public.calendar_event_room_requests enable row level security;
alter table public.calendar_event_resource_requests enable row level security;
alter table public.calendar_occurrence_room_exceptions enable row level security;
alter table public.calendar_occurrence_resource_exceptions enable row level security;
alter table public.calendar_submission_occurrences enable row level security;
alter table public.calendar_submission_room_requests enable row level security;
alter table public.calendar_submission_resource_requests enable row level security;
revoke all on public.calendar_event_occurrences, public.calendar_event_room_requests, public.calendar_event_resource_requests,
  public.calendar_occurrence_room_exceptions, public.calendar_occurrence_resource_exceptions,
  public.calendar_submission_occurrences, public.calendar_submission_room_requests, public.calendar_submission_resource_requests
  from public, anon, authenticated, service_role;

-- Calendar's matcher is deliberately separate from reservation_series' one-year
-- matcher. The caller limits generation to the three-year cycle and 1,200 rows.
create function private.calendar_date_matches(s public.calendar_event_submissions, d date)
returns boolean language sql immutable set search_path = '' as $$
  select d between s.start_date and s.end_date and case s.frequency
    when 'daily' then mod(d - s.start_date, s.interval_count) = 0
    when 'weekdays' then extract(isodow from d)::integer between 1 and 5
    when 'weekly' then extract(dow from d)::integer = any(s.weekdays)
      and mod((d - (s.start_date - extract(dow from s.start_date)::integer)) / 7, s.interval_count) = 0
    when 'monthly_day' then extract(day from d)::integer = s.day_of_month
      and mod((extract(year from d)::integer - extract(year from s.start_date)::integer) * 12
        + extract(month from d)::integer - extract(month from s.start_date)::integer, s.interval_count) = 0
    when 'monthly_nth_weekday' then extract(dow from d)::integer = s.weekday
      and mod((extract(year from d)::integer - extract(year from s.start_date)::integer) * 12
        + extract(month from d)::integer - extract(month from s.start_date)::integer, s.interval_count) = 0
      and (((extract(day from d)::integer - 1) / 7 + 1) = any(s.month_ordinals)
        or (-1 = any(s.month_ordinals) and (d + 7) > (date_trunc('month', d)::date + interval '1 month - 1 day')::date))
    when 'yearly_date' then extract(month from d)::integer = s.month_of_year and extract(day from d)::integer = s.day_of_month
    when 'yearly_nth_weekday' then extract(month from d)::integer = s.month_of_year and extract(dow from d)::integer = s.weekday
      and case when s.month_ordinal = -1 then (d + 7) > (date_trunc('month', d)::date + interval '1 month - 1 day')::date
        else ((extract(day from d)::integer - 1) / 7 + 1) = s.month_ordinal end
    else false end;
$$;

-- PostgreSQL chooses the standard-time (later) occurrence of an ambiguous
-- fall-back wall time. A spring-forward gap fails the round trip and is rejected.
create function private.calendar_local_instant(p_local timestamp without time zone, p_timezone text)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare v_instant timestamptz;
begin
  v_instant := p_local at time zone p_timezone;
  if (v_instant at time zone p_timezone) is distinct from p_local then
    raise exception 'A calendar event uses a nonexistent local time.' using errcode = 'RAR09';
  end if;
  return v_instant;
end;
$$;

create function private.calendar_submission_candidates(p_submission uuid)
returns table(source_key text, source_date_id uuid, local_start timestamp without time zone, local_end timestamp without time zone)
language sql stable set search_path = '' as $$
  select 'single', null::uuid, s.start_date + coalesce(s.start_time, time '00:00'),
    case when s.all_day then (s.end_date + 1)::timestamp else s.end_date + s.end_time end
  from public.calendar_event_submissions s where s.id = p_submission and s.schedule_kind in ('one_time', 'multi_day')
  union all
  select 'date:' || d.logical_date_id::text, d.logical_date_id,
    d.local_date + coalesce(d.local_start_time, time '00:00'),
    case when s.all_day then (d.local_end_date + 1)::timestamp else d.local_end_date + d.local_end_time end
  from public.calendar_event_submissions s join public.calendar_submission_dates d on d.submission_id = s.id
  where s.id = p_submission and s.schedule_kind = 'specific_dates'
  union all
  select 'recurring:' || to_char(g.day, 'YYYY-MM-DD'), null::uuid,
    g.day::date + coalesce(s.start_time, time '00:00'),
    case when s.all_day then (g.day::date + 1)::timestamp else g.day::date + s.end_time end
  from public.calendar_event_submissions s
    cross join lateral generate_series(s.start_date::timestamp, s.end_date::timestamp, interval '1 day') g(day)
  where s.id = p_submission and s.schedule_kind = 'recurring' and private.calendar_date_matches(s, g.day::date);
$$;
revoke execute on function private.calendar_date_matches(public.calendar_event_submissions, date),
  private.calendar_local_instant(timestamp without time zone, text), private.calendar_submission_candidates(uuid)
  from public, anon, authenticated, service_role;

-- Runs under the same cycle/plan/event locks and transaction as submission.
-- Earlier submitted snapshots are never read from mutable drafts.
create function private.calendar_materialize_submission(p_submission uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_submission public.calendar_event_submissions; v_candidate record;
  v_existing public.calendar_event_occurrences; v_occurrence uuid; v_snapshot uuid;
  v_start timestamptz; v_end timestamptz; v_occupancy_start timestamptz; v_occupancy_end timestamptz;
  v_count integer; v_existing_count integer; v_seen text[] := '{}'; v_new boolean;
begin
  select * into v_submission from public.calendar_event_submissions where id = p_submission;
  if not found then raise exception 'Calendar submission unavailable.' using errcode = 'RAR09'; end if;
  perform 1 from public.calendar_events where id = v_submission.event_id for update;
  select count(*) into v_count from private.calendar_submission_candidates(p_submission);
  if v_count = 0 then raise exception 'The calendar schedule has no occurrences.' using errcode = 'RAR09'; end if;
  if v_count > 1200 then raise exception 'A calendar event may have at most 1200 occurrences.' using errcode = 'RAR09'; end if;
  select count(*) into v_existing_count from public.calendar_submission_occurrences where submission_id = p_submission;
  if v_existing_count > 0 then
    if v_existing_count <> v_count then raise exception 'Calendar submission materialization is incomplete.' using errcode = 'RAR09'; end if;
    return;
  end if;
  for v_candidate in select * from private.calendar_submission_candidates(p_submission) order by local_start, source_key loop
    if v_candidate.local_start is null or v_candidate.local_end is null or v_candidate.local_end <= v_candidate.local_start then
      raise exception 'Calendar event times are incomplete or invalid.' using errcode = 'RAR09';
    end if;
    v_start := private.calendar_local_instant(v_candidate.local_start, v_submission.timezone);
    v_end := private.calendar_local_instant(v_candidate.local_end, v_submission.timezone);
    if v_end <= v_start then raise exception 'Calendar event times are invalid.' using errcode = 'RAR09'; end if;
    v_occupancy_start := v_start - make_interval(mins => v_submission.setup_minutes);
    v_occupancy_end := v_end + make_interval(mins => v_submission.cleanup_minutes);
    v_seen := array_append(v_seen, v_candidate.source_key);
    select * into v_existing from public.calendar_event_occurrences
      where event_id = v_submission.event_id and source_key = v_candidate.source_key and status = 'scheduled' for update;
    v_new := not found;
    if found then
      if v_existing.start_at <= now() and (v_existing.local_start is distinct from v_candidate.local_start
        or v_existing.local_end is distinct from v_candidate.local_end or v_existing.timezone is distinct from v_submission.timezone
        or v_existing.occupancy_start is distinct from v_occupancy_start or v_existing.occupancy_end is distinct from v_occupancy_end
        or v_existing.all_day is distinct from v_submission.all_day) then
        raise exception 'Past calendar occurrences cannot be changed.' using errcode = 'RAR09';
      end if;
      v_occurrence := v_existing.id;
      if v_existing.start_at > now() then
        update public.calendar_event_occurrences set schedule_revision = v_submission.plan_revision,
          local_start = v_candidate.local_start, local_end = v_candidate.local_end, timezone = v_submission.timezone,
          all_day = v_submission.all_day, start_at = v_start, end_at = v_end,
          occupancy_start = v_occupancy_start, occupancy_end = v_occupancy_end, updated_at = now()
          where id = v_occurrence;
      end if;
    else
      insert into public.calendar_event_occurrences(event_id, source_key, source_date_id, schedule_revision,
        local_start, local_end, timezone, all_day, start_at, end_at, occupancy_start, occupancy_end)
      values (v_submission.event_id, v_candidate.source_key, v_candidate.source_date_id, v_submission.plan_revision,
        v_candidate.local_start, v_candidate.local_end, v_submission.timezone, v_submission.all_day,
        v_start, v_end, v_occupancy_start, v_occupancy_end) returning id into v_occurrence;
    end if;
    -- Past occurrence requests are history; only future, unapproved requests are recomputed.
    if v_new or v_start > now() then
      if exists (select 1 from public.calendar_occurrence_room_exceptions x join public.rooms r on r.id = x.room_id
          where x.occurrence_id = v_occurrence and x.operation = 'add' and not r.active)
        or exists (select 1 from public.calendar_occurrence_resource_exceptions x join public.calendar_resources r on r.id = x.resource_id
          where x.occurrence_id = v_occurrence and x.operation in ('add', 'quantity_override') and not r.active) then
        raise exception 'An event contains an unavailable room, resource, or ministry.' using errcode = 'RAR09';
      end if;
      if exists (select 1 from public.calendar_occurrence_resource_exceptions x
        where x.occurrence_id = v_occurrence and x.operation = 'quantity_override'
          and not exists (select 1 from public.calendar_submission_resource_templates t
            where t.submission_id = p_submission and t.resource_id = x.resource_id)) then
        raise exception 'An occurrence resource override needs an event-wide default.' using errcode = 'RAR09';
      end if;
      delete from public.calendar_event_room_requests where occurrence_id = v_occurrence;
      delete from public.calendar_event_resource_requests where occurrence_id = v_occurrence;
      insert into public.calendar_event_room_requests(occurrence_id, room_id, origin)
        select v_occurrence, t.room_id, case when x.operation = 'add' then 'exception' else 'template' end
        from public.calendar_submission_room_templates t
        left join public.calendar_occurrence_room_exceptions x on x.occurrence_id = v_occurrence and x.room_id = t.room_id
        where t.submission_id = p_submission and coalesce(x.operation, '') <> 'remove'
        union all
        select v_occurrence, x.room_id, 'exception' from public.calendar_occurrence_room_exceptions x
        where x.occurrence_id = v_occurrence and x.operation = 'add'
          and not exists (select 1 from public.calendar_submission_room_templates t where t.submission_id = p_submission and t.room_id = x.room_id);
      insert into public.calendar_event_resource_requests(occurrence_id, resource_id, origin, quantity_requested, notes)
        select v_occurrence, t.resource_id, case when x.operation is null then 'template' else 'exception' end,
          case when x.operation in ('add', 'quantity_override') then x.quantity_requested else t.quantity_requested end,
          case when x.operation in ('add', 'quantity_override') then x.notes else t.notes end
        from public.calendar_submission_resource_templates t
        left join public.calendar_occurrence_resource_exceptions x on x.occurrence_id = v_occurrence and x.resource_id = t.resource_id
        where t.submission_id = p_submission and coalesce(x.operation, '') <> 'remove'
        union all
        select v_occurrence, x.resource_id, 'exception', x.quantity_requested, x.notes
        from public.calendar_occurrence_resource_exceptions x where x.occurrence_id = v_occurrence and x.operation = 'add'
          and not exists (select 1 from public.calendar_submission_resource_templates t where t.submission_id = p_submission and t.resource_id = x.resource_id);
    end if;
    insert into public.calendar_submission_occurrences(submission_id, occurrence_id, logical_occurrence_id, source_date_id,
      local_start, local_end, timezone, all_day, start_at, end_at, occupancy_start, occupancy_end)
    select p_submission, o.id, o.logical_occurrence_id, o.source_date_id, o.local_start, o.local_end,
      o.timezone, o.all_day, o.start_at, o.end_at, o.occupancy_start, o.occupancy_end
    from public.calendar_event_occurrences o where o.id = v_occurrence returning id into v_snapshot;
    insert into public.calendar_submission_room_requests select v_snapshot, room_id, origin from public.calendar_event_room_requests where occurrence_id = v_occurrence;
    insert into public.calendar_submission_resource_requests select v_snapshot, resource_id, origin, quantity_requested, notes from public.calendar_event_resource_requests where occurrence_id = v_occurrence;
  end loop;
  update public.calendar_event_occurrences set status = 'superseded', superseded_at = now(), updated_at = now()
    where event_id = v_submission.event_id and status = 'scheduled' and start_at > now() and not (source_key = any(v_seen));
end;
$$;

create function private.calendar_materialize_plan_after_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_submission uuid;
begin
  if new.submission_status <> 'submitted' or new.submission_revision = old.submission_revision then return new; end if;
  for v_submission in select s.id from public.calendar_event_submissions s join public.calendar_events e on e.id = s.event_id
    where e.plan_id = new.id and s.plan_revision = new.submission_revision order by e.id loop
    perform private.calendar_materialize_submission(v_submission);
  end loop;
  update public.calendar_event_occurrences o set status = 'superseded', superseded_at = now(), updated_at = now()
    from public.calendar_events e where o.event_id = e.id and e.plan_id = new.id and e.deleted_at is not null
      and o.status = 'scheduled' and o.start_at > now();
  return new;
end;
$$;
create trigger calendar_materialize_plan after update of submission_status, submission_revision on public.ministry_calendar_plans
  for each row execute function private.calendar_materialize_plan_after_submission();
revoke execute on function private.calendar_materialize_submission(uuid), private.calendar_materialize_plan_after_submission()
  from public, anon, authenticated, service_role;

-- A separate mutable projection lets planners edit individual dates before the
-- first submission. Immutable submission rows continue to be the staff view.
create table private.calendar_draft_projection_versions (
  event_id uuid primary key references public.calendar_events(id),
  draft_version integer not null
);
revoke all on private.calendar_draft_projection_versions from public, anon, authenticated, service_role;

create function private.calendar_draft_candidates(p_event uuid)
returns table(source_key text, source_date_id uuid, local_start timestamp without time zone, local_end timestamp without time zone)
language sql stable set search_path = '' as $$
  select 'single', null::uuid, s.start_date + coalesce(s.start_time, time '00:00'),
    case when s.all_day then (s.end_date + 1)::timestamp else s.end_date + s.end_time end
  from public.calendar_event_schedules s where s.event_id = p_event and s.kind in ('one_time', 'multi_day')
  union all
  select 'date:' || d.id::text, d.id, d.local_date + coalesce(d.local_start_time, time '00:00'),
    case when s.all_day then (d.local_end_date + 1)::timestamp else d.local_end_date + d.local_end_time end
  from public.calendar_event_schedules s join public.calendar_schedule_dates d on d.event_id = s.event_id
  where s.event_id = p_event and s.kind = 'specific_dates' and d.removed_at is null
  union all
  select 'recurring:' || to_char(g.day, 'YYYY-MM-DD'), null::uuid,
    g.day::date + coalesce(s.start_time, time '00:00'),
    case when s.all_day then (g.day::date + 1)::timestamp else g.day::date + s.end_time end
  from public.calendar_event_schedules s
    cross join lateral generate_series(s.start_date::timestamp, s.end_date::timestamp, interval '1 day') g(day)
  where s.event_id = p_event and s.kind = 'recurring'
    and private.calendar_date_matches(jsonb_populate_record(null::public.calendar_event_submissions, to_jsonb(s)), g.day::date);
$$;

create function private.calendar_materialize_draft(p_event uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event public.calendar_events; v_schedule public.calendar_event_schedules; c record;
  v_existing public.calendar_event_occurrences; v_id uuid; v_start timestamptz; v_end timestamptz;
  v_count integer; v_seen text[] := '{}';
begin
  select * into v_event from public.calendar_events where id = p_event and deleted_at is null for update;
  select * into v_schedule from public.calendar_event_schedules where event_id = p_event;
  if v_event.id is null or v_schedule.event_id is null or v_schedule.start_date is null or v_schedule.end_date is null
    or (not v_schedule.all_day and v_schedule.kind <> 'specific_dates' and (v_schedule.start_time is null or v_schedule.end_time is null)) then return; end if;
  if not v_schedule.all_day and v_schedule.kind = 'specific_dates' and exists (
    select 1 from public.calendar_schedule_dates d where d.event_id = p_event and d.removed_at is null
      and (d.local_start_time is null or d.local_end_time is null)) then return; end if;
  select count(*) into v_count from private.calendar_draft_candidates(p_event);
  if v_count = 0 then return; end if;
  if v_count > 1200 then raise exception 'A calendar event may have at most 1200 occurrences.' using errcode = 'RAR09'; end if;
  if exists (select 1 from private.calendar_draft_candidates(p_event) candidate where candidate.local_start is null or candidate.local_end is null or candidate.local_end <= candidate.local_start) then return; end if;
  for c in select * from private.calendar_draft_candidates(p_event) order by local_start, source_key loop
    v_start := private.calendar_local_instant(c.local_start, v_schedule.timezone);
    v_end := private.calendar_local_instant(c.local_end, v_schedule.timezone);
    if v_end <= v_start then raise exception 'Calendar event times are invalid.' using errcode = 'RAR09'; end if;
    v_seen := array_append(v_seen, c.source_key);
    select * into v_existing from public.calendar_event_occurrences
      where event_id = p_event and source_key = c.source_key and status = 'scheduled' for update;
    if found then
      v_id := v_existing.id;
      if v_existing.start_at <= now() then continue; end if;
      update public.calendar_event_occurrences set schedule_revision = v_event.draft_version,
        local_start = c.local_start, local_end = c.local_end, timezone = v_schedule.timezone, all_day = v_schedule.all_day,
        start_at = v_start, end_at = v_end, occupancy_start = v_start - make_interval(mins => v_event.setup_minutes),
        occupancy_end = v_end + make_interval(mins => v_event.cleanup_minutes), updated_at = now() where id = v_id;
    else
      insert into public.calendar_event_occurrences(event_id, source_key, source_date_id, schedule_revision,
        local_start, local_end, timezone, all_day, start_at, end_at, occupancy_start, occupancy_end)
      values (p_event, c.source_key, c.source_date_id, v_event.draft_version, c.local_start, c.local_end, v_schedule.timezone,
        v_schedule.all_day, v_start, v_end, v_start - make_interval(mins => v_event.setup_minutes),
        v_end + make_interval(mins => v_event.cleanup_minutes)) returning id into v_id;
    end if;
    delete from public.calendar_event_room_requests where occurrence_id = v_id;
    delete from public.calendar_event_resource_requests where occurrence_id = v_id;
    insert into public.calendar_event_room_requests(occurrence_id, room_id, origin)
      select v_id, t.room_id, case when x.operation = 'add' then 'exception' else 'template' end
      from public.calendar_event_room_templates t left join public.calendar_occurrence_room_exceptions x on x.occurrence_id = v_id and x.room_id = t.room_id
      where t.event_id = p_event and coalesce(x.operation, '') <> 'remove'
      union all select v_id, x.room_id, 'exception' from public.calendar_occurrence_room_exceptions x
      where x.occurrence_id = v_id and x.operation = 'add' and not exists (select 1 from public.calendar_event_room_templates t where t.event_id = p_event and t.room_id = x.room_id);
    insert into public.calendar_event_resource_requests(occurrence_id, resource_id, origin, quantity_requested, notes)
      select v_id, t.resource_id, case when x.operation is null then 'template' else 'exception' end,
        case when x.operation in ('add', 'quantity_override') then x.quantity_requested else t.quantity_requested end,
        case when x.operation in ('add', 'quantity_override') then x.notes else t.notes end
      from public.calendar_event_resource_templates t left join public.calendar_occurrence_resource_exceptions x on x.occurrence_id = v_id and x.resource_id = t.resource_id
      where t.event_id = p_event and coalesce(x.operation, '') <> 'remove'
      union all select v_id, x.resource_id, 'exception', x.quantity_requested, x.notes from public.calendar_occurrence_resource_exceptions x
      where x.occurrence_id = v_id and x.operation = 'add' and not exists (select 1 from public.calendar_event_resource_templates t where t.event_id = p_event and t.resource_id = x.resource_id);
  end loop;
  update public.calendar_event_occurrences set status = 'superseded', superseded_at = now(), updated_at = now()
    where event_id = p_event and status = 'scheduled' and start_at > now() and not (source_key = any(v_seen));
  insert into private.calendar_draft_projection_versions(event_id, draft_version) values (p_event, v_event.draft_version)
    on conflict (event_id) do update set draft_version = excluded.draft_version;
exception when sqlstate 'RAR09' then
  -- Incomplete or DST-invalid drafts remain editable; submission still fails closed.
  if sqlerrm in ('A calendar event uses a nonexistent local time.', 'Calendar event times are invalid.') then return; end if;
  raise;
end;
$$;
revoke execute on function private.calendar_draft_candidates(uuid), private.calendar_materialize_draft(uuid) from public, anon, authenticated, service_role;

alter function public.calendar_save_event_draft(uuid, text, uuid, jsonb) set schema private;
revoke execute on function private.calendar_save_event_draft(uuid, text, uuid, jsonb) from public, anon, authenticated, service_role;
create function public.calendar_save_event_draft(p_plan_id uuid, p_session_hash text, p_event_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  v_event := private.calendar_save_event_draft(p_plan_id, p_session_hash, p_event_id, p_data);
  perform private.calendar_materialize_draft(v_event);
  return v_event;
end;
$$;
revoke execute on function public.calendar_save_event_draft(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.calendar_save_event_draft(uuid, text, uuid, jsonb) to service_role;

-- Exception edits apply to the next submitted revision. The previous immutable
-- submission continues to represent the proposal while changes are in progress.
create function public.calendar_set_occurrence_exception(p_plan_id uuid, p_session_hash text, p_occurrence_id uuid,
  p_expected_version integer, p_kind text, p_item_id uuid, p_operation text, p_quantity integer, p_notes text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_plan public.ministry_calendar_plans; v_event public.calendar_events; v_occ public.calendar_event_occurrences;
begin
  v_context := private.calendar_require_planner(p_plan_id, p_session_hash, true);
  select * into v_plan from public.ministry_calendar_plans where id = (v_context->>'plan_id')::uuid;
  if v_plan.submission_status not in ('draft', 'changes_requested') then raise exception 'Plan is not editable.' using errcode = 'RAR09'; end if;
  select e.* into v_event from public.calendar_events e join public.calendar_event_occurrences o on o.event_id = e.id
    where o.id = p_occurrence_id and e.plan_id = v_plan.id and e.deleted_at is null for update of e;
  if not found or v_event.status not in ('draft', 'changes_requested') or v_event.draft_version is distinct from p_expected_version then
    raise exception 'Event changed or is not editable.' using errcode = 'RAR09';
  end if;
  if not exists (select 1 from private.calendar_draft_projection_versions v where v.event_id = v_event.id and v.draft_version = v_event.draft_version) then
    raise exception 'Complete the event schedule before changing individual dates.' using errcode = 'RAR09';
  end if;
  select * into v_occ from public.calendar_event_occurrences where id = p_occurrence_id for update;
  if not found or v_occ.status <> 'scheduled' or v_occ.start_at <= now() then
    raise exception 'Occurrence is not editable.' using errcode = 'RAR09';
  end if;
  if char_length(coalesce(p_notes, '')) > 1000 then raise exception 'Exception notes are too long.' using errcode = 'RAR09'; end if;
  if p_kind = 'room' then
    if p_operation not in ('add', 'remove', 'reset') or not exists (select 1 from public.rooms where id = p_item_id and (active or p_operation <> 'add')) then
      raise exception 'Room exception is invalid.' using errcode = 'RAR09';
    end if;
    if p_operation = 'reset' then
      delete from public.calendar_occurrence_room_exceptions where occurrence_id = p_occurrence_id and room_id = p_item_id;
    else
      insert into public.calendar_occurrence_room_exceptions(occurrence_id, room_id, operation, reason)
        values (p_occurrence_id, p_item_id, p_operation, nullif(p_notes, ''))
        on conflict (occurrence_id, room_id) do update set operation = excluded.operation, reason = excluded.reason;
    end if;
  elsif p_kind = 'resource' then
    if p_operation not in ('add', 'remove', 'quantity_override', 'reset')
      or not exists (select 1 from public.calendar_resources where id = p_item_id and (active or p_operation in ('remove', 'reset')))
      or (p_operation in ('add', 'quantity_override') and (p_quantity is null or p_quantity < 1 or p_quantity > 100000))
      or (p_operation = 'quantity_override' and not exists (select 1 from public.calendar_event_resource_templates where event_id = v_event.id and resource_id = p_item_id)) then
      raise exception 'Resource exception is invalid.' using errcode = 'RAR09';
    end if;
    if p_operation = 'reset' then
      delete from public.calendar_occurrence_resource_exceptions where occurrence_id = p_occurrence_id and resource_id = p_item_id;
    else
      insert into public.calendar_occurrence_resource_exceptions(occurrence_id, resource_id, operation, quantity_requested, notes)
        values (p_occurrence_id, p_item_id, p_operation, case when p_operation = 'remove' then null else p_quantity end, nullif(p_notes, ''))
        on conflict (occurrence_id, resource_id) do update set operation = excluded.operation, quantity_requested = excluded.quantity_requested, notes = excluded.notes;
    end if;
  else raise exception 'Exception type is invalid.' using errcode = 'RAR09'; end if;
  update public.calendar_events set draft_version = draft_version + 1, updated_at = now() where id = v_event.id returning draft_version into p_expected_version;
  perform private.calendar_materialize_draft(v_event.id);
  insert into public.audit_logs(actor_kind, action, entity_type, entity_id, metadata)
    values ('guest', 'calendar_occurrence.exception_changed', 'calendar_occurrence', p_occurrence_id::text,
      jsonb_build_object('grant_id', v_context->>'grant_id', 'kind', p_kind, 'item_id', p_item_id, 'operation', p_operation));
  return p_expected_version;
end;
$$;
revoke execute on function public.calendar_set_occurrence_exception(uuid, text, uuid, integer, text, uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.calendar_set_occurrence_exception(uuid, text, uuid, integer, text, uuid, text, integer, text)
  to service_role;

create function public.calendar_planner_occurrences(p_plan_id uuid, p_session_hash text, p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_revision integer; v_status text;
begin
  v_context := private.calendar_require_planner(p_plan_id, p_session_hash, true);
  if not exists (select 1 from public.calendar_events where id = p_event_id and plan_id = (v_context->>'plan_id')::uuid and deleted_at is null) then
    raise exception 'Event unavailable.' using errcode = 'RAR09';
  end if;
  select submission_revision, submission_status into v_revision, v_status from public.ministry_calendar_plans where id = (v_context->>'plan_id')::uuid;
  if v_status in ('draft', 'changes_requested') then
    if not exists (select 1 from private.calendar_draft_projection_versions v join public.calendar_events e on e.id = v.event_id
      where e.id = p_event_id and v.draft_version = e.draft_version) then return '[]'::jsonb; end if;
    return (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'logical_id', o.logical_occurrence_id,
      'local_start', o.local_start, 'local_end', o.local_end, 'timezone', o.timezone, 'all_day', o.all_day,
      'editable', o.start_at > now(), 'occupancy_start', o.occupancy_start, 'occupancy_end', o.occupancy_end,
      'rooms', (select coalesce(jsonb_agg(jsonb_build_object('id', r.room_id, 'origin', r.origin)), '[]'::jsonb) from public.calendar_event_room_requests r where r.occurrence_id = o.id),
      'resources', (select coalesce(jsonb_agg(jsonb_build_object('id', r.resource_id, 'origin', r.origin, 'quantity', r.quantity_requested, 'notes', r.notes)), '[]'::jsonb) from public.calendar_event_resource_requests r where r.occurrence_id = o.id),
      'room_exceptions', (select coalesce(jsonb_agg(jsonb_build_object('id', x.room_id, 'name', r.name, 'active', r.active, 'operation', x.operation, 'notes', x.reason)), '[]'::jsonb)
        from public.calendar_occurrence_room_exceptions x join public.rooms r on r.id = x.room_id where x.occurrence_id = o.id),
      'resource_exceptions', (select coalesce(jsonb_agg(jsonb_build_object('id', x.resource_id, 'name', r.name, 'active', r.active, 'operation', x.operation, 'quantity', x.quantity_requested, 'notes', x.notes)), '[]'::jsonb)
        from public.calendar_occurrence_resource_exceptions x join public.calendar_resources r on r.id = x.resource_id where x.occurrence_id = o.id)
    ) order by o.local_start, o.id), '[]'::jsonb) from public.calendar_event_occurrences o where o.event_id = p_event_id and o.status = 'scheduled');
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'logical_id', so.logical_occurrence_id,
    'local_start', so.local_start, 'local_end', so.local_end, 'timezone', so.timezone, 'all_day', so.all_day,
    'editable', o.status = 'scheduled' and o.start_at > now(),
    'occupancy_start', so.occupancy_start, 'occupancy_end', so.occupancy_end,
    'rooms', (select coalesce(jsonb_agg(jsonb_build_object('id', r.room_id, 'origin', r.origin)), '[]'::jsonb) from public.calendar_submission_room_requests r where r.submission_occurrence_id = so.id),
    'resources', (select coalesce(jsonb_agg(jsonb_build_object('id', r.resource_id, 'origin', r.origin, 'quantity', r.quantity_requested, 'notes', r.notes)), '[]'::jsonb) from public.calendar_submission_resource_requests r where r.submission_occurrence_id = so.id),
    'room_exceptions', (select coalesce(jsonb_agg(jsonb_build_object('id', x.room_id, 'name', r.name, 'active', r.active, 'operation', x.operation, 'notes', x.reason)), '[]'::jsonb)
      from public.calendar_occurrence_room_exceptions x join public.rooms r on r.id = x.room_id where x.occurrence_id = o.id),
    'resource_exceptions', (select coalesce(jsonb_agg(jsonb_build_object('id', x.resource_id, 'name', r.name, 'active', r.active, 'operation', x.operation, 'quantity', x.quantity_requested, 'notes', x.notes)), '[]'::jsonb)
      from public.calendar_occurrence_resource_exceptions x join public.calendar_resources r on r.id = x.resource_id where x.occurrence_id = o.id)
  ) order by so.local_start, o.id), '[]'::jsonb)
    from public.calendar_submission_occurrences so
    join public.calendar_event_submissions s on s.id = so.submission_id
    join public.calendar_event_occurrences o on o.id = so.occurrence_id
    where s.event_id = p_event_id and s.plan_revision = v_revision);
end;
$$;
revoke execute on function public.calendar_planner_occurrences(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.calendar_planner_occurrences(uuid, text, uuid) to service_role;

create function public.calendar_staff_occurrences(p_submission_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if not exists (select 1 from public.calendar_event_submissions where id = p_submission_id) then
    raise exception 'Calendar submission unavailable.' using errcode = 'RAR09';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'logical_id', o.logical_occurrence_id,
    'local_start', o.local_start, 'local_end', o.local_end, 'timezone', o.timezone, 'all_day', o.all_day,
    'start_at', o.start_at, 'end_at', o.end_at, 'occupancy_start', o.occupancy_start, 'occupancy_end', o.occupancy_end,
    'rooms', (select coalesce(jsonb_agg(jsonb_build_object('name', rm.name, 'origin', r.origin) order by rm.name), '[]'::jsonb)
      from public.calendar_submission_room_requests r join public.rooms rm on rm.id = r.room_id where r.submission_occurrence_id = o.id),
    'resources', (select coalesce(jsonb_agg(jsonb_build_object('name', rs.name, 'origin', r.origin, 'quantity', r.quantity_requested, 'notes', r.notes) order by rs.name), '[]'::jsonb)
      from public.calendar_submission_resource_requests r join public.calendar_resources rs on rs.id = r.resource_id where r.submission_occurrence_id = o.id)
  ) order by o.local_start, o.id), '[]'::jsonb) from public.calendar_submission_occurrences o where o.submission_id = p_submission_id);
end;
$$;
revoke execute on function public.calendar_staff_occurrences(uuid) from public, anon, service_role;
grant execute on function public.calendar_staff_occurrences(uuid) to authenticated;
