-- Preserve the reviewed v1 contract while exposing immutable occupancy to staff.
create function public.calendar_master_entries_with_occupancy(p_from date,p_to date,p_cycle uuid default null,
  p_ministry uuid default null,p_room uuid default null,p_resource uuid default null,
  p_scope text default null,p_visibility text default null,p_layer text default 'all')
returns table(entry_id uuid,event_id uuid,submission_id uuid,kind text,status text,title text,
  starts_at timestamptz,ends_at timestamptz,all_day boolean,timezone text,
  cycle_id uuid,cycle_name text,ministry_id uuid,ministry_name text,scope text,visibility text,
  location_type text,rooms jsonb,resources jsonb,occupancy_start timestamptz,occupancy_end timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return query
    select m.*, case when m.kind='event' then o.occupancy_start else m.starts_at end,
      case when m.kind='event' then o.occupancy_end else m.ends_at end
    from public.calendar_master_entries(p_from,p_to,p_cycle,p_ministry,p_room,p_resource,p_scope,p_visibility,p_layer) m
    left join public.calendar_submission_occurrences o on m.kind='event' and o.id=m.entry_id;
end;
$$;
revoke execute on function public.calendar_master_entries_with_occupancy(date,date,uuid,uuid,uuid,uuid,text,text,text) from public,anon,service_role;
grant execute on function public.calendar_master_entries_with_occupancy(date,date,uuid,uuid,uuid,uuid,text,text,text) to authenticated;

-- A visible event may have setup or cleanup outside the displayed dates. Each
-- buffer is limited to 1,440 minutes by calendar_events, so extend the conflict
-- window by 24 elapsed hours on either side without extending the calendar query.
create or replace function public.calendar_master_conflicts(p_from date,p_to date)
returns table(event_id uuid,other_event_id uuid,starts_at timestamptz,ends_at timestamptz,details jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_timezone text; v_start timestamptz; v_end timestamptz;
begin
  perform private.require_staff();
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then
    raise exception 'Invalid calendar range.' using errcode='RAR10';
  end if;
  select s.timezone into v_timezone from public.app_settings s where s.id;
  v_start:=(p_from::timestamp at time zone v_timezone) - interval '24 hours';
  v_end:=((p_to+1)::timestamp at time zone v_timezone) + interval '24 hours';
  return query select c.event_id,c.other_event_id,c.starts_at,c.ends_at,c.details
    from private.calendar_current_conflicts() c where c.starts_at<v_end and c.ends_at>v_start
    order by c.starts_at,c.event_id limit 5001;
end;
$$;
