-- Phase 4 resource foundations. No public allocation or approval RPC is exposed.
create table public.calendar_resource_allocations (
  id uuid primary key default gen_random_uuid(),
  submission_occurrence_id uuid not null references public.calendar_submission_occurrences(id),
  resource_id uuid not null references public.calendar_resources(id),
  quantity integer not null check (quantity > 0),
  occupancy_start timestamptz not null,
  occupancy_end timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'released')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  released_by uuid references public.profiles(id),
  released_at timestamptz,
  check (occupancy_end > occupancy_start),
  check ((status = 'confirmed' and released_at is null and released_by is null)
    or (status = 'released' and released_at is not null and released_by is not null))
);
create unique index calendar_resource_allocation_current on public.calendar_resource_allocations(submission_occurrence_id, resource_id) where status = 'confirmed';
create index calendar_resource_allocation_resource on public.calendar_resource_allocations(resource_id, occupancy_start, occupancy_end) where status = 'confirmed';
create index calendar_submission_resource_lookup on public.calendar_submission_resource_requests(resource_id, submission_occurrence_id);
alter table public.calendar_resource_allocations enable row level security;
revoke all on public.calendar_resource_allocations from public, anon, authenticated, service_role;

-- Sum simultaneous use at each boundary. Equal end/start times cancel together,
-- so adjacent [start,end) intervals can reuse the same capacity.
create function private.calendar_resource_peak(p_resource uuid, p_start timestamptz, p_end timestamptz)
returns bigint language sql stable set search_path = '' as $$
  with endpoints as (
    select greatest(a.occupancy_start, p_start) as at, a.quantity::bigint as delta
      from public.calendar_resource_allocations a where a.resource_id = p_resource and a.status = 'confirmed'
        and a.occupancy_start < p_end and a.occupancy_end > p_start
    union all
    select least(a.occupancy_end, p_end), -a.quantity::bigint
      from public.calendar_resource_allocations a where a.resource_id = p_resource and a.status = 'confirmed'
        and a.occupancy_start < p_end and a.occupancy_end > p_start
  ), boundaries as (select at, sum(delta) as delta from endpoints group by at),
  usage as (select sum(delta) over (order by at) as used from boundaries)
  select coalesce(max(used), 0)::bigint from usage;
