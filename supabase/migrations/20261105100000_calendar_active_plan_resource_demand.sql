-- Restoring a removed ministry must not silently revive an old proposal. Keep
-- the historical submission and require a fresh plan revision to participate.
alter table public.ministry_calendar_plans
  add column resource_submission_floor integer not null default 0 check (resource_submission_floor >= 0);

-- Cover plans restored before this migration without altering their snapshots.
update public.ministry_calendar_plans p set resource_submission_floor = p.submission_revision
  where p.submission_revision > 0 and exists (
    select 1 from public.audit_logs a where a.action = 'calendar_plan.restored' and a.entity_id = p.id::text
      and a.created_at >= p.submitted_at
  );

create function private.calendar_resource_participation_restore()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not old.active and new.active then
    new.resource_submission_floor := old.submission_revision;
  end if;
  return new;
end;
$$;
create trigger calendar_resource_participation_restore before update of active on public.ministry_calendar_plans
  for each row execute function private.calendar_resource_participation_restore();
revoke execute on function private.calendar_resource_participation_restore() from public, anon, authenticated, service_role;

-- Defense in depth for the unexposed future allocation primitive: a restored
-- plan cannot allocate from a snapshot that predates restored participation.
create function private.calendar_resource_allocation_participation_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.calendar_submission_occurrences o
      join public.calendar_event_submissions s on s.id = o.submission_id
      join public.calendar_events e on e.id = s.event_id
      join public.ministry_calendar_plans p on p.id = e.plan_id
    where o.id = new.submission_occurrence_id and p.active and p.submission_status = 'submitted'
      and s.plan_revision = p.submission_revision and s.plan_revision > p.resource_submission_floor
  ) then raise exception 'Resource request unavailable.' using errcode = 'RAR09'; end if;
  return new;
end;
$$;
create trigger calendar_resource_allocation_participation_guard before insert on public.calendar_resource_allocations
  for each row execute function private.calendar_resource_allocation_participation_guard();
revoke execute on function private.calendar_resource_allocation_participation_guard() from public, anon, authenticated, service_role;

-- Confirmed allocations remain counted regardless of plan participation.
-- Current submitted snapshots count as proposals only while participating; an
-- active changes-requested plan keeps its last submitted snapshot until resubmission.
create or replace function public.calendar_resource_availability(p_resource uuid, p_start timestamptz, p_end timestamptz)
returns table(segment_start timestamptz, segment_end timestamptz, capacity integer, confirmed bigint, provisional bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end <= p_start or p_end > p_start + interval '3 years' then
    raise exception 'Invalid availability range.' using errcode = 'RAR09'; end if;
  if not exists (select 1 from public.calendar_resources where id = p_resource) then raise exception 'Resource unavailable.' using errcode = 'RAR09'; end if;
  return query with demand as (
    select a.occupancy_start as starts, a.occupancy_end as ends, a.quantity::bigint as c, 0::bigint as p
      from public.calendar_resource_allocations a where a.resource_id = p_resource and a.status = 'confirmed'
        and a.occupancy_start < p_end and a.occupancy_end > p_start
    union all
    select o.occupancy_start, o.occupancy_end, 0::bigint, r.quantity_requested::bigint
      from public.calendar_submission_resource_requests r
      join public.calendar_submission_occurrences o on o.id = r.submission_occurrence_id
      join public.calendar_event_submissions s on s.id = o.submission_id
      join public.calendar_events e on e.id = s.event_id join public.ministry_calendar_plans plan on plan.id = e.plan_id
      where r.resource_id = p_resource and plan.active and plan.submission_status in ('submitted', 'changes_requested')
        and s.plan_revision = plan.submission_revision and s.plan_revision > plan.resource_submission_floor
        and o.occupancy_start < p_end and o.occupancy_end > p_start
        and not exists (select 1 from public.calendar_resource_allocations a
          join public.calendar_submission_occurrences old_o on old_o.id = a.submission_occurrence_id
          where a.resource_id = p_resource and a.status = 'confirmed' and old_o.occurrence_id = o.occurrence_id)
  ), endpoints as (
    select p_start as at, 0::bigint as c, 0::bigint as p union all select p_end, 0, 0
    union all select greatest(starts, p_start), c, p from demand
    union all select least(ends, p_end), -c, -p from demand
  ), boundaries as (select at, sum(c) as dc, sum(p) as dp from endpoints group by at),
  segments as (select at, lead(at) over (order by at) as next_at,
    sum(dc) over (order by at)::bigint as used, sum(dp) over (order by at)::bigint as proposed from boundaries)
  select seg.at, seg.next_at, res.available_quantity, seg.used, seg.proposed
    from segments seg cross join public.calendar_resources res where res.id = p_resource and seg.next_at > seg.at order by seg.at;
end;
$$;
