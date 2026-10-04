-- Reserve-A-Room · Reservation exports without the one-year window.
--
-- The first version required both dates, capped the range at one year, and returned at
-- most 1,000 rows. This version:
--   * treats p_from / p_to as optional bounds (no dates = every reservation);
--   * adds p_offset so the server can read the full result set in pages. The 1,000 cap
--     now applies per page, which also matches the API's own per-response row limit;
--   * keeps a deterministic order (the final tie-break is the reservation id) so paging
--     never repeats or skips a row.
--
-- Every call the previous version accepted is still accepted: all new parameters are
-- optional, so this migration can be applied before the application is deployed.

drop function public.admin_export_reservations(
  date, date, text, public.reservation_status[], uuid, uuid, text, text, integer
);

create function public.admin_export_reservations(
  p_from date default null,
  p_to date default null,
  p_search text default null,
  p_statuses public.reservation_status[] default null,
  p_room_id uuid default null,
  p_ministry_id uuid default null,
  p_approval text default null,
  p_sort text default 'start_asc',
  p_limit integer default 1000,
  p_offset integer default 0
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
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'The export start date must be on or before the end date.' using errcode = 'RAR10';
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
  where (p_from is null or r.start_at at time zone v_tz >= p_from::timestamp)
    and (p_to is null or r.start_at at time zone v_tz < (p_to + 1)::timestamp)
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
  limit least(greatest(p_limit, 1), 1000)
  offset greatest(p_offset, 0);
end;
$$;

revoke execute on function public.admin_export_reservations(
  date, date, text, public.reservation_status[], uuid, uuid, text, text, integer, integer
) from public, anon;
grant execute on function public.admin_export_reservations(
  date, date, text, public.reservation_status[], uuid, uuid, text, text, integer, integer
) to authenticated;
