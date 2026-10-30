-- Phase 2: private planning, draft schedules and immutable submissions.
-- This migration creates no reservations, occurrences or allocations.

alter table public.ministry_calendar_plans
  add column submission_status text not null default 'draft'
    check (submission_status in ('draft', 'submitted', 'changes_requested')),
  add column submission_revision integer not null default 0 check (submission_revision >= 0),
  add column submitted_at timestamptz,
  add column requester_message text check (char_length(requester_message) <= 2000),
  add column changes_requested_reason text check (char_length(changes_requested_reason) <= 2000);

-- Disabled by default. Activation and the linked published legal documents require
-- owner/legal approval in a separately reviewed change before portal release.
create table private.calendar_planner_policies (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  privacy_version text,
  terms_version text,
  check (not enabled or (privacy_version is not null and terms_version is not null
    and char_length(btrim(privacy_version)) > 0 and char_length(btrim(terms_version)) > 0))
);
insert into private.calendar_planner_policies(id) values (true);
alter table private.calendar_planner_policies enable row level security;
revoke all on private.calendar_planner_policies from public, anon, authenticated, service_role;

create table public.calendar_planner_acceptances (
  grant_id uuid not null references public.calendar_plan_access(id),
  privacy_version text not null,
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  primary key (grant_id, privacy_version, terms_version)
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ministry_calendar_plans(id),
  reference_code text not null unique default ('CAL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  public_description text check (char_length(public_description) <= 5000),
  category text not null default 'other' check (char_length(btrim(category)) between 1 and 100),
  scope text not null check (scope in ('ministry', 'church_wide', 'administrative', 'community')),
  protection text not null default 'normal' check (protection in ('normal', 'exclusive')),
  visibility text not null check (visibility in ('public', 'internal')),
  location_type text not null check (location_type in ('church', 'offsite', 'virtual', 'tbd')),
  offsite_location text check (char_length(offsite_location) <= 500),
  virtual_url text check (char_length(virtual_url) <= 2000 and (virtual_url is null or virtual_url ~ '^https?://')),
  estimated_attendance integer not null check (estimated_attendance between 1 and 100000),
  food_drinks_planned boolean not null default false,
  setup_minutes integer not null default 0 check (setup_minutes between 0 and 1440),
  cleanup_minutes integer not null default 0 check (cleanup_minutes between 0 and 1440),
  public_contact_name text check (char_length(public_contact_name) <= 120),
  public_contact_email text check (public_contact_email is null or private.is_valid_email(public_contact_email)),
  requester_notes text check (char_length(requester_notes) <= 5000),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'changes_requested')),
  revision integer not null default 0 check (revision >= 0),
  draft_version integer not null default 1 check (draft_version > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calendar_events_plan_idx on public.calendar_events(plan_id, created_at) where deleted_at is null;

create table public.calendar_event_schedules (
  event_id uuid primary key references public.calendar_events(id),
  kind text not null check (kind in ('one_time', 'multi_day', 'specific_dates', 'recurring')),
  timezone text not null check (private.is_valid_timezone(timezone)),
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  frequency text check (frequency in ('daily', 'weekdays', 'weekly', 'monthly_day', 'monthly_nth_weekday', 'yearly_date', 'yearly_nth_weekday')),
  interval_count integer check (interval_count between 1 and 365),
  weekdays integer[],
  weekday integer check (weekday between 0 and 6),
  month_ordinals integer[],
  month_ordinal integer check (month_ordinal in (-1, 1, 2, 3, 4)),
  day_of_month integer check (day_of_month between 1 and 31),
  month_of_year integer check (month_of_year between 1 and 12),
  check (isfinite(start_date) and isfinite(end_date) and end_date >= start_date),
  check (end_time > start_time),
  check ((kind = 'recurring') = (frequency is not null)),
  check (kind <> 'one_time' or start_date = end_date),
  check (weekdays is null or (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6])),
  check (month_ordinals is null or (cardinality(month_ordinals) between 1 and 5 and month_ordinals <@ array[-1,1,2,3,4]))
);

create table public.calendar_schedule_dates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events(id),
  local_date date not null check (isfinite(local_date)),
  unique (event_id, local_date)
);
create table public.calendar_event_ministries (
  event_id uuid not null references public.calendar_events(id),
  ministry_id uuid not null references public.ministries(id),
  primary key (event_id, ministry_id)
);
create table public.calendar_event_room_templates (
  event_id uuid not null references public.calendar_events(id),
  room_id uuid not null references public.rooms(id),
  primary key (event_id, room_id)
);
create table public.calendar_event_resource_templates (
  event_id uuid not null references public.calendar_events(id),
  resource_id uuid not null references public.calendar_resources(id),
  quantity_requested integer not null check (quantity_requested between 1 and 100000),
  notes text check (char_length(notes) <= 1000),
  primary key (event_id, resource_id)
);

