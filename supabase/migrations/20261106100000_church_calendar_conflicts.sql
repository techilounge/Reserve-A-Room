-- Phase 5: planning decisions and conflict visibility only. No approvals or holds.
create table private.calendar_conflict_policy (
  id boolean primary key default true check (id),
  large_event_threshold integer not null default 100 check (large_event_threshold between 1 and 100000),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into private.calendar_conflict_policy(id) values (true);
revoke all on private.calendar_conflict_policy from public, anon, authenticated, service_role;

create table public.calendar_conflict_decisions (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{32}$'),
  conflict_type text not null,
  selected_event_id uuid not null references public.calendar_events(id),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  decided_by uuid not null references public.profiles(id),
  decided_at timestamptz not null default now()
);
alter table public.calendar_conflict_decisions enable row level security;
revoke all on public.calendar_conflict_decisions from public, anon, authenticated, service_role;
create index calendar_submission_occurrences_range on public.calendar_submission_occurrences using gist (occupancy_range);

create function public.calendar_conflict_policy_get()
returns table(large_event_threshold integer, revision integer) language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return query select p.large_event_threshold, p.revision from private.calendar_conflict_policy p where p.id;
end;
$$;
create function public.calendar_conflict_policy_save(p_threshold integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_super_admin(); v_previous integer;
begin
  if p_threshold is null or p_threshold not between 1 and 100000 then raise exception 'Invalid attendance threshold.' using errcode = 'RAR09'; end if;
  select large_event_threshold into v_previous from private.calendar_conflict_policy where id for update;
  if v_previous is distinct from p_threshold then
    update private.calendar_conflict_policy set large_event_threshold = p_threshold, revision = revision + 1,
      updated_at = now(), updated_by = v_actor where id;
    perform private.calendar_audit(v_actor, 'calendar_conflict_policy.updated', 'calendar_conflict_policy',
      '00000000-0000-4000-8000-000000000001'::uuid, jsonb_build_object('previous_threshold', v_previous, 'threshold', p_threshold));
  end if;
end;
$$;
revoke execute on function public.calendar_conflict_policy_get(), public.calendar_conflict_policy_save(integer) from public, anon, service_role;
grant execute on function public.calendar_conflict_policy_get(), public.calendar_conflict_policy_save(integer) to authenticated;

-- Internal aggregate is safe for planner-owned conflict guidance too; it never
-- returns other planners' identities through the planner-facing RPC.
create function private.calendar_conflict_resource_segments(p_resource uuid, p_start timestamptz, p_end timestamptz)
returns table(segment_start timestamptz, segment_end timestamptz, capacity integer, confirmed bigint, provisional bigint)
language sql stable set search_path = '' as $$
  with demand as (
    select a.occupancy_start as starts, a.occupancy_end as ends, a.quantity::bigint as c, 0::bigint as p
      from public.calendar_resource_allocations a where a.resource_id=p_resource and a.status='confirmed' and a.occupancy_start<p_end and a.occupancy_end>p_start
    union all
    select o.occupancy_start, o.occupancy_end, 0::bigint, r.quantity_requested::bigint
      from public.calendar_submission_resource_requests r join public.calendar_submission_occurrences o on o.id=r.submission_occurrence_id
      join public.calendar_event_submissions s on s.id=o.submission_id join public.calendar_events e on e.id=s.event_id
      join public.ministry_calendar_plans p on p.id=e.plan_id join public.calendar_cycles c on c.id=p.cycle_id
      where r.resource_id=p_resource and p.active and p.submission_status in ('submitted','changes_requested') and c.status in ('open','review')
        and s.plan_revision=p.submission_revision and s.plan_revision>p.resource_submission_floor
        and o.occupancy_start<p_end and o.occupancy_end>p_start
        and not exists (select 1 from public.calendar_resource_allocations a join public.calendar_submission_occurrences old_o on old_o.id=a.submission_occurrence_id
          where a.resource_id=p_resource and a.status='confirmed' and old_o.occurrence_id=o.occurrence_id)
  ), endpoints as (
    select p_start as at, 0::bigint as c, 0::bigint as p union all select p_end,0,0
    union all select greatest(starts,p_start),c,p from demand union all select least(ends,p_end),-c,-p from demand
  ), boundaries as (select at,sum(c) as dc,sum(p) as dp from endpoints group by at),
  segments as (select at,lead(at) over(order by at) as next_at,sum(dc) over(order by at)::bigint as used,sum(dp) over(order by at)::bigint as proposed from boundaries)
  select x.at,x.next_at,res.available_quantity,x.used,x.proposed from segments x cross join public.calendar_resources res
    where res.id=p_resource and x.next_at>x.at order by x.at;
$$;
revoke execute on function private.calendar_conflict_resource_segments(uuid,timestamptz,timestamptz) from public, anon, authenticated, service_role;

-- Each fingerprint incorporates submitted snapshot IDs, current operational
-- facts and policy revision. The decisions table is never itself authoritative:
-- callers join only to fingerprints recomputed from current facts.
create function private.calendar_current_conflicts()
returns table(fingerprint text, classification text, conflict_type text, event_id uuid, other_event_id uuid,
  occurrence_id uuid, starts_at timestamptz, ends_at timestamptz, details jsonb)
language sql stable security definer set search_path = '' as $$
  with eligible as (
    select o.id as snapshot_id,o.occurrence_id,o.occupancy_start,o.occupancy_end,o.occupancy_range,
      s.id as submission_id,s.event_id,s.title,s.scope,s.protection,s.location_type,s.estimated_attendance,s.food_drinks_planned,
      p.id as plan_id,p.ministry_id,p.submission_revision,m.name as ministry
    from public.calendar_submission_occurrences o join public.calendar_event_submissions s on s.id=o.submission_id
      join public.calendar_events e on e.id=s.event_id join public.ministry_calendar_plans p on p.id=e.plan_id
      join public.calendar_cycles cycle on cycle.id=p.cycle_id join public.ministries m on m.id=p.ministry_id
    where p.active and p.submission_status in ('submitted','changes_requested') and cycle.status in ('open','review')
      and s.plan_revision=p.submission_revision and s.plan_revision>p.resource_submission_floor
  ), raw as (
    -- Planning pairs are canonicalized so one decision selects either event.
    select 'planning'::text as classification,'room_planning'::text as kind,a.event_id as event_id,b.event_id as other_event_id,
      a.snapshot_id as occurrence_id,greatest(a.occupancy_start,b.occupancy_start) as starts_at,least(a.occupancy_end,b.occupancy_end) as ends_at,
      jsonb_build_object('event',a.title,'ministry',a.ministry,'other_event',b.title,'other_ministry',b.ministry,'room',room.name) as details,
      jsonb_build_object('a',a.snapshot_id,'b',b.snapshot_id,'room',room.id,'room_updated',room.updated_at) as facts
      from eligible a join eligible b on a.snapshot_id<b.snapshot_id and a.event_id<>b.event_id and a.occupancy_range && b.occupancy_range
      join public.calendar_submission_room_requests ar on ar.submission_occurrence_id=a.snapshot_id
      join public.calendar_submission_room_requests br on br.submission_occurrence_id=b.snapshot_id and br.room_id=ar.room_id
      join public.rooms room on room.id=ar.room_id
    union all
    select 'planning','exclusive_planning',a.event_id,b.event_id,a.snapshot_id,greatest(a.occupancy_start,b.occupancy_start),least(a.occupancy_end,b.occupancy_end),
      jsonb_build_object('event',a.title,'ministry',a.ministry,'other_event',b.title,'other_ministry',b.ministry,'policy','on-site property occupancy'),
      jsonb_build_object('a',a.snapshot_id,'b',b.snapshot_id,'a_protection',a.protection,'b_protection',b.protection)
      from eligible a join eligible b on a.snapshot_id<b.snapshot_id and a.event_id<>b.event_id and a.occupancy_range && b.occupancy_range
      where a.location_type='church' and b.location_type='church' and (a.protection='exclusive' or b.protection='exclusive')
    union all
    select 'warning','same_ministry',a.event_id,b.event_id,a.snapshot_id,greatest(a.occupancy_start,b.occupancy_start),least(a.occupancy_end,b.occupancy_end),
      jsonb_build_object('event',a.title,'ministry',a.ministry,'other_event',b.title,'other_ministry',b.ministry),jsonb_build_object('a',a.snapshot_id,'b',b.snapshot_id)
      from eligible a join eligible b on a.snapshot_id<b.snapshot_id and a.event_id<>b.event_id and a.occupancy_range && b.occupancy_range and a.ministry_id=b.ministry_id
    union all
    select 'warning','church_wide_overlap',a.event_id,b.event_id,a.snapshot_id,greatest(a.occupancy_start,b.occupancy_start),least(a.occupancy_end,b.occupancy_end),
      jsonb_build_object('event',a.title,'ministry',a.ministry,'other_event',b.title,'other_ministry',b.ministry),jsonb_build_object('a',a.snapshot_id,'b',b.snapshot_id)
      from eligible a join eligible b on a.snapshot_id<b.snapshot_id and a.event_id<>b.event_id and a.occupancy_range && b.occupancy_range
      where a.scope='church_wide' and b.scope='church_wide'
    union all
    select 'hard','room_reservation',a.event_id,null::uuid,a.snapshot_id,greatest(a.occupancy_start,r.start_at),least(a.occupancy_end,r.end_at),
      jsonb_build_object('event',a.title,'ministry',a.ministry,'room',room.name,'reservation',r.reference_code),
      jsonb_build_object('a',a.snapshot_id,'room',room.id,'reservation',r.id,'status',r.status,'updated',r.updated_at,'start',r.start_at,'end',r.end_at)
      from eligible a join public.calendar_submission_room_requests ar on ar.submission_occurrence_id=a.snapshot_id
      join public.rooms room on room.id=ar.room_id join public.reservations r on r.room_id=room.id and r.status in ('pending','approved') and r.reservation_range && a.occupancy_range
    union all
    select 'hard','room_unavailable',a.event_id,null::uuid,a.snapshot_id,a.occupancy_start,a.occupancy_end,
      jsonb_build_object('event',a.title,'ministry',a.ministry,'room',room.name),jsonb_build_object('a',a.snapshot_id,'room',room.id,'active',room.active,'reservable',room.reservable,'updated',room.updated_at)
      from eligible a join public.calendar_submission_room_requests ar on ar.submission_occurrence_id=a.snapshot_id join public.rooms room on room.id=ar.room_id
      where not room.active or not room.reservable
    union all
    select 'hard','food_policy',a.event_id,null::uuid,a.snapshot_id,a.occupancy_start,a.occupancy_end,
      jsonb_build_object('event',a.title,'ministry',a.ministry,'room',room.name),jsonb_build_object('a',a.snapshot_id,'room',room.id,'food_allowed',room.food_drinks_allowed,'updated',room.updated_at)
      from eligible a join public.calendar_submission_room_requests ar on ar.submission_occurrence_id=a.snapshot_id join public.rooms room on room.id=ar.room_id
      where a.food_drinks_planned and not room.food_drinks_allowed
    union all
    select 'warning','room_capacity',a.event_id,null::uuid,a.snapshot_id,a.occupancy_start,a.occupancy_end,
      jsonb_build_object('event',a.title,'ministry',a.ministry,'room',room.name,'attendance',a.estimated_attendance,'capacity',room.capacity),
      jsonb_build_object('a',a.snapshot_id,'room',room.id,'attendance',a.estimated_attendance,'capacity',room.capacity,'updated',room.updated_at)
      from eligible a join public.calendar_submission_room_requests ar on ar.submission_occurrence_id=a.snapshot_id join public.rooms room on room.id=ar.room_id
      where a.estimated_attendance>room.capacity
    union all
    select 'warning','large_event',a.event_id,null::uuid,a.snapshot_id,a.occupancy_start,a.occupancy_end,
      jsonb_build_object('event',a.title,'ministry',a.ministry,'attendance',a.estimated_attendance,'threshold',policy.large_event_threshold),
      jsonb_build_object('a',a.snapshot_id,'attendance',a.estimated_attendance,'threshold',policy.large_event_threshold)
      from eligible a cross join private.calendar_conflict_policy policy where policy.id and a.estimated_attendance>=policy.large_event_threshold
    union all
    select 'hard','resource_unavailable',a.event_id,null::uuid,a.snapshot_id,a.occupancy_start,a.occupancy_end,
      jsonb_build_object('event',a.title,'ministry',a.ministry,'resource',res.name),jsonb_build_object('a',a.snapshot_id,'resource',res.id,'active',res.active,'updated',res.updated_at)
      from eligible a join public.calendar_submission_resource_requests ar on ar.submission_occurrence_id=a.snapshot_id join public.calendar_resources res on res.id=ar.resource_id where not res.active
    union all
    select case when seg.confirmed - coalesce(own.qty,0) + ar.quantity_requested > seg.capacity then 'hard' else 'planning' end,
      case when seg.confirmed - coalesce(own.qty,0) + ar.quantity_requested > seg.capacity then 'resource_capacity' else 'resource_planning' end,
      a.event_id,null::uuid,a.snapshot_id,seg.segment_start,seg.segment_end,
      jsonb_build_object('event',a.title,'ministry',a.ministry,'resource',res.name,'capacity',seg.capacity,'confirmed',seg.confirmed,'provisional',seg.provisional,'requested',ar.quantity_requested,
        'participants',(select coalesce(jsonb_agg(jsonb_build_object('event_id',x.event_id,'title',x.title,'ministry',x.ministry) order by x.event_id),'[]'::jsonb)
          from eligible x join public.calendar_submission_resource_requests rr on rr.submission_occurrence_id=x.snapshot_id and rr.resource_id=res.id
          where x.occupancy_start<seg.segment_end and x.occupancy_end>seg.segment_start
            and not exists (select 1 from public.calendar_resource_allocations alloc
              join public.calendar_submission_occurrences old_occ on old_occ.id=alloc.submission_occurrence_id
              where alloc.resource_id=res.id and alloc.status='confirmed' and old_occ.occurrence_id=x.occurrence_id
                and alloc.occupancy_start<seg.segment_end and alloc.occupancy_end>seg.segment_start))),
      (case when seg.confirmed - coalesce(own.qty,0) + ar.quantity_requested > seg.capacity
        then jsonb_build_object('a',a.snapshot_id,'requested',ar.quantity_requested) else '{}'::jsonb end) ||
      jsonb_build_object('resource',res.id,'resource_updated',res.updated_at,'capacity',seg.capacity,'start',seg.segment_start,'end',seg.segment_end,
        'confirmed',seg.confirmed,'provisional',seg.provisional,
        'participants',(select coalesce(jsonb_agg(jsonb_build_array(x.snapshot_id,rr.quantity_requested,x.occupancy_start,x.occupancy_end) order by x.snapshot_id),'[]'::jsonb)
          from eligible x join public.calendar_submission_resource_requests rr on rr.submission_occurrence_id=x.snapshot_id and rr.resource_id=res.id
          where x.occupancy_start<seg.segment_end and x.occupancy_end>seg.segment_start),
        'allocations',(select coalesce(jsonb_agg(jsonb_build_array(z.id,z.quantity,z.occupancy_start,z.occupancy_end) order by z.id),'[]'::jsonb)
          from public.calendar_resource_allocations z where z.resource_id=res.id and z.status='confirmed' and z.occupancy_start<seg.segment_end and z.occupancy_end>seg.segment_start))
      from eligible a join public.calendar_submission_resource_requests ar on ar.submission_occurrence_id=a.snapshot_id join public.calendar_resources res on res.id=ar.resource_id
      cross join lateral private.calendar_conflict_resource_segments(res.id,a.occupancy_start,a.occupancy_end) seg
      left join lateral (select sum(z.quantity)::bigint as qty from public.calendar_resource_allocations z
        join public.calendar_submission_occurrences old_o on old_o.id=z.submission_occurrence_id
        where z.resource_id=res.id and z.status='confirmed' and old_o.occurrence_id=a.occurrence_id and z.occupancy_start<seg.segment_end and z.occupancy_end>seg.segment_start) own on true
      where seg.confirmed - coalesce(own.qty,0) + ar.quantity_requested > seg.capacity
        or (coalesce(own.qty,0)=0 and seg.confirmed + seg.provisional > seg.capacity)
  ), keyed as (
    select md5(jsonb_build_object('type',raw.kind,'facts',raw.facts,'policy',policy.revision)::text) as fingerprint,raw.*
      from raw cross join private.calendar_conflict_policy policy where policy.id
  )
  select distinct on (k.fingerprint) k.fingerprint,k.classification,k.kind,k.event_id,k.other_event_id,k.occurrence_id,k.starts_at,k.ends_at,k.details
    from keyed k order by k.fingerprint,k.event_id;
$$;
revoke execute on function private.calendar_current_conflicts() from public, anon, authenticated, service_role;

create function public.calendar_list_conflicts()
returns table(fingerprint text, classification text, conflict_type text, event_id uuid, other_event_id uuid,
  occurrence_id uuid, starts_at timestamptz, ends_at timestamptz, timezone text, details jsonb, selected_event_id uuid, reason text, decided_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return query select c.fingerprint,c.classification,c.conflict_type,c.event_id,c.other_event_id,c.occurrence_id,c.starts_at,c.ends_at,o.timezone,c.details,
    d.selected_event_id,d.reason,d.decided_at from private.calendar_current_conflicts() c
    join public.calendar_submission_occurrences o on o.id=c.occurrence_id
    left join public.calendar_conflict_decisions d on d.fingerprint=c.fingerprint
    order by case c.classification when 'hard' then 0 when 'planning' then 1 else 2 end,c.starts_at,c.fingerprint;
end;
$$;

create function public.calendar_record_conflict_decision(p_fingerprint text,p_selected_event uuid,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_staff(); c record; v_id uuid;
begin
  if p_fingerprint !~ '^[0-9a-f]{32}$' or char_length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise exception 'A current conflict and reason are required.' using errcode='RAR09'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_fingerprint,0));
  select * into c from private.calendar_current_conflicts() where fingerprint=p_fingerprint;
  if not found or c.classification='hard' or (p_selected_event is distinct from c.event_id and p_selected_event is distinct from c.other_event_id
      and not exists (select 1 from jsonb_array_elements(coalesce(c.details->'participants','[]'::jsonb)) x where x->>'event_id'=p_selected_event::text))
    or p_selected_event is null then raise exception 'Conflict changed or cannot be decided.' using errcode='RAR09'; end if;
  -- Follow the same cycle/plan/event ordering as planning mutations, including
  -- every resource participant rather than only the displayed representative.
  perform 1 from public.calendar_cycles cy where cy.id in (
    select p.cycle_id from public.ministry_calendar_plans p join public.calendar_events e on e.plan_id=p.id
      where e.id in (c.event_id,c.other_event_id) or e.id::text in
        (select x->>'event_id' from jsonb_array_elements(coalesce(c.details->'participants','[]'::jsonb)) x)
  ) order by cy.id for update;
  perform 1 from public.ministry_calendar_plans p where p.id in (
    select e.plan_id from public.calendar_events e where e.id in (c.event_id,c.other_event_id) or e.id::text in
      (select x->>'event_id' from jsonb_array_elements(coalesce(c.details->'participants','[]'::jsonb)) x)
  ) order by p.id for update;
  perform 1 from public.calendar_events e where e.id in (c.event_id,c.other_event_id) or e.id::text in
    (select x->>'event_id' from jsonb_array_elements(coalesce(c.details->'participants','[]'::jsonb)) x) order by e.id for update;
  if not exists(select 1 from private.calendar_current_conflicts() where fingerprint=p_fingerprint and classification<>'hard') then
    raise exception 'Conflict changed or cannot be decided.' using errcode='RAR09'; end if;
  insert into public.calendar_conflict_decisions(fingerprint,conflict_type,selected_event_id,reason,decided_by)
    values(p_fingerprint,c.conflict_type,p_selected_event,btrim(p_reason),v_actor)
    on conflict (fingerprint) do update set selected_event_id=excluded.selected_event_id,reason=excluded.reason,decided_by=excluded.decided_by,decided_at=now()
    returning id into v_id;
  perform private.calendar_audit(v_actor,'calendar_conflict.decided','calendar_conflict_decision',v_id,
    jsonb_build_object('fingerprint',p_fingerprint,'type',c.conflict_type,'selected_event_id',p_selected_event,'reason',btrim(p_reason)));
end;
$$;
revoke execute on function public.calendar_list_conflicts(), public.calendar_record_conflict_decision(text,uuid,text) from public, anon, service_role;
grant execute on function public.calendar_list_conflicts(), public.calendar_record_conflict_decision(text,uuid,text) to authenticated;

-- The planner sees only its own event and non-identifying descriptions, with no
-- other plan IDs, names, reasons or staff decisions.
create function public.calendar_planner_conflicts(p_plan_id uuid,p_session_hash text)
returns table(event_id uuid, classification text, conflict_type text, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_context jsonb;
begin
  v_context := private.calendar_require_planner(p_plan_id,p_session_hash,true);
  return query select e.id,c.classification,c.conflict_type,c.starts_at,c.ends_at from private.calendar_current_conflicts() c
    join public.calendar_events e on e.plan_id=(v_context->>'plan_id')::uuid and (e.id=c.event_id or e.id=c.other_event_id
      or (c.conflict_type='resource_planning' and exists (select 1 from jsonb_array_elements(coalesce(c.details->'participants','[]'::jsonb)) x where x->>'event_id'=e.id::text)));
end;
$$;
revoke execute on function public.calendar_planner_conflicts(uuid,text) from public, anon, authenticated;
grant execute on function public.calendar_planner_conflicts(uuid,text) to service_role;
