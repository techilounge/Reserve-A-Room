create function private.calendar_current_conflict_contexts()
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
    select md5(jsonb_build_object('type',raw.kind,'facts',raw.facts,'policy',policy.revision)::text) as fingerprint,raw.*,policy.revision as policy_revision
      from raw cross join private.calendar_conflict_policy policy where policy.id
  )
  select distinct on (k.fingerprint) k.fingerprint,k.classification,k.kind,k.event_id,k.other_event_id,k.occurrence_id,k.starts_at,k.ends_at,k.details,k.facts,k.policy_revision
    from keyed k order by k.fingerprint,k.event_id;
$$;
revoke execute on function private.calendar_current_conflict_contexts() from public, anon, authenticated, service_role;

-- Keep the existing conflict interface while deriving decisions from the same
-- database-generated facts and policy revision that produce its fingerprint.
create or replace function private.calendar_current_conflicts()
returns table(fingerprint text, classification text, conflict_type text, event_id uuid, other_event_id uuid,
  occurrence_id uuid, starts_at timestamptz, ends_at timestamptz, details jsonb)
language sql stable security definer set search_path = '' as $$
  select c.fingerprint,c.classification,c.conflict_type,c.event_id,c.other_event_id,c.occurrence_id,c.starts_at,c.ends_at,c.details
  from private.calendar_current_conflict_contexts() c;
$$;

-- Earlier preview decisions cannot be reconstructed reliably. Preserve them as
-- legacy history, but require a fresh typed decision for the current conflict.
alter table public.calendar_conflict_decisions drop constraint calendar_conflict_decisions_fingerprint_key;
alter table public.calendar_conflict_decisions alter column selected_event_id drop not null;
alter table public.calendar_conflict_decisions add column decision_order bigint generated always as identity;
alter table public.calendar_conflict_decisions add column decision_type text not null default 'legacy';
alter table public.calendar_conflict_decisions add column context jsonb;
update public.calendar_conflict_decisions set context=jsonb_build_object('legacy',true,'context_unavailable',true,
  'fingerprint',fingerprint,'conflict_type',conflict_type,'selected_event_id',selected_event_id);
alter table public.calendar_conflict_decisions alter column context set not null;
alter table public.calendar_conflict_decisions add constraint calendar_conflict_decision_type_check check (
  (decision_type='advance' and selected_event_id is not null) or
  (decision_type='acknowledge' and selected_event_id is null) or
  (decision_type='legacy' and selected_event_id is not null));
create index calendar_conflict_decisions_latest on public.calendar_conflict_decisions(fingerprint,decision_order desc);

create function private.calendar_decision_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Conflict decision history is immutable.' using errcode='RAR09';
end;
$$;
create trigger calendar_decision_immutable before update or delete on public.calendar_conflict_decisions
  for each row execute function private.calendar_decision_immutable();
revoke execute on function private.calendar_decision_immutable() from public, anon, authenticated, service_role;