$$;
revoke execute on function private.calendar_resource_peak(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.save_calendar_resource(p_id uuid, p_name text, p_category text, p_quantity integer,
  p_active boolean, p_description text, p_private_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_super_admin(); v_id uuid; v_old public.calendar_resources;
begin
  if p_id is null then
    insert into public.calendar_resources(name, category, available_quantity, active, description, private_notes)
      values (btrim(p_name), p_category, p_quantity, p_active, nullif(btrim(p_description), ''), nullif(btrim(p_private_notes), '')) returning id into v_id;
  else
    select * into v_old from public.calendar_resources where id = p_id for update;
    if not found then raise exception 'Resource not found.' using errcode = 'RAR09'; end if;
    if p_quantity < private.calendar_resource_peak(p_id, '-infinity'::timestamptz, 'infinity'::timestamptz) then
      raise exception 'Quantity is below existing confirmed allocations.' using errcode = 'RAR09';
    end if;
    update public.calendar_resources set name = btrim(p_name), category = p_category, available_quantity = p_quantity,
      active = p_active, description = nullif(btrim(p_description), ''), private_notes = nullif(btrim(p_private_notes), ''), updated_at = now()
      where id = p_id returning id into v_id;
  end if;
  perform private.calendar_audit(v_actor, case when p_id is null then 'calendar_resource.created' else 'calendar_resource.updated' end,
    'calendar_resource', v_id, jsonb_build_object('name', btrim(p_name), 'active', p_active, 'quantity', p_quantity,
      'previous_active', v_old.active, 'previous_quantity', v_old.available_quantity));
  return v_id;
end;
$$;

-- Internal building blocks for a future approval transaction. Neither function is
-- granted to API roles or called by any Phase 4 route. Phase 6 must independently
-- revalidate approval policy, lock all affected resources in stable order, and
-- atomically coordinate room reservations and event state before calling them.
create function private.calendar_allocate_resource(p_snapshot_occurrence uuid, p_resource uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_staff(); v_occ public.calendar_submission_occurrences;
  v_plan uuid; v_event uuid; v_current boolean; v_quantity integer; v_resource public.calendar_resources; v_id uuid;
begin
  select e.plan_id, e.id into v_plan, v_event from public.calendar_submission_occurrences o
    join public.calendar_event_submissions s on s.id = o.submission_id join public.calendar_events e on e.id = s.event_id
    where o.id = p_snapshot_occurrence;
  if v_plan is null then raise exception 'Resource request unavailable.' using errcode = 'RAR09'; end if;
  perform 1 from public.ministry_calendar_plans where id = v_plan for update;
  perform 1 from public.calendar_events where id = v_event for update;
  select * into v_resource from public.calendar_resources where id = p_resource for update;
  if not found or not v_resource.active then raise exception 'Resource unavailable.' using errcode = 'RAR09'; end if;
  -- Advance the locked row version so repeatable-read/serializable transactions
  -- that began before a competing allocation fail with a serialization error.
  update public.calendar_resources set updated_at = now() where id = p_resource;
  select r.quantity_requested, (s.plan_revision = p.submission_revision and p.active and p.submission_status = 'submitted'
      and e.status = 'submitted' and e.deleted_at is null)
    into v_quantity, v_current from public.calendar_submission_occurrences o
    join public.calendar_event_submissions s on s.id = o.submission_id join public.calendar_events e on e.id = s.event_id
    join public.ministry_calendar_plans p on p.id = e.plan_id
    join public.calendar_submission_resource_requests r on r.submission_occurrence_id = o.id and r.resource_id = p_resource
    where o.id = p_snapshot_occurrence;
  if not found or not v_current then raise exception 'Resource request unavailable.' using errcode = 'RAR09'; end if;
  select * into v_occ from public.calendar_submission_occurrences where id = p_snapshot_occurrence;
  if v_occ.occupancy_start <= now() then raise exception 'Past resource requests cannot be allocated.' using errcode = 'RAR09'; end if;
  if exists (select 1 from public.calendar_resource_allocations a
    join public.calendar_submission_occurrences prior on prior.id = a.submission_occurrence_id
    where a.resource_id = p_resource and a.status = 'confirmed' and prior.occurrence_id = v_occ.occurrence_id) then
    raise exception 'Resource is already allocated to this occurrence.' using errcode = 'RAR09';
  end if;
  if private.calendar_resource_peak(p_resource, v_occ.occupancy_start, v_occ.occupancy_end) + v_quantity > v_resource.available_quantity then
    raise exception 'Resource capacity exceeded.' using errcode = 'RAR09';
  end if;
  insert into public.calendar_resource_allocations(submission_occurrence_id, resource_id, quantity, occupancy_start, occupancy_end, created_by)
    values (v_occ.id, p_resource, v_quantity, v_occ.occupancy_start, v_occ.occupancy_end, v_actor) returning id into v_id;
  perform private.calendar_audit(v_actor, 'calendar_resource.allocated', 'calendar_resource_allocation', v_id,
    jsonb_build_object('resource_id', p_resource, 'submission_occurrence_id', p_snapshot_occurrence, 'quantity', v_quantity));
  return v_id;
end;
$$;

create function private.calendar_release_resource(p_allocation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_staff(); v_resource uuid;
begin
  select resource_id into v_resource from public.calendar_resource_allocations where id = p_allocation;
  if v_resource is null then raise exception 'Allocation unavailable.' using errcode = 'RAR09'; end if;
  perform 1 from public.calendar_resources where id = v_resource for update;
  update public.calendar_resources set updated_at = now() where id = v_resource;
  update public.calendar_resource_allocations set status = 'released', released_at = now(), released_by = v_actor
    where id = p_allocation and status = 'confirmed';
  if not found then raise exception 'Allocation unavailable.' using errcode = 'RAR09'; end if;
  perform private.calendar_audit(v_actor, 'calendar_resource.released', 'calendar_resource_allocation', p_allocation,
    jsonb_build_object('resource_id', v_resource));
end;
$$;
revoke execute on function private.calendar_allocate_resource(uuid, uuid), private.calendar_release_resource(uuid) from public, anon, authenticated, service_role;

-- Staff get aggregate capacity segments only. Current submitted snapshots provide
-- provisional demand; a confirmed allocation replaces its own proposal in the sum.
create function public.calendar_resource_availability(p_resource uuid, p_start timestamptz, p_end timestamptz)
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
      where r.resource_id = p_resource and s.plan_revision = plan.submission_revision
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
revoke execute on function public.calendar_resource_availability(uuid, timestamptz, timestamptz) from public, anon, service_role;
grant execute on function public.calendar_resource_availability(uuid, timestamptz, timestamptz) to authenticated;
