-- Reserve-A-Room · Bounded staff reservation export query.

create function public.admin_export_reservations(
  p_from date,
  p_to date,
  p_search text default null,
  p_statuses public.reservation_status[] default null,
  p_room_id uuid default null,
  p_ministry_id uuid default null,
  p_approval text default null,
  p_sort text default 'start_asc',
  p_limit integer default 1000
)
returns table (
  id uuid,
  reference_code text,
  status public.reservation_status,
  source public.reservation_source,
  room_name text,
  start_at timestamptz,
  end_at timestamptz,
  requester_first_name text,
  requester_last_name text,
  requester_email text,
  requester_phone text,
  ministry_name text,
  purpose text,
  estimated_attendance integer,
  approval_required_at_submission boolean,
  created_at timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text := (select s.timezone from public.app_settings s where s.id);
  v_search text := nullif(lower(btrim(p_search)), '');
begin
  perform private.require_staff();
  if p_from is null or p_to is null or p_from > p_to or p_to > p_from + 365 then
    raise exception 'Exports require a date range of no more than one year.' using errcode = 'RAR10';
  end if;

  return query
  select
    r.id, r.reference_code, r.status, r.source, rm.name, r.start_at, r.end_at,
    r.requester_first_name, r.requester_last_name, r.requester_email, r.requester_phone,
    coalesce(m.name, r.other_ministry_name), r.purpose, r.estimated_attendance,
    r.approval_required_at_submission, r.created_at
  from public.reservations r
  join public.rooms rm on rm.id = r.room_id
  left join public.ministries m on m.id = r.ministry_id
  where r.start_at at time zone v_tz >= p_from::timestamp
    and r.start_at at time zone v_tz < (p_to + 1)::timestamp
    and (p_statuses is null or r.status = any (p_statuses))
    and (p_room_id is null or r.room_id = p_room_id)
    and (p_ministry_id is null or r.ministry_id = p_ministry_id)
    and (p_approval is null
      or (p_approval = 'required' and r.approval_required_at_submission)
      or (p_approval = 'instant' and not r.approval_required_at_submission))
    and (v_search is null
      or r.search_text like '%' || v_search || '%'
      or lower(rm.name) like '%' || v_search || '%'
      or lower(coalesce(m.name, '')) like '%' || v_search || '%'
      or (length(regexp_replace(v_search, '\D', '', 'g')) >= 4
          and r.requester_phone like '%' || regexp_replace(v_search, '\D', '', 'g') || '%'))
  order by
    case when p_sort = 'start_asc' then r.start_at end asc,
    case when p_sort = 'start_desc' then r.start_at end desc,
    case when p_sort = 'created_desc' then r.created_at end desc,
    case when p_sort = 'created_asc' then r.created_at end asc,
    r.start_at asc, r.id
  limit least(greatest(p_limit, 1), 1000);
end;
$$;

revoke execute on function public.admin_export_reservations(
  date, date, text, public.reservation_status[], uuid, uuid, text, text, integer
) from public, anon;
grant execute on function public.admin_export_reservations(
  date, date, text, public.reservation_status[], uuid, uuid, text, text, integer
) to authenticated;