drop function public.calendar_list_conflicts();
create function public.calendar_list_conflicts()
returns table(fingerprint text, classification text, conflict_type text, event_id uuid, other_event_id uuid,
  occurrence_id uuid, starts_at timestamptz, ends_at timestamptz, timezone text, details jsonb,
  decision_type text, selected_event_id uuid, reason text, decided_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return query select c.fingerprint,c.classification,c.conflict_type,c.event_id,c.other_event_id,c.occurrence_id,c.starts_at,c.ends_at,o.timezone,c.details,
    d.decision_type,d.selected_event_id,d.reason,d.decided_at from private.calendar_current_conflicts() c
    join public.calendar_submission_occurrences o on o.id=c.occurrence_id
    left join lateral (select x.* from public.calendar_conflict_decisions x where x.fingerprint=c.fingerprint
      and ((c.classification='planning' and x.decision_type='advance') or (c.classification='warning' and x.decision_type='acknowledge'))
      order by x.decision_order desc limit 1) d on true
    order by case c.classification when 'hard' then 0 when 'planning' then 1 else 2 end,c.starts_at,c.fingerprint;
end;
$$;

drop function public.calendar_record_conflict_decision(text,uuid,text);
create function public.calendar_record_conflict_decision(p_fingerprint text,p_decision_type text,p_reason text,p_selected_event uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_staff(); c record; v_id uuid; v_context jsonb; v_participants jsonb;
begin
  if coalesce(p_fingerprint,'') !~ '^[0-9a-f]{32}$' or char_length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise exception 'A current conflict and reason are required.' using errcode='RAR09'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_fingerprint,0));
  select * into c from private.calendar_current_conflict_contexts() where fingerprint=p_fingerprint;
  if not found or c.classification='hard'
    or (c.classification='warning' and (p_decision_type is distinct from 'acknowledge' or p_selected_event is not null))
    or (c.classification='planning' and (p_decision_type is distinct from 'advance' or p_selected_event is null or
      (p_selected_event is distinct from c.event_id and p_selected_event is distinct from c.other_event_id
       and not exists (select 1 from jsonb_array_elements(coalesce(c.details->'participants','[]'::jsonb)) x where x->>'event_id'=p_selected_event::text))))
    or c.classification not in ('planning','warning') then
    raise exception 'Conflict changed or cannot be decided.' using errcode='RAR09'; end if;
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
  -- Serialize policy changes during the final recomputation and snapshot.
  perform 1 from private.calendar_conflict_policy where id for share;
  select * into c from private.calendar_current_conflict_contexts() where fingerprint=p_fingerprint;
  if not found or c.classification='hard' or
    (c.classification='planning' and p_decision_type is distinct from 'advance') or
    (c.classification='warning' and p_decision_type is distinct from 'acknowledge') then
    raise exception 'Conflict changed or cannot be decided.' using errcode='RAR09'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('event_id',s.event_id,'title',s.title,'submission_id',s.id,
    'plan_id',e.plan_id,'submitted_revision',s.plan_revision,'snapshot_id',o.id,'occurrence_id',o.occurrence_id,
    'logical_occurrence_id',o.logical_occurrence_id,'occupancy_start',o.occupancy_start,'occupancy_end',o.occupancy_end)
    order by o.id),'[]'::jsonb) into v_participants
    from public.calendar_submission_occurrences o join public.calendar_event_submissions s on s.id=o.submission_id
    join public.calendar_events e on e.id=s.event_id
    where o.id=c.occurrence_id or o.id::text=c.facts->>'a' or o.id::text=c.facts->>'b'
      or o.id::text in (select x->>0 from jsonb_array_elements(coalesce(c.facts->'participants','[]'::jsonb)) x);
  v_context := jsonb_build_object('fingerprint',c.fingerprint,'classification',c.classification,'conflict_type',c.conflict_type,
    'starts_at',c.starts_at,'ends_at',c.ends_at,'policy_revision',c.policy_revision,'participants',v_participants,
    'related_entity_type',case when c.facts ? 'resource' then 'resource' when c.facts ? 'room' then 'room' else null end,
    'related_entity_id',coalesce(c.facts->>'resource',c.facts->>'room'),'details',c.details,'facts',c.facts);
  insert into public.calendar_conflict_decisions(fingerprint,conflict_type,decision_type,selected_event_id,reason,decided_by,context)
    values(p_fingerprint,c.conflict_type,p_decision_type,p_selected_event,btrim(p_reason),v_actor,v_context) returning id into v_id;
  perform private.calendar_audit(v_actor,'calendar_conflict.decided','calendar_conflict_decision',v_id,
    jsonb_build_object('fingerprint',p_fingerprint,'type',c.conflict_type,'decision_type',p_decision_type,
      'selected_event_id',p_selected_event,'reason',btrim(p_reason),'context',v_context));
end;
$$;
revoke execute on function public.calendar_list_conflicts(), public.calendar_record_conflict_decision(text,text,text,uuid) from public, anon, service_role;
grant execute on function public.calendar_list_conflicts(), public.calendar_record_conflict_decision(text,text,text,uuid) to authenticated;