-- A submission stores typed event/schedule facts and normalized child snapshots.
create table public.calendar_event_submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events(id),
  plan_revision integer not null,
  submitted_by_grant uuid not null references public.calendar_plan_access(id),
  submitted_at timestamptz not null default now(),
  title text not null, description text, public_description text, category text not null,
  scope text not null, protection text not null, visibility text not null,
  location_type text not null, offsite_location text, virtual_url text,
  estimated_attendance integer not null, food_drinks_planned boolean not null,
  setup_minutes integer not null, cleanup_minutes integer not null,
  public_contact_name text, public_contact_email text, requester_notes text,
  schedule_kind text not null, timezone text not null, start_date date not null, end_date date not null,
  start_time time not null, end_time time not null, frequency text, interval_count integer,
  weekdays integer[], weekday integer, month_ordinals integer[], month_ordinal integer,
  day_of_month integer, month_of_year integer,
  unique (event_id, plan_revision)
);
create table public.calendar_plan_submissions (
  plan_id uuid not null references public.ministry_calendar_plans(id),
  revision integer not null check (revision > 0),
  submitted_by_grant uuid not null references public.calendar_plan_access(id),
  submitted_at timestamptz not null default now(),
  message text check (char_length(message) <= 2000),
  primary key (plan_id, revision)
);
create table public.calendar_submission_dates (
  submission_id uuid not null references public.calendar_event_submissions(id),
  local_date date not null, primary key (submission_id, local_date)
);
create table public.calendar_submission_ministries (
  submission_id uuid not null references public.calendar_event_submissions(id),
  ministry_id uuid not null references public.ministries(id), primary key (submission_id, ministry_id)
);
create table public.calendar_submission_room_templates (
  submission_id uuid not null references public.calendar_event_submissions(id),
  room_id uuid not null references public.rooms(id), primary key (submission_id, room_id)
);
create table public.calendar_submission_resource_templates (
  submission_id uuid not null references public.calendar_event_submissions(id),
  resource_id uuid not null references public.calendar_resources(id), quantity_requested integer not null,
  notes text, primary key (submission_id, resource_id)
);

create function private.calendar_snapshot_immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Calendar submissions are immutable.' using errcode = 'RAR09'; end;
$$;
create trigger calendar_submission_immutable before update or delete on public.calendar_event_submissions for each row execute function private.calendar_snapshot_immutable();
create trigger calendar_plan_submission_immutable before update or delete on public.calendar_plan_submissions for each row execute function private.calendar_snapshot_immutable();
create trigger calendar_submission_dates_immutable before update or delete on public.calendar_submission_dates for each row execute function private.calendar_snapshot_immutable();
create trigger calendar_submission_ministries_immutable before update or delete on public.calendar_submission_ministries for each row execute function private.calendar_snapshot_immutable();
create trigger calendar_submission_rooms_immutable before update or delete on public.calendar_submission_room_templates for each row execute function private.calendar_snapshot_immutable();
create trigger calendar_submission_resources_immutable before update or delete on public.calendar_submission_resource_templates for each row execute function private.calendar_snapshot_immutable();

alter table public.calendar_planner_acceptances enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_event_schedules enable row level security;
alter table public.calendar_schedule_dates enable row level security;
alter table public.calendar_event_ministries enable row level security;
alter table public.calendar_event_room_templates enable row level security;
alter table public.calendar_event_resource_templates enable row level security;
alter table public.calendar_event_submissions enable row level security;
alter table public.calendar_plan_submissions enable row level security;
alter table public.calendar_submission_dates enable row level security;
alter table public.calendar_submission_ministries enable row level security;
alter table public.calendar_submission_room_templates enable row level security;
alter table public.calendar_submission_resource_templates enable row level security;
revoke all on public.calendar_planner_acceptances, public.calendar_events, public.calendar_event_schedules,
  public.calendar_schedule_dates, public.calendar_event_ministries, public.calendar_event_room_templates,
  public.calendar_event_resource_templates, public.calendar_event_submissions, public.calendar_plan_submissions, public.calendar_submission_dates,
  public.calendar_submission_ministries, public.calendar_submission_room_templates, public.calendar_submission_resource_templates
  from public, anon, authenticated, service_role;
revoke execute on function private.calendar_snapshot_immutable() from public, anon, authenticated, service_role;

