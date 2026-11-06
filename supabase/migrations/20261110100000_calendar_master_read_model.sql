-- A bounded staff read model for the master calendar. The existing per-submission
-- RPC returns all 1,200 occurrences even for a month view (local measurement:
-- 1,200 rows / 615,601 JSON bytes for a 30-day window containing 30 rows).
-- No tables or indexes are added; existing range and foreign-key indexes apply.
create function public.calendar_master_entries(p_from date,p_to date,p_cycle uuid default null,
  p_ministry uuid default null,p_room uuid default null,p_resource uuid default null,
  p_scope text default null,p_visibility text default null,p_layer text default 'all')
returns table(entry_id uuid,event_id uuid,submission_id uuid,kind text,status text,title text,
  starts_at timestamptz,ends_at timestamptz,all_day boolean,timezone text,
  cycle_id uuid,cycle_name text,ministry_id uuid,ministry_name text,scope text,visibility text,
  location_type text,rooms jsonb,resources jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_timezone text; v_start timestamptz; v_end timestamptz;
begin
  perform private.require_staff();
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365
    or p_layer not in ('all','approved','proposed','rooms')
    or (p_scope is not null and p_scope not in ('ministry','church_wide','administrative','community'))
    or (p_visibility is not null and p_visibility not in ('public','internal')) then
    raise exception 'Invalid calendar range or filters.' using errcode='RAR10';
  end if;
  select s.timezone into v_timezone from public.app_settings s where s.id;
  v_start:=p_from::timestamp at time zone v_timezone;
  v_end:=(p_to+1)::timestamp at time zone v_timezone;
  return query
  with events as (
    select o.id,o.logical_occurrence_id,o.submission_id,s.event_id,s.title,o.start_at,o.end_at,o.all_day,o.timezone,
      cy.id as cycle_id,cy.name as cycle_name,m.id as ministry_id,m.name as ministry_name,s.scope,s.visibility,s.location_type,
      cm.id as commitment_id,cm.state as commitment_state,cm.closed_at,
      exists(select 1 from public.calendar_commitment_occurrence_cancellations x where x.commitment_id=cm.id and x.submission_occurrence_id=o.id) as cancelled
    from public.calendar_submission_occurrences o
    join public.calendar_event_submissions s on s.id=o.submission_id
    join public.calendar_events e on e.id=s.event_id
    join public.ministry_calendar_plans p on p.id=e.plan_id
    join public.calendar_cycles cy on cy.id=p.cycle_id
    join public.ministries m on m.id=p.ministry_id
    left join public.calendar_event_commitments cm on cm.submission_id=s.id
    where o.event_range && tstzrange(v_start,v_end,'[)')
      and (p_cycle is null or cy.id=p_cycle) and (p_ministry is null or m.id=p_ministry)
      and (p_scope is null or s.scope=p_scope) and (p_visibility is null or s.visibility=p_visibility)
      and (p_room is null or exists(select 1 from public.calendar_submission_room_requests rr where rr.submission_occurrence_id=o.id and rr.room_id=p_room))
      and (p_resource is null or exists(select 1 from public.calendar_submission_resource_requests rr where rr.submission_occurrence_id=o.id and rr.resource_id=p_resource))
      -- Once a past logical occurrence belongs to an earlier commitment, keep
      -- that historical row rather than displaying it again in later revisions.
      and (cm.id is null or not exists(select 1 from public.calendar_event_commitments earlier
        join public.calendar_submission_occurrences old_o on old_o.submission_id=earlier.submission_id
        where earlier.event_id=e.id and earlier.approval_order<cm.approval_order
          and old_o.logical_occurrence_id=o.logical_occurrence_id and old_o.end_at<=earlier.closed_at))
      and ((cm.state='active')
        or (cm.state='cancelled' and not exists(select 1 from public.calendar_event_commitments newer where newer.event_id=e.id and newer.approval_order>cm.approval_order))
        or (cm.state='replaced' and o.end_at<=cm.closed_at and not exists(
          select 1 from public.calendar_event_commitments earlier join public.calendar_submission_occurrences old_o on old_o.submission_id=earlier.submission_id
          where earlier.event_id=e.id and earlier.approval_order<cm.approval_order and old_o.logical_occurrence_id=o.logical_occurrence_id and old_o.end_at<=earlier.closed_at))
        or (cm.id is null and p.active and p.submission_status in ('submitted','changes_requested') and cy.status in ('open','review')
          and s.plan_revision=p.submission_revision and s.plan_revision>p.resource_submission_floor
          and not exists(select 1 from public.calendar_event_commitments active_cm join public.calendar_commitment_occurrence_cancellations cc on cc.commitment_id=active_cm.id
            where active_cm.event_id=e.id and active_cm.state='active' and cc.logical_occurrence_id=o.logical_occurrence_id)))
  ), result as (
    select e.id,e.event_id,e.submission_id,'event'::text as kind,
      case when e.cancelled or (e.commitment_state='cancelled' and e.start_at>e.closed_at) then 'cancelled'
        when e.commitment_id is null then 'proposed' else 'approved' end as status,
      e.title,e.start_at,e.end_at,e.all_day,e.timezone,e.cycle_id,e.cycle_name,e.ministry_id,e.ministry_name,e.scope,e.visibility,e.location_type,
      (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name) order by r.name),'[]'::jsonb)
        from public.calendar_submission_room_requests q join public.rooms r on r.id=q.room_id where q.submission_occurrence_id=e.id) as rooms,
      (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'quantity',q.quantity_requested) order by r.name),'[]'::jsonb)
        from public.calendar_submission_resource_requests q join public.calendar_resources r on r.id=q.resource_id where q.submission_occurrence_id=e.id) as resources
    from events e
    where p_layer='all' or (p_layer='approved' and e.commitment_id is not null) or (p_layer='proposed' and e.commitment_id is null)
    union all
    select r.id,null::uuid,null::uuid,'reservation'::text,r.status::text,r.purpose,r.start_at,r.end_at,false,v_timezone,
      null::uuid,null::text,r.ministry_id,coalesce(m.name,r.other_ministry_name),null::text,null::text,'church'::text,
      jsonb_build_array(jsonb_build_object('id',rm.id,'name',rm.name)),'[]'::jsonb
    from public.reservations r join public.rooms rm on rm.id=r.room_id left join public.ministries m on m.id=r.ministry_id
    where p_layer in ('all','rooms') and r.calendar_commitment_id is null and r.status in ('pending','approved')
      and r.reservation_range && tstzrange(v_start,v_end,'[)') and p_cycle is null and p_resource is null
      and p_scope is null and p_visibility is null and (p_room is null or r.room_id=p_room)
      and (p_ministry is null or r.ministry_id=p_ministry)
  )
  select * from result order by start_at,id limit 5001;
