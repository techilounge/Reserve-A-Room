-- Phase 2 review fixes. No reservations, occurrences or allocations are created.
alter table public.calendar_event_schedules add column all_day boolean not null default false;
alter table public.calendar_event_submissions add column all_day boolean not null default false;
alter table public.calendar_event_submissions alter column start_time drop not null;
alter table public.calendar_event_submissions alter column end_time drop not null;
alter table public.calendar_event_schedules add constraint calendar_schedules_all_day_times_check
  check (not all_day or (start_time is null and end_time is null));
alter table public.calendar_event_submissions add constraint calendar_submissions_all_day_times_check
  check (not all_day or (start_time is null and end_time is null));

-- The existing row id is the stable logical identity of a specific-date entry.
-- Entries removed from a draft are tombstoned, not recycled for another event.
alter table public.calendar_schedule_dates add column local_end_date date;
alter table public.calendar_schedule_dates add column local_start_time time;
alter table public.calendar_schedule_dates add column local_end_time time;
alter table public.calendar_schedule_dates add column removed_at timestamptz;
update public.calendar_schedule_dates d set local_end_date = d.local_date,
  local_start_time = s.start_time, local_end_time = s.end_time
  from public.calendar_event_schedules s where s.event_id = d.event_id;
alter table public.calendar_schedule_dates alter column local_end_date set not null;
alter table public.calendar_schedule_dates drop constraint calendar_schedule_dates_event_id_local_date_key;
alter table public.calendar_schedule_dates add constraint calendar_schedule_dates_bounds_check
  check (isfinite(local_date) and isfinite(local_end_date) and local_end_date >= local_date
    and (local_start_time is null or local_end_time is null or local_end_date > local_date or local_end_time > local_start_time));

alter table public.calendar_submission_dates add column logical_date_id uuid;
alter table public.calendar_submission_dates add column local_end_date date;
alter table public.calendar_submission_dates add column local_start_time time;
alter table public.calendar_submission_dates add column local_end_time time;
-- Backfill only the new fields of historical snapshots. Existing identities can
-- be recovered when the old draft row still matches; prior deleted/recreated ids
-- cannot be reconstructed and receive a new stable historical identity.
alter table public.calendar_submission_dates disable trigger calendar_submission_dates_immutable;
update public.calendar_submission_dates d set
  logical_date_id = coalesce((select x.id from public.calendar_schedule_dates x
    join public.calendar_event_submissions s on s.event_id = x.event_id
    where s.id = d.submission_id and x.local_date = d.local_date limit 1), gen_random_uuid()),
  local_end_date = d.local_date,
  local_start_time = s.start_time, local_end_time = s.end_time
  from public.calendar_event_submissions s where s.id = d.submission_id;
alter table public.calendar_submission_dates enable trigger calendar_submission_dates_immutable;
alter table public.calendar_submission_dates alter column logical_date_id set not null;
alter table public.calendar_submission_dates alter column local_end_date set not null;
alter table public.calendar_submission_dates drop constraint calendar_submission_dates_pkey;
alter table public.calendar_submission_dates add primary key (submission_id, logical_date_id);


