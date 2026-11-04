create function private.calendar_conflict_resource_segments(p_resource uuid, p_start timestamptz, p_end timestamptz, p_candidate uuid)
returns table(segment_start timestamptz, segment_end timestamptz, capacity integer, confirmed bigint, provisional bigint)
language sql stable set search_path = '' as $$
  with demand as (
    select a.occupancy_start as starts, a.occupancy_end as ends, a.quantity::bigint as c, 0::bigint as p
      from public.calendar_resource_allocations a where a.resource_id=p_resource and a.status='confirmed' and a.occupancy_start<p_end and a.occupancy_end>p_start
        and not exists (select 1 from public.calendar_submission_occurrences ao join public.calendar_event_submissions ass on ass.id=ao.submission_id where ao.id=a.submission_occurrence_id and ass.event_id=p_candidate)
    union all
    select o.occupancy_start, o.occupancy_end, 0::bigint, r.quantity_requested::bigint
      from public.calendar_submission_resource_requests r join public.calendar_submission_occurrences o on o.id=r.submission_occurrence_id
      join public.calendar_event_submissions s on s.id=o.submission_id join public.calendar_events e on e.id=s.event_id
      join public.ministry_calendar_plans p on p.id=e.plan_id join public.calendar_cycles c on c.id=p.cycle_id
      where r.resource_id=p_resource and p.active and p.submission_status in ('submitted','changes_requested') and c.status in ('open','review')
        and s.plan_revision=p.submission_revision and s.plan_revision>p.resource_submission_floor
        and not exists (select 1 from public.calendar_event_commitments cm where cm.submission_id=s.id)
        and not exists (select 1 from public.calendar_event_commitments cm join public.calendar_commitment_occurrence_cancellations cc on cc.commitment_id=cm.id
          where cm.event_id=s.event_id and cm.state='active' and cc.logical_occurrence_id=o.logical_occurrence_id)
        and o.occupancy_start<p_end and o.occupancy_end>p_start
        and not exists (select 1 from public.calendar_resource_allocations a join public.calendar_submission_occurrences old_o on old_o.id=a.submission_occurrence_id
          where a.resource_id=p_resource and a.status='confirmed' and old_o.occurrence_id=o.occurrence_id
            and e.id<>p_candidate)
  ), endpoints as (
    select p_start as at, 0::bigint as c, 0::bigint as p union all select p_end,0,0
    union all select greatest(starts,p_start),c,p from demand union all select least(ends,p_end),-c,-p from demand
  ), boundaries as (select at,sum(c) as dc,sum(p) as dp from endpoints group by at),
  segments as (select at,lead(at) over(order by at) as next_at,sum(dc) over(order by at)::bigint as used,sum(dp) over(order by at)::bigint as proposed from boundaries)
  select x.at,x.next_at,res.available_quantity,x.used,x.proposed from segments x cross join public.calendar_resources res
    where res.id=p_resource and x.next_at>x.at order by x.at;
$$;
revoke execute on function private.calendar_conflict_resource_segments(uuid,timestamptz,timestamptz,uuid) from public, anon, authenticated, service_role;