end;
$$;
revoke execute on function public.calendar_master_entries(date,date,uuid,uuid,uuid,uuid,text,text,text) from public,anon,service_role;
grant execute on function public.calendar_master_entries(date,date,uuid,uuid,uuid,uuid,text,text,text) to authenticated;

-- Filter choices are small catalogs and do not expose planner contacts or notes.
create function public.calendar_master_filter_options() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return jsonb_build_object(
    'cycles',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name,c.id),'[]'::jsonb) from public.calendar_cycles c),
    'ministries',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.name,m.id),'[]'::jsonb) from public.ministries m),
    'rooms',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name) order by r.name,r.id),'[]'::jsonb) from public.rooms r),
    'resources',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name) order by r.name,r.id),'[]'::jsonb) from public.calendar_resources r));
end;
$$;
revoke execute on function public.calendar_master_filter_options() from public,anon,service_role;
grant execute on function public.calendar_master_filter_options() to authenticated;

-- Return only conflict indicators in the requested interval; the existing
-- decision engine remains the authority and no conflict facts are rewritten.
create function public.calendar_master_conflicts(p_from date,p_to date)
returns table(event_id uuid,other_event_id uuid,starts_at timestamptz,ends_at timestamptz,details jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_timezone text; v_start timestamptz; v_end timestamptz;
begin
  perform private.require_staff();
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then
    raise exception 'Invalid calendar range.' using errcode='RAR10';
  end if;
  select s.timezone into v_timezone from public.app_settings s where s.id;
  v_start:=p_from::timestamp at time zone v_timezone;
  v_end:=(p_to+1)::timestamp at time zone v_timezone;
  return query select c.event_id,c.other_event_id,c.starts_at,c.ends_at,c.details
    from private.calendar_current_conflicts() c where c.starts_at<v_end and c.ends_at>v_start
    order by c.starts_at,c.event_id limit 5001;
end;
$$;
revoke execute on function public.calendar_master_conflicts(date,date) from public,anon,service_role;
grant execute on function public.calendar_master_conflicts(date,date) to authenticated;