create or replace function public.calendar_save_event_draft(p_plan_id uuid, p_session_hash text, p_event_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_context jsonb; v_plan public.ministry_calendar_plans; v_cycle public.calendar_cycles;
  v_event uuid; v_schedule jsonb := p_data->'schedule'; v_timezone text; v_item jsonb;
  v_start date; v_end date; v_kind text; v_frequency text; v_all_day boolean;
  v_date_id uuid; v_date_start date; v_date_end date; v_date_ids uuid[] := '{}';
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
  v_all_day := coalesce((v_schedule->>'all_day')::boolean, false);
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
    delete from public.calendar_event_ministries where event_id = v_event;
    delete from public.calendar_event_room_templates where event_id = v_event;
    delete from public.calendar_event_resource_templates where event_id = v_event;
    delete from public.calendar_event_schedules where event_id = v_event;
  end if;
  insert into public.calendar_event_schedules(event_id, kind, timezone, start_date, end_date, start_time, end_time, all_day,
    frequency, interval_count, weekdays, weekday, month_ordinals, month_ordinal, day_of_month, month_of_year)
  values (v_event, v_kind, v_timezone, v_start, v_end,
    case when v_all_day or v_kind = 'specific_dates' then null else nullif(v_schedule->>'start_time', '')::time end,
    case when v_all_day or v_kind = 'specific_dates' then null else nullif(v_schedule->>'end_time', '')::time end, v_all_day,
    v_frequency, (v_schedule->>'interval_count')::integer,
    case when jsonb_typeof(v_schedule->'weekdays') = 'array' and jsonb_array_length(v_schedule->'weekdays') > 0 then array(select jsonb_array_elements_text(v_schedule->'weekdays')::integer) end,
    (v_schedule->>'weekday')::integer,
    case when jsonb_typeof(v_schedule->'month_ordinals') = 'array' and jsonb_array_length(v_schedule->'month_ordinals') > 0 then array(select jsonb_array_elements_text(v_schedule->'month_ordinals')::integer) end,
    (v_schedule->>'month_ordinal')::integer, (v_schedule->>'day_of_month')::integer, (v_schedule->>'month_of_year')::integer);
  for v_item in select value from jsonb_array_elements(coalesce(p_data->'dates', '[]'::jsonb)) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Invalid selected date.' using errcode = 'RAR09'; end if;
    v_date_start := nullif(v_item->>'start_date', '')::date;
    v_date_end := nullif(v_item->>'end_date', '')::date;
    if v_date_start is null or v_date_end is null or v_date_start < v_cycle.start_date or v_date_end > v_cycle.end_date
      or v_date_end < v_date_start or (v_start is not null and v_date_start < v_start)
      or (v_end is not null and v_date_end > v_end) then
      raise exception 'Selected date is outside the schedule.' using errcode = 'RAR09';
    end if;
    v_date_id := nullif(v_item->>'id', '')::uuid;
    if v_date_id is null then
      insert into public.calendar_schedule_dates(event_id, local_date, local_end_date, local_start_time, local_end_time)
        values (v_event, v_date_start, v_date_end,
          case when v_all_day then null else nullif(v_item->>'start_time', '')::time end,
          case when v_all_day then null else nullif(v_item->>'end_time', '')::time end) returning id into v_date_id;
    else
      if v_date_id = any(v_date_ids) then raise exception 'Duplicate selected date identity.' using errcode = 'RAR09'; end if;
      update public.calendar_schedule_dates set local_date = v_date_start, local_end_date = v_date_end,
        local_start_time = case when v_all_day then null else nullif(v_item->>'start_time', '')::time end,
        local_end_time = case when v_all_day then null else nullif(v_item->>'end_time', '')::time end
        where id = v_date_id and event_id = v_event and removed_at is null;
      if not found then raise exception 'Selected date is not editable.' using errcode = 'RAR09'; end if;
    end if;
    v_date_ids := array_append(v_date_ids, v_date_id);
  end loop;
  update public.calendar_schedule_dates set removed_at = now()
    where event_id = v_event and removed_at is null and not (id = any(v_date_ids));
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


create or replace function public.calendar_submit_plan(p_plan_id uuid, p_session_hash text, p_message text, p_confirm_empty boolean)
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
      or (not v_schedule.all_day and v_schedule.kind <> 'specific_dates'
        and (v_schedule.start_time is null or v_schedule.end_time is null))
      or (v_schedule.kind = 'specific_dates' and not exists (select 1 from public.calendar_schedule_dates where event_id = v_event.id and removed_at is null))
      or (v_schedule.kind = 'specific_dates' and exists (select 1 from public.calendar_schedule_dates
        where event_id = v_event.id and removed_at is null and not v_schedule.all_day
          and (local_start_time is null or local_end_time is null)))
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
      requester_notes, schedule_kind, timezone, start_date, end_date, start_time, end_time, all_day, frequency, interval_count,
      weekdays, weekday, month_ordinals, month_ordinal, day_of_month, month_of_year)
    values (v_event.id, v_revision, (v_context->>'grant_id')::uuid, v_event.title, v_event.description,
      v_event.public_description, v_event.category, v_event.scope, v_event.protection, v_event.visibility,
      v_event.location_type, v_event.offsite_location, v_event.virtual_url, v_event.estimated_attendance,
      v_event.food_drinks_planned, v_event.setup_minutes, v_event.cleanup_minutes, v_event.public_contact_name,
      v_event.public_contact_email, v_event.requester_notes, v_schedule.kind, v_schedule.timezone,
      v_schedule.start_date, v_schedule.end_date, v_schedule.start_time, v_schedule.end_time, v_schedule.all_day, v_schedule.frequency,
      v_schedule.interval_count, v_schedule.weekdays, v_schedule.weekday, v_schedule.month_ordinals,
      v_schedule.month_ordinal, v_schedule.day_of_month, v_schedule.month_of_year) returning id into v_submission;
    insert into public.calendar_submission_dates(submission_id, local_date, logical_date_id, local_end_date, local_start_time, local_end_time)
      select v_submission, local_date, id, local_end_date, local_start_time, local_end_time
      from public.calendar_schedule_dates where event_id = v_event.id and removed_at is null;
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