create or replace function private.calendar_current_conflict_contexts()
returns table(fingerprint text, classification text, conflict_type text, event_id uuid, other_event_id uuid,
  occurrence_id uuid, starts_at timestamptz, ends_at timestamptz, details jsonb, facts jsonb, policy_revision integer)
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
      and not exists (select 1 from public.calendar_event_commitments cm where cm.submission_id=s.id)
      and not exists (select 1 from public.calendar_event_commitments cm join public.calendar_commitment_occurrence_cancellations cc on cc.commitment_id=cm.id
        where cm.event_id=s.event_id and cm.state='active' and cc.logical_occurrence_id=o.logical_occurrence_id)
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
    select 'hard','approved_exclusive',a.event_id,null::uuid,a.snapshot_id,greatest(a.occupancy_start,occ.occupancy_start),least(a.occupancy_end,occ.occupancy_end),
      jsonb_build_object('event',a.title,'ministry',a.ministry,'other_event',approved.title,'policy','approved on-site property occupancy'),
      jsonb_build_object('a',a.snapshot_id,'b',occ.id,'commitment',cm.id,'a_protection',a.protection,'b_protection',approved.protection)
      from eligible a join public.calendar_event_commitments cm on cm.state='active' and cm.event_id<>a.event_id
      join public.calendar_event_submissions approved on approved.id=cm.submission_id
      join public.calendar_submission_occurrences occ on occ.submission_id=approved.id and occ.occupancy_range && a.occupancy_range
      where a.location_type='church' and approved.location_type='church' and (a.protection='exclusive' or approved.protection='exclusive')
        and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc where cc.commitment_id=cm.id and cc.submission_occurrence_id=occ.id)
    union all
    select 'warning','approved_same_ministry',a.event_id,null::uuid,a.snapshot_id,greatest(a.occupancy_start,occ.occupancy_start),least(a.occupancy_end,occ.occupancy_end),
      jsonb_build_object('event',a.title,'ministry',a.ministry,'other_event',approved.title),
      jsonb_build_object('a',a.snapshot_id,'b',occ.id,'commitment',cm.id)
      from eligible a join public.calendar_event_commitments cm on cm.state='active' and cm.event_id<>a.event_id
      join public.calendar_event_submissions approved on approved.id=cm.submission_id
      join public.calendar_events ae on ae.id=cm.event_id join public.ministry_calendar_plans ap on ap.id=ae.plan_id and ap.ministry_id=a.ministry_id
      join public.calendar_submission_occurrences occ on occ.submission_id=approved.id and occ.occupancy_range && a.occupancy_range
      where not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc where cc.commitment_id=cm.id and cc.submission_occurrence_id=occ.id)
    union all
    select 'warning','approved_church_wide_overlap',a.event_id,null::uuid,a.snapshot_id,greatest(a.occupancy_start,occ.occupancy_start),least(a.occupancy_end,occ.occupancy_end),
      jsonb_build_object('event',a.title,'ministry',a.ministry,'other_event',approved.title),
      jsonb_build_object('a',a.snapshot_id,'b',occ.id,'commitment',cm.id)
      from eligible a join public.calendar_event_commitments cm on cm.state='active' and cm.event_id<>a.event_id
      join public.calendar_event_submissions approved on approved.id=cm.submission_id
      join public.calendar_submission_occurrences occ on occ.submission_id=approved.id and occ.occupancy_range && a.occupancy_range
      where a.scope='church_wide' and approved.scope='church_wide'
        and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc where cc.commitment_id=cm.id and cc.submission_occurrence_id=occ.id)
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
      and not exists(select 1 from public.calendar_event_commitments cm where cm.id=r.calendar_commitment_id and cm.event_id=a.event_id and cm.state='active')
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
    select case when seg.confirmed + ar.quantity_requested > seg.capacity then 'hard' else 'planning' end,
      case when seg.confirmed + ar.quantity_requested > seg.capacity then 'resource_capacity' else 'resource_planning' end,
      a.event_id,null::uuid,a.snapshot_id,seg.segment_start,seg.segment_end,
      jsonb_build_object('event',a.title,'ministry',a.ministry,'resource',res.name,'capacity',seg.capacity,'confirmed',seg.confirmed,'provisional',seg.provisional,'requested',ar.quantity_requested,
        'participants',(select coalesce(jsonb_agg(jsonb_build_object('event_id',x.event_id,'title',x.title,'ministry',x.ministry) order by x.event_id),'[]'::jsonb)
          from eligible x join public.calendar_submission_resource_requests rr on rr.submission_occurrence_id=x.snapshot_id and rr.resource_id=res.id
          where x.occupancy_start<seg.segment_end and x.occupancy_end>seg.segment_start
            and not exists (select 1 from public.calendar_resource_allocations alloc
              join public.calendar_submission_occurrences old_occ on old_occ.id=alloc.submission_occurrence_id
              where alloc.resource_id=res.id and alloc.status='confirmed' and old_occ.occurrence_id=x.occurrence_id and x.event_id<>a.event_id
                and alloc.occupancy_start<seg.segment_end and alloc.occupancy_end>seg.segment_start))),
      (case when seg.confirmed + ar.quantity_requested > seg.capacity
        then jsonb_build_object('a',a.snapshot_id,'requested',ar.quantity_requested) else '{}'::jsonb end) ||
      jsonb_build_object('resource',res.id,'resource_updated',res.updated_at,'capacity',seg.capacity,'start',seg.segment_start,'end',seg.segment_end,
        'confirmed',seg.confirmed,'provisional',seg.provisional,
        'participants',(select coalesce(jsonb_agg(jsonb_build_array(x.snapshot_id,rr.quantity_requested,x.occupancy_start,x.occupancy_end) order by x.snapshot_id),'[]'::jsonb)
          from eligible x join public.calendar_submission_resource_requests rr on rr.submission_occurrence_id=x.snapshot_id and rr.resource_id=res.id
          where x.occupancy_start<seg.segment_end and x.occupancy_end>seg.segment_start),
        'allocations',(select coalesce(jsonb_agg(jsonb_build_array(z.id,z.quantity,z.occupancy_start,z.occupancy_end) order by z.id),'[]'::jsonb)
          from public.calendar_resource_allocations z where z.resource_id=res.id and z.status='confirmed' and z.occupancy_start<seg.segment_end and z.occupancy_end>seg.segment_start and not exists(select 1 from public.calendar_submission_occurrences zo join public.calendar_event_submissions zs on zs.id=zo.submission_id where zo.id=z.submission_occurrence_id and zs.event_id=a.event_id)))
      from eligible a join public.calendar_submission_resource_requests ar on ar.submission_occurrence_id=a.snapshot_id join public.calendar_resources res on res.id=ar.resource_id
      cross join lateral private.calendar_conflict_resource_segments(res.id,a.occupancy_start,a.occupancy_end,a.event_id) seg
      where not exists (select 1 from public.calendar_resource_allocations own
        where own.submission_occurrence_id=a.snapshot_id and own.resource_id=res.id and own.status='confirmed'
          and own.occupancy_start<seg.segment_end and own.occupancy_end>seg.segment_start)
        and (seg.confirmed + ar.quantity_requested > seg.capacity
          or seg.confirmed + seg.provisional > seg.capacity)
  ), keyed as (
    select md5(jsonb_build_object('type',raw.kind,'facts',raw.facts,'policy',policy.revision)::text) as fingerprint,raw.*,policy.revision as policy_revision
      from raw cross join private.calendar_conflict_policy policy where policy.id
  )
  select distinct on (k.fingerprint) k.fingerprint,k.classification,k.kind,k.event_id,k.other_event_id,k.occurrence_id,k.starts_at,k.ends_at,k.details,k.facts,k.policy_revision
    from keyed k order by k.fingerprint,k.event_id;
$$;
revoke execute on function private.calendar_current_conflict_contexts() from public, anon, authenticated, service_role;


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
        and not exists (select 1 from public.calendar_event_commitments cm where cm.submission_id=s.id)
        and not exists (select 1 from public.calendar_event_commitments cm join public.calendar_commitment_occurrence_cancellations cc on cc.commitment_id=cm.id
          where cm.event_id=s.event_id and cm.state='active' and cc.logical_occurrence_id=o.logical_occurrence_id)
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