-- Lock in the same cycle -> plan -> grant -> session order as the Phase 1
-- revocation and removal paths. All planner mutations must recheck here.
create function private.calendar_require_planner(p_reference uuid, p_session_hash text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cycle public.calendar_cycles; v_plan public.ministry_calendar_plans;
  v_grant public.calendar_plan_access; v_session public.calendar_plan_sessions;
  v_policy private.calendar_planner_policies;
begin
  if not private.is_calendar_service() or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Planning access unavailable.' using errcode = 'RAR09';
  end if;
  select c.* into v_cycle from public.calendar_cycles c
    join public.ministry_calendar_plans p on p.cycle_id = c.id
    join public.calendar_plan_access a on a.plan_id = p.id
    join public.calendar_plan_sessions s on s.grant_id = a.id
    where p.reference_code = p_reference and s.session_hash = decode(p_session_hash, 'hex') for update of c;
  if not found or v_cycle.status <> 'open' or now() < v_cycle.submission_opens_at
    or now() >= v_cycle.submission_deadline then
    raise exception 'Planning access unavailable.' using errcode = 'RAR09';
  end if;
  select * into v_plan from public.ministry_calendar_plans where reference_code = p_reference for update;
  if not found or not v_plan.active then raise exception 'Planning access unavailable.' using errcode = 'RAR09'; end if;
  select a.* into v_grant from public.calendar_plan_access a join public.calendar_plan_sessions s on s.grant_id = a.id
    where a.plan_id = v_plan.id and s.session_hash = decode(p_session_hash, 'hex') for update of a;
  if not found or v_grant.revoked_at is not null or v_grant.expires_at <= now() then
    raise exception 'Planning access unavailable.' using errcode = 'RAR09';
  end if;
  select * into v_session from public.calendar_plan_sessions
    where grant_id = v_grant.id and session_hash = decode(p_session_hash, 'hex') for update;
  if not found or v_session.revoked_at is not null or v_session.expires_at <= now()
    or v_session.grant_version <> v_grant.version then
    raise exception 'Planning access unavailable.' using errcode = 'RAR09';
  end if;
  if p_consent then
    select * into v_policy from private.calendar_planner_policies where id for share;
    if not found or not v_policy.enabled or not exists (
      select 1 from public.calendar_planner_acceptances where grant_id = v_grant.id
        and privacy_version = v_policy.privacy_version and terms_version = v_policy.terms_version
    ) then raise exception 'Current planning terms must be accepted.' using errcode = 'RAR09'; end if;
  end if;
  return jsonb_build_object('plan_id', v_plan.id, 'grant_id', v_grant.id, 'cycle_id', v_cycle.id);
end;
$$;

create function public.calendar_planner_policy_status(p_plan_id uuid, p_session_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_policy private.calendar_planner_policies;
begin
  v_context := private.calendar_require_planner(p_plan_id, p_session_hash, false);
  select * into v_policy from private.calendar_planner_policies where id;
  return jsonb_build_object('enabled', coalesce(v_policy.enabled, false),
    'privacy_version', v_policy.privacy_version, 'terms_version', v_policy.terms_version,
    'accepted', coalesce(v_policy.enabled, false) and exists (
      select 1 from public.calendar_planner_acceptances where grant_id = (v_context->>'grant_id')::uuid
        and privacy_version = v_policy.privacy_version and terms_version = v_policy.terms_version));
end;
$$;

create function public.calendar_accept_planner_policies(p_plan_id uuid, p_session_hash text,
  p_privacy_version text, p_terms_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_policy private.calendar_planner_policies;
begin
  v_context := private.calendar_require_planner(p_plan_id, p_session_hash, false);
  select * into v_policy from private.calendar_planner_policies where id for share;
  if not found or not v_policy.enabled or p_privacy_version is distinct from v_policy.privacy_version
    or p_terms_version is distinct from v_policy.terms_version then
    raise exception 'Planning terms have changed or are unavailable.' using errcode = 'RAR09';
  end if;
  insert into public.calendar_planner_acceptances(grant_id, privacy_version, terms_version)
    values ((v_context->>'grant_id')::uuid, v_policy.privacy_version, v_policy.terms_version)
    on conflict do nothing;
  if found then
    insert into public.audit_logs(actor_kind, action, entity_type, entity_id, metadata)
      values ('guest', 'calendar_access.accepted', 'calendar_access', v_context->>'grant_id',
        jsonb_build_object('privacy_version', v_policy.privacy_version, 'terms_version', v_policy.terms_version));
  end if;
end;
$$;

create function public.calendar_end_planner_session(p_plan_id uuid, p_session_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_calendar_service() or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Planning access unavailable.' using errcode = 'RAR09';
  end if;
  update public.calendar_plan_sessions s set revoked_at = now()
    from public.calendar_plan_access a, public.ministry_calendar_plans p
    where s.grant_id = a.id and a.plan_id = p.id and p.reference_code = p_plan_id
      and s.session_hash = decode(p_session_hash, 'hex') and s.revoked_at is null;
end;
$$;

revoke execute on function private.calendar_require_planner(uuid, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.calendar_planner_policy_status(uuid, text),
  public.calendar_accept_planner_policies(uuid, text, text, text), public.calendar_end_planner_session(uuid, text)
  from public, anon, authenticated;
grant execute on function public.calendar_planner_policy_status(uuid, text),
  public.calendar_accept_planner_policies(uuid, text, text, text), public.calendar_end_planner_session(uuid, text)
  to service_role;

-- Draft writes never allocate a room or create an operational reservation.
-- JSON is transport only: every persisted field has a typed destination.
create function public.calendar_save_event_draft(p_plan_id uuid, p_session_hash text, p_event_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_context jsonb; v_plan public.ministry_calendar_plans; v_cycle public.calendar_cycles;
  v_event uuid; v_schedule jsonb := p_data->'schedule'; v_timezone text; v_item jsonb;
  v_start date; v_end date; v_kind text; v_frequency text;
begin
  -- Phase 1 cycle edits lock settings before the cycle; keep the same order.
  select timezone into v_timezone from public.app_settings where id for share;
  v_context := private.calendar_require_planner(p_plan_id, p_session_hash, true);
  select * into v_plan from public.ministry_calendar_plans where id = (v_context->>'plan_id')::uuid;
  select * into v_cycle from public.calendar_cycles where id = v_plan.cycle_id;
  if v_plan.submission_status not in ('draft', 'changes_requested') then
    raise exception 'This plan has been submitted.' using errcode = 'RAR09';
  end if;
  if jsonb_typeof(p_data) <> 'object' or jsonb_typeof(v_schedule) <> 'object'
    or jsonb_typeof(coalesce(p_data->'dates', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'rooms', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'resources', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'ministries', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_data->'dates', '[]'::jsonb)) > 1200
    or jsonb_array_length(coalesce(p_data->'rooms', '[]'::jsonb)) > 100
    or jsonb_array_length(coalesce(p_data->'resources', '[]'::jsonb)) > 100
    or jsonb_array_length(coalesce(p_data->'ministries', '[]'::jsonb)) > 100 then
    raise exception 'Invalid event data.' using errcode = 'RAR09';
  end if;
  v_start := nullif(v_schedule->>'start_date', '')::date; v_end := nullif(v_schedule->>'end_date', '')::date;
  v_kind := v_schedule->>'kind'; v_frequency := v_schedule->>'frequency';
  if v_start < v_cycle.start_date or v_end > v_cycle.end_date
    or v_end < v_start or v_schedule->>'timezone' is distinct from v_timezone then
    raise exception 'Schedule dates or timezone are invalid.' using errcode = 'RAR09';
  end if;
  if v_kind <> 'specific_dates' and jsonb_array_length(coalesce(p_data->'dates', '[]'::jsonb)) <> 0 then
    raise exception 'Choose dates for the selected schedule.' using errcode = 'RAR09';
  end if;
  if v_kind = 'recurring' and v_frequency = 'weekly' and
    (select count(*) <> count(distinct value) from jsonb_array_elements_text(v_schedule->'weekdays')) then
    raise exception 'Weekdays must be unique.' using errcode = 'RAR09';
  end if;
  if v_kind = 'recurring' and v_frequency = 'monthly_nth_weekday' and
    (select count(*) <> count(distinct value) from jsonb_array_elements_text(v_schedule->'month_ordinals')) then
    raise exception 'Weeks of the month must be unique.' using errcode = 'RAR09';
  end if;
  if p_event_id is null then
    insert into public.calendar_events(plan_id, title, description, public_description, category, scope, protection, visibility,
      location_type, offsite_location, virtual_url, estimated_attendance, food_drinks_planned, setup_minutes, cleanup_minutes,
      public_contact_name, public_contact_email, requester_notes)
    values (v_plan.id, p_data->>'title', nullif(p_data->>'description', ''), nullif(p_data->>'public_description', ''),
      coalesce(nullif(p_data->>'category', ''), 'other'), p_data->>'scope', coalesce(p_data->>'protection', 'normal'),
      p_data->>'visibility', p_data->>'location_type', nullif(p_data->>'offsite_location', ''), nullif(p_data->>'virtual_url', ''),
      (p_data->>'estimated_attendance')::integer, coalesce((p_data->>'food_drinks_planned')::boolean, false),
      coalesce((p_data->>'setup_minutes')::integer, 0), coalesce((p_data->>'cleanup_minutes')::integer, 0),
      nullif(p_data->>'public_contact_name', ''), nullif(p_data->>'public_contact_email', ''), nullif(p_data->>'requester_notes', '')) returning id into v_event;
  else
    update public.calendar_events set title = p_data->>'title', description = nullif(p_data->>'description', ''),
      public_description = nullif(p_data->>'public_description', ''), category = coalesce(nullif(p_data->>'category', ''), 'other'),
      scope = p_data->>'scope', protection = coalesce(p_data->>'protection', 'normal'), visibility = p_data->>'visibility',
      location_type = p_data->>'location_type', offsite_location = nullif(p_data->>'offsite_location', ''), virtual_url = nullif(p_data->>'virtual_url', ''),
      estimated_attendance = (p_data->>'estimated_attendance')::integer, food_drinks_planned = coalesce((p_data->>'food_drinks_planned')::boolean, false),
      setup_minutes = coalesce((p_data->>'setup_minutes')::integer, 0), cleanup_minutes = coalesce((p_data->>'cleanup_minutes')::integer, 0),
      public_contact_name = nullif(p_data->>'public_contact_name', ''), public_contact_email = nullif(p_data->>'public_contact_email', ''),
      requester_notes = nullif(p_data->>'requester_notes', ''), draft_version = draft_version + 1, updated_at = now()
      where id = p_event_id and plan_id = v_plan.id and deleted_at is null and status in ('draft', 'changes_requested')
        and draft_version = (p_data->>'draft_version')::integer returning id into v_event;
    if not found then raise exception 'Event changed or is not editable. Refresh before editing.' using errcode = 'RAR09'; end if;
    delete from public.calendar_schedule_dates where event_id = v_event;
    delete from public.calendar_event_ministries where event_id = v_event;
    delete from public.calendar_event_room_templates where event_id = v_event;
    delete from public.calendar_event_resource_templates where event_id = v_event;
    delete from public.calendar_event_schedules where event_id = v_event;
  end if;
  insert into public.calendar_event_schedules(event_id, kind, timezone, start_date, end_date, start_time, end_time,
    frequency, interval_count, weekdays, weekday, month_ordinals, month_ordinal, day_of_month, month_of_year)
  values (v_event, v_kind, v_timezone, v_start, v_end, nullif(v_schedule->>'start_time', '')::time, nullif(v_schedule->>'end_time', '')::time,
    v_frequency, (v_schedule->>'interval_count')::integer,
    case when jsonb_typeof(v_schedule->'weekdays') = 'array' and jsonb_array_length(v_schedule->'weekdays') > 0 then array(select jsonb_array_elements_text(v_schedule->'weekdays')::integer) end,
    (v_schedule->>'weekday')::integer,
    case when jsonb_typeof(v_schedule->'month_ordinals') = 'array' and jsonb_array_length(v_schedule->'month_ordinals') > 0 then array(select jsonb_array_elements_text(v_schedule->'month_ordinals')::integer) end,
    (v_schedule->>'month_ordinal')::integer, (v_schedule->>'day_of_month')::integer, (v_schedule->>'month_of_year')::integer);
  for v_item in select value from jsonb_array_elements(coalesce(p_data->'dates', '[]'::jsonb)) loop
    if (v_start is not null and (v_item#>>'{}')::date < v_start) or (v_end is not null and (v_item#>>'{}')::date > v_end) then raise exception 'Selected date is outside the schedule.' using errcode = 'RAR09'; end if;
    insert into public.calendar_schedule_dates(event_id, local_date) values (v_event, (v_item#>>'{}')::date);
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_data->'rooms', '[]'::jsonb)) loop
    if not exists (select 1 from public.rooms where id = (v_item#>>'{}')::uuid and active) then raise exception 'Room unavailable.' using errcode = 'RAR09'; end if;
    insert into public.calendar_event_room_templates(event_id, room_id) values (v_event, (v_item#>>'{}')::uuid);
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_data->'ministries', '[]'::jsonb)) loop
    if not exists (select 1 from public.ministries where id = (v_item#>>'{}')::uuid and active and id <> v_plan.ministry_id) then raise exception 'Ministry unavailable.' using errcode = 'RAR09'; end if;
    insert into public.calendar_event_ministries(event_id, ministry_id) values (v_event, (v_item#>>'{}')::uuid);
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_data->'resources', '[]'::jsonb)) loop
    if not exists (select 1 from public.calendar_resources where id = (v_item->>'id')::uuid and active) then raise exception 'Resource unavailable.' using errcode = 'RAR09'; end if;
    insert into public.calendar_event_resource_templates(event_id, resource_id, quantity_requested, notes)
      values (v_event, (v_item->>'id')::uuid, (v_item->>'quantity')::integer, nullif(v_item->>'notes', ''));
  end loop;
  insert into public.audit_logs(actor_kind, action, entity_type, entity_id, metadata)
    values ('guest', 'calendar_event.saved', 'calendar_event', v_event::text, jsonb_build_object('plan_id', v_plan.id, 'grant_id', v_context->>'grant_id'));
  return v_event;
end;
$$;
revoke execute on function public.calendar_save_event_draft(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.calendar_save_event_draft(uuid, text, uuid, jsonb) to service_role;

create function public.calendar_submit_plan(p_plan_id uuid, p_session_hash text, p_message text, p_confirm_empty boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_plan public.ministry_calendar_plans; v_event public.calendar_events;
  v_cycle public.calendar_cycles; v_timezone text;
  v_schedule public.calendar_event_schedules; v_submission uuid; v_revision integer; v_count integer;
begin
  select timezone into v_timezone from public.app_settings where id for share;
  v_context := private.calendar_require_planner(p_plan_id, p_session_hash, true);
  select * into v_plan from public.ministry_calendar_plans where id = (v_context->>'plan_id')::uuid;
  select * into v_cycle from public.calendar_cycles where id = v_plan.cycle_id;
  if v_plan.submission_status not in ('draft', 'changes_requested') or char_length(coalesce(p_message, '')) > 2000 then
    raise exception 'Plan cannot be submitted.' using errcode = 'RAR09';
  end if;
  select count(*) into v_count from public.calendar_events where plan_id = v_plan.id and deleted_at is null;
  if v_count = 0 and not coalesce(p_confirm_empty, false) then
    raise exception 'Confirm that this plan has no events.' using errcode = 'RAR09';
  end if;
  v_revision := v_plan.submission_revision + 1;
  insert into public.calendar_plan_submissions(plan_id, revision, submitted_by_grant, message)
    values (v_plan.id, v_revision, (v_context->>'grant_id')::uuid, nullif(p_message, ''));
  for v_event in select * from public.calendar_events where plan_id = v_plan.id and deleted_at is null order by id for update loop
    select * into v_schedule from public.calendar_event_schedules where event_id = v_event.id;
    if not found or v_schedule.start_date is null or v_schedule.end_date is null
      or v_schedule.start_time is null or v_schedule.end_time is null
      or (v_schedule.kind = 'specific_dates' and not exists (select 1 from public.calendar_schedule_dates where event_id = v_event.id))
      or (v_schedule.kind = 'recurring' and (v_schedule.interval_count is null
        or (v_schedule.frequency = 'weekly' and v_schedule.weekdays is null)
        or (v_schedule.frequency = 'monthly_day' and v_schedule.day_of_month is null)
        or (v_schedule.frequency = 'monthly_nth_weekday' and (v_schedule.weekday is null or v_schedule.month_ordinals is null))
        or (v_schedule.frequency = 'yearly_date' and (v_schedule.day_of_month is null or v_schedule.month_of_year is null))
        or (v_schedule.frequency = 'yearly_nth_weekday' and (v_schedule.weekday is null or v_schedule.month_ordinal is null or v_schedule.month_of_year is null)))) then
      raise exception 'Every event needs a complete schedule.' using errcode = 'RAR09';
    end if;
    if v_schedule.start_date < v_cycle.start_date or v_schedule.end_date > v_cycle.end_date
      or v_schedule.timezone <> v_timezone then
      raise exception 'Review event dates and timezone before submitting.' using errcode = 'RAR09';
    end if;
    if exists (select 1 from public.calendar_event_room_templates t join public.rooms r on r.id = t.room_id where t.event_id = v_event.id and not r.active)
      or exists (select 1 from public.calendar_event_resource_templates t join public.calendar_resources r on r.id = t.resource_id where t.event_id = v_event.id and not r.active)
      or exists (select 1 from public.calendar_event_ministries t join public.ministries m on m.id = t.ministry_id where t.event_id = v_event.id and not m.active) then
      raise exception 'An event contains an unavailable room, resource, or ministry.' using errcode = 'RAR09';
    end if;
    insert into public.calendar_event_submissions(event_id, plan_revision, submitted_by_grant, title, description,
      public_description, category, scope, protection, visibility, location_type, offsite_location, virtual_url,
      estimated_attendance, food_drinks_planned, setup_minutes, cleanup_minutes, public_contact_name, public_contact_email,
      requester_notes, schedule_kind, timezone, start_date, end_date, start_time, end_time, frequency, interval_count,
      weekdays, weekday, month_ordinals, month_ordinal, day_of_month, month_of_year)
    values (v_event.id, v_revision, (v_context->>'grant_id')::uuid, v_event.title, v_event.description,
      v_event.public_description, v_event.category, v_event.scope, v_event.protection, v_event.visibility,
      v_event.location_type, v_event.offsite_location, v_event.virtual_url, v_event.estimated_attendance,
      v_event.food_drinks_planned, v_event.setup_minutes, v_event.cleanup_minutes, v_event.public_contact_name,
      v_event.public_contact_email, v_event.requester_notes, v_schedule.kind, v_schedule.timezone,
      v_schedule.start_date, v_schedule.end_date, v_schedule.start_time, v_schedule.end_time, v_schedule.frequency,
      v_schedule.interval_count, v_schedule.weekdays, v_schedule.weekday, v_schedule.month_ordinals,
      v_schedule.month_ordinal, v_schedule.day_of_month, v_schedule.month_of_year) returning id into v_submission;
    insert into public.calendar_submission_dates select v_submission, local_date from public.calendar_schedule_dates where event_id = v_event.id;
    insert into public.calendar_submission_ministries select v_submission, ministry_id from public.calendar_event_ministries where event_id = v_event.id;
    insert into public.calendar_submission_room_templates select v_submission, room_id from public.calendar_event_room_templates where event_id = v_event.id;
    insert into public.calendar_submission_resource_templates select v_submission, resource_id, quantity_requested, notes from public.calendar_event_resource_templates where event_id = v_event.id;
    update public.calendar_events set status = 'submitted', revision = v_revision, updated_at = now() where id = v_event.id;
  end loop;
  update public.ministry_calendar_plans set submission_status = 'submitted', submission_revision = v_revision,
    submitted_at = now(), requester_message = nullif(p_message, ''), changes_requested_reason = null where id = v_plan.id;
  insert into public.audit_logs(actor_kind, action, entity_type, entity_id, metadata)
    values ('guest', 'calendar_plan.submitted', 'calendar_plan', v_plan.id::text,
      jsonb_build_object('grant_id', v_context->>'grant_id', 'revision', v_revision, 'event_count', v_count));
  return v_revision;
end;
$$;
revoke execute on function public.calendar_submit_plan(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.calendar_submit_plan(uuid, text, text, boolean) to service_role;

create function public.calendar_request_plan_changes(p_plan_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_staff(); v_cycle public.calendar_cycles; v_plan public.ministry_calendar_plans;
begin
  select c.* into v_cycle from public.calendar_cycles c join public.ministry_calendar_plans p on p.cycle_id = c.id
    where p.id = p_plan_id for update of c;
  select * into v_plan from public.ministry_calendar_plans where id = p_plan_id for update;
  if not found or not v_plan.active or v_cycle.status <> 'open' or now() >= v_cycle.submission_deadline
    or v_plan.submission_status <> 'submitted' or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 2000 then
    raise exception 'Cannot request changes to this plan.' using errcode = 'RAR09';
  end if;
  update public.ministry_calendar_plans set submission_status = 'changes_requested', changes_requested_reason = btrim(p_reason) where id = p_plan_id;
  update public.calendar_events set status = 'changes_requested', updated_at = now()
    where plan_id = p_plan_id and status = 'submitted' and deleted_at is null;
  perform private.calendar_audit(v_actor, 'calendar_plan.changes_requested', 'calendar_plan', p_plan_id, jsonb_build_object('reason', btrim(p_reason)));
end;
$$;
revoke execute on function public.calendar_request_plan_changes(uuid, text) from public, anon, service_role;
grant execute on function public.calendar_request_plan_changes(uuid, text) to authenticated;

create function public.calendar_planner_portal(p_plan_id uuid, p_session_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_plan public.ministry_calendar_plans;
begin
  v_context := private.calendar_require_planner(p_plan_id, p_session_hash, true);
  select * into v_plan from public.ministry_calendar_plans where id = (v_context->>'plan_id')::uuid;
  return jsonb_build_object(
    'status', v_plan.submission_status, 'revision', v_plan.submission_revision,
    'changes_requested_reason', v_plan.changes_requested_reason,
    'rooms', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'active', r.active) order by r.name), '[]'::jsonb) from public.rooms r
      where r.active or exists (select 1 from public.calendar_event_room_templates t join public.calendar_events e on e.id = t.event_id where e.plan_id = v_plan.id and e.deleted_at is null and t.room_id = r.id)),
    'resources', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'active', r.active) order by r.name), '[]'::jsonb) from public.calendar_resources r
      where r.active or exists (select 1 from public.calendar_event_resource_templates t join public.calendar_events e on e.id = t.event_id where e.plan_id = v_plan.id and e.deleted_at is null and t.resource_id = r.id)),
    'ministries', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'active', m.active) order by m.name), '[]'::jsonb) from public.ministries m
      where m.id <> v_plan.ministry_id and (m.active or exists (select 1 from public.calendar_event_ministries t join public.calendar_events e on e.id = t.event_id where e.plan_id = v_plan.id and e.deleted_at is null and t.ministry_id = m.id))),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object(
      'schedule', to_jsonb(s),
      'dates', (select coalesce(jsonb_agg(local_date order by local_date), '[]'::jsonb) from public.calendar_schedule_dates where event_id = e.id),
      'rooms', (select coalesce(jsonb_agg(room_id), '[]'::jsonb) from public.calendar_event_room_templates where event_id = e.id),
      'ministries', (select coalesce(jsonb_agg(ministry_id), '[]'::jsonb) from public.calendar_event_ministries where event_id = e.id),
      'resources', (select coalesce(jsonb_agg(jsonb_build_object('id', resource_id, 'quantity', quantity_requested, 'notes', notes)), '[]'::jsonb) from public.calendar_event_resource_templates where event_id = e.id)
    ) order by e.created_at), '[]'::jsonb) from public.calendar_events e left join public.calendar_event_schedules s on s.event_id = e.id
      where e.plan_id = v_plan.id and e.deleted_at is null));
end;
$$;

create function public.calendar_remove_event_draft(p_plan_id uuid, p_session_hash text, p_event_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_plan public.ministry_calendar_plans;
begin
  v_context := private.calendar_require_planner(p_plan_id, p_session_hash, true);
  select * into v_plan from public.ministry_calendar_plans where id = (v_context->>'plan_id')::uuid;
  if v_plan.submission_status not in ('draft', 'changes_requested') then raise exception 'Plan is not editable.' using errcode = 'RAR09'; end if;
  update public.calendar_events set deleted_at = now(), updated_at = now()
    where id = p_event_id and plan_id = v_plan.id and deleted_at is null and revision = 0 and status = 'draft';
  if not found then raise exception 'Only never-submitted drafts can be deleted.' using errcode = 'RAR09'; end if;
  insert into public.audit_logs(actor_kind, action, entity_type, entity_id, metadata)
    values ('guest', 'calendar_event.deleted', 'calendar_event', p_event_id::text,
      jsonb_build_object('plan_id', v_plan.id, 'grant_id', v_context->>'grant_id'));
end;
$$;

create function public.calendar_staff_plan_list()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'cycle', c.name, 'ministry', m.name,
    'status', p.submission_status, 'revision', p.submission_revision, 'submitted_at', p.submitted_at,
    'message', p.requester_message, 'events', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
      'reference', e.reference_code,
      'rooms', (select coalesce(jsonb_agg(r.name order by r.name), '[]'::jsonb) from public.calendar_submission_room_templates t join public.rooms r on r.id = t.room_id where t.submission_id = s.id),
      'resources', (select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'quantity', t.quantity_requested, 'notes', t.notes) order by r.name), '[]'::jsonb) from public.calendar_submission_resource_templates t join public.calendar_resources r on r.id = t.resource_id where t.submission_id = s.id),
      'ministries', (select coalesce(jsonb_agg(m.name order by m.name), '[]'::jsonb) from public.calendar_submission_ministries t join public.ministries m on m.id = t.ministry_id where t.submission_id = s.id),
      'dates', (select coalesce(jsonb_agg(local_date order by local_date), '[]'::jsonb) from public.calendar_submission_dates where submission_id = s.id)
    ) order by s.start_date), '[]'::jsonb)
      from public.calendar_event_submissions s join public.calendar_events e on e.id = s.event_id
      where e.plan_id = p.id and s.plan_revision = p.submission_revision)) order by p.submitted_at desc), '[]'::jsonb)
    from public.ministry_calendar_plans p join public.calendar_cycles c on c.id = p.cycle_id
    join public.ministries m on m.id = p.ministry_id where p.active and p.submission_revision > 0);
end;
$$;
revoke execute on function public.calendar_planner_portal(uuid, text), public.calendar_remove_event_draft(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.calendar_planner_portal(uuid, text), public.calendar_remove_event_draft(uuid, text, uuid) to service_role;
revoke execute on function public.calendar_staff_plan_list() from public, anon, service_role;
grant execute on function public.calendar_staff_plan_list() to authenticated;

create function public.calendar_duplicate_event_draft(p_plan_id uuid, p_session_hash text, p_event_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_portal jsonb; v_event jsonb;
begin
  perform 1 from public.app_settings where id for share;
  v_portal := public.calendar_planner_portal(p_plan_id, p_session_hash);
  select value into v_event from jsonb_array_elements(v_portal->'events') where value->>'id' = p_event_id::text;
  if v_event is null then raise exception 'Event unavailable.' using errcode = 'RAR09'; end if;
  return public.calendar_save_event_draft(p_plan_id, p_session_hash, null,
    jsonb_set(v_event, '{title}', to_jsonb(left(v_event->>'title', 193) || ' (copy)')));
end;
$$;
revoke execute on function public.calendar_duplicate_event_draft(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.calendar_duplicate_event_draft(uuid, text, uuid) to service_role;