create or replace function public.calendar_planner_portal(p_plan_id uuid, p_session_hash text)
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
      'dates', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'start_date', local_date, 'end_date', local_end_date,
        'start_time', local_start_time, 'end_time', local_end_time) order by local_date, id), '[]'::jsonb)
        from public.calendar_schedule_dates where event_id = e.id and removed_at is null),
      'rooms', (select coalesce(jsonb_agg(room_id), '[]'::jsonb) from public.calendar_event_room_templates where event_id = e.id),
      'ministries', (select coalesce(jsonb_agg(ministry_id), '[]'::jsonb) from public.calendar_event_ministries where event_id = e.id),
      'resources', (select coalesce(jsonb_agg(jsonb_build_object('id', resource_id, 'quantity', quantity_requested, 'notes', notes)), '[]'::jsonb) from public.calendar_event_resource_templates where event_id = e.id)
    ) order by e.created_at), '[]'::jsonb) from public.calendar_events e left join public.calendar_event_schedules s on s.event_id = e.id
      where e.plan_id = v_plan.id and e.deleted_at is null));
end;
$$;


drop function public.calendar_remove_event_draft(uuid, text, uuid);
create function public.calendar_remove_event_draft(p_plan_id uuid, p_session_hash text, p_event_id uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_plan public.ministry_calendar_plans; v_revision integer;
begin
  v_context := private.calendar_require_planner(p_plan_id, p_session_hash, true);
  select * into v_plan from public.ministry_calendar_plans where id = (v_context->>'plan_id')::uuid;
  if v_plan.submission_status not in ('draft', 'changes_requested') then raise exception 'Plan is not editable.' using errcode = 'RAR09'; end if;
  update public.calendar_events set deleted_at = now(), updated_at = now()
    where id = p_event_id and plan_id = v_plan.id and deleted_at is null and draft_version = p_expected_version
      and ((revision = 0 and status = 'draft') or (v_plan.submission_status = 'changes_requested' and status = 'changes_requested'))
    returning revision into v_revision;
  if not found then raise exception 'Event cannot be removed from this plan.' using errcode = 'RAR09'; end if;
  insert into public.audit_logs(actor_kind, action, entity_type, entity_id, metadata)
    values ('guest', case when v_revision = 0 then 'calendar_event.deleted' else 'calendar_event.withdrawn' end, 'calendar_event', p_event_id::text,
      jsonb_build_object('plan_id', v_plan.id, 'grant_id', v_context->>'grant_id', 'previous_revision', v_revision));
end;
$$;
revoke execute on function public.calendar_remove_event_draft(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.calendar_remove_event_draft(uuid, text, uuid, integer) to service_role;


create or replace function public.calendar_staff_plan_list()
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
      'dates', (select coalesce(jsonb_agg(jsonb_build_object('id', logical_date_id, 'start_date', local_date, 'end_date', local_end_date,
        'start_time', local_start_time, 'end_time', local_end_time) order by local_date, logical_date_id), '[]'::jsonb)
        from public.calendar_submission_dates where submission_id = s.id)
    ) order by s.start_date), '[]'::jsonb)
      from public.calendar_event_submissions s join public.calendar_events e on e.id = s.event_id
      where e.plan_id = p.id and s.plan_revision = p.submission_revision)) order by p.submitted_at desc), '[]'::jsonb)
    from public.ministry_calendar_plans p join public.calendar_cycles c on c.id = p.cycle_id
    join public.ministries m on m.id = p.ministry_id where p.active and p.submission_revision > 0);
end;
$$;


create or replace function public.calendar_duplicate_event_draft(p_plan_id uuid, p_session_hash text, p_event_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_portal jsonb; v_event jsonb;
begin
  perform 1 from public.app_settings where id for share;
  v_portal := public.calendar_planner_portal(p_plan_id, p_session_hash);
  select value into v_event from jsonb_array_elements(v_portal->'events') where value->>'id' = p_event_id::text;
  if v_event is null then raise exception 'Event unavailable.' using errcode = 'RAR09'; end if;
  v_event := jsonb_set(v_event, '{dates}', coalesce((select jsonb_agg(value - 'id')
    from jsonb_array_elements(v_event->'dates')), '[]'::jsonb));
  return public.calendar_save_event_draft(p_plan_id, p_session_hash, null,
    jsonb_set(v_event, '{title}', to_jsonb(left(v_event->>'title', 193) || ' (copy)')));
end;
$$;
